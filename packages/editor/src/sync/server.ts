import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import {
  RoomDraftError,
  buildDraftDoc,
  type Actor,
  type RestoreTarget,
  type RoomDraftErrorCode,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_RESTORE,
  MESSAGE_SYNC,
  SYNC_PATH_PREFIX,
  encodeRestoreResponse,
  parseRestoreRequest,
  readRestorePayload,
  type RestoreResponse,
} from "./protocol";

/**
 * Servidor del WebSocket de edición (specs/09 §2): un doc Yjs vivo por sala,
 * sincronizado con `y-protocols` (sync + awareness). Cada update integrado se
 * persiste con `RoomDraftService.appendUpdate` (ticket 3.2) — autosave
 * continuo, sin persistencia propia —; la awareness solo se retransmite.
 *
 * Es agnóstico del proceso: se engancha al `upgrade` de cualquier
 * `http.Server` (`handleUpgrade`) o levanta el suyo (`listen`). La sesión y el
 * permiso se resuelven en el handshake con las mismas funciones que las rutas
 * REST (`resolveActor` + `RoomDraftService.checkAccess`).
 */
/** Update de otro proceso `editor-sync` (o de un writer sin sesión viva) recibido por Redis. */
export type RemoteDraftUpdate = { roomId: string; update: Uint8Array; originId: string };

/**
 * Puerto de propagación ENTRE procesos `editor-sync` (specs/09 §2, decisión
 * 2026-09-23): el adaptador es `@escaperoom/kit/room-sync` (Redis pub/sub),
 * inyectado desde `createWebEditorSyncServer`. La publicación hacia otros
 * procesos NO pasa por aquí — la hace `RoomDraftService.appendUpdate` al
 * persistir (así cubre también las escrituras del MCP/REST sin sesión viva
 * en este proceso); este puerto es solo para RECIBIR lo que otros publicaron.
 */
export type RemoteDraftSync = {
  /** Se suscribe a updates de otros procesos; devuelve una función para desuscribirse. */
  subscribe(onUpdate: (event: RemoteDraftUpdate) => void): () => void;
  /** Id de ESTE proceso: los eventos con este `originId` son un eco propio y se ignoran. */
  originId: string;
};

export type EditorSyncServerOptions = {
  drafts: RoomDraftService;
  /** Deriva el actor de la petición HTTP de upgrade (cookies / Authorization). */
  resolveActor: (request: IncomingMessage) => Promise<Actor>;
  /** Si se indica, se rechaza (403) todo `Origin` presente que no esté en la lista. */
  allowedOrigins?: readonly string[];
  /** Tamaño máximo de un mensaje WebSocket (por defecto, el máximo de un update + margen). */
  maxMessageBytes?: number;
  /** Intervalo de ping para detectar conexiones muertas (0 lo desactiva). */
  pingIntervalMs?: number;
  logger?: Pick<Console, "warn" | "error">;
  /**
   * Canal de sincronización entre procesos (Redis). Sin él, este proceso solo
   * ve lo que pasa por sus propios WebSockets y `applyUpdate` — sigue
   * funcionando para sus clientes conectados, pero no se entera de updates
   * escritos en otro proceso hasta que el cliente recarga.
   */
  remoteUpdates?: RemoteDraftSync;
};

/** Origen de una transacción aplicada porque llegó de OTRO proceso por Redis: nunca se repersiste ni se republica. */
const REMOTE_ORIGIN = Symbol("remote-draft-update");

const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024 + 1024;
const DEFAULT_PING_INTERVAL_MS = 30_000;

/** Códigos de cierre propios (rango 4000–4999 reservado a aplicaciones). */
export const CLOSE_PERSISTENCE_FAILED = 4500;
export const CLOSE_SERVER_SHUTDOWN = 1001;
const CLOSE_INVALID_DATA = 1007;

const STATUS_BY_CODE: Record<RoomDraftErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_UPDATE: 422,
};

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  413: "Payload Too Large",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/** Origen de una transacción sobre el doc vivo: quién la hizo (para persistir con su autoría). */
type ActorOrigin = { actor: Actor };

type Connection = ActorOrigin & {
  socket: WebSocket;
  /** `clientID`s de awareness controlados por esta conexión. */
  awarenessIds: Set<number>;
  alive: boolean;
};

type SyncRoom = {
  roomId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connections: Map<WebSocket, Connection>;
  /** Upgrades autorizados que aún no se han convertido en conexión. */
  pending: number;
  /** Cadena de persistencia: los updates se escriben en el orden en que se integraron. */
  persisting: Promise<void>;
  closed: boolean;
};

export type EditorSyncServer = {
  /** Manejador del evento `upgrade` de un `http.Server`. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Levanta un `http.Server` propio (puerto 0 = libre). */
  listen(port: number, host?: string): Promise<{ port: number; server: Server }>;
  /**
   * Restaura el draft a un punto del historial: calcula el update de
   * restauración (3.2) y lo aplica sobre el doc vivo, que lo difunde a los
   * clientes y lo persiste como un update más (la historia no se borra).
   */
  restore(actor: Actor, roomId: string, target: RestoreTarget): Promise<{ changed: boolean }>;
  /**
   * Integra un update producido fuera de la sesión (p. ej. una tool del MCP,
   * ticket 4.2) con la autoría del actor: si la sala tiene doc vivo se aplica
   * sobre él —se difunde a los editores conectados y se persiste por la misma
   * cola que sus updates—; si no, se persiste directamente con el servicio del
   * draft (3.2). Misma autorización que el handshake.
   */
  applyUpdate(actor: Actor, roomId: string, update: Uint8Array): Promise<void>;
  /** Salas con doc cargado en memoria (diagnóstico/tests). */
  loadedRooms(): string[];
  /** Cierra conexiones, espera a que termine la persistencia pendiente y libera memoria. */
  close(): Promise<void>;
};

export function createEditorSyncServer(options: EditorSyncServerOptions): EditorSyncServer {
  const { drafts, resolveActor } = options;
  const logger = options.logger ?? console;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
  });
  const rooms = new Map<string, SyncRoom>();
  const loading = new Map<string, Promise<SyncRoom>>();
  let ownServer: Server | null = null;
  let shuttingDown = false;

  /**
   * Aplica un update recibido de OTRO proceso al doc vivo de la sala, si esta
   * la tiene cargada (si no, nadie conectado a este proceso necesita verlo:
   * cuando alguien la abra aquí, la recargará de Postgres, donde el proceso
   * de origen ya lo persistió). Con `REMOTE_ORIGIN` el handler de `doc.on
   * ("update")` de abajo difunde a los clientes de este proceso pero NO
   * vuelve a persistir ni a republicar — evita el bucle de reenvío.
   */
  function applyRemoteUpdate(event: RemoteDraftUpdate): void {
    if (options.remoteUpdates && event.originId === options.remoteUpdates.originId) return;
    const room = rooms.get(event.roomId);
    if (!room || room.closed) return;
    try {
      Y.applyUpdate(room.doc, event.update, REMOTE_ORIGIN);
    } catch (err) {
      logger.warn(`[editor-sync] update remoto inválido en ${event.roomId}`, err);
    }
  }

  const unsubscribeRemote = options.remoteUpdates?.subscribe(applyRemoteUpdate);

  const pingTimer =
    pingIntervalMs > 0
      ? setInterval(() => {
          for (const room of rooms.values()) {
            for (const conn of room.connections.values()) {
              if (!conn.alive) {
                conn.socket.terminate();
                continue;
              }
              conn.alive = false;
              conn.socket.ping();
            }
          }
        }, pingIntervalMs)
      : null;
  pingTimer?.unref();

  function send(conn: Connection, message: Uint8Array): void {
    if (conn.socket.readyState !== WebSocket.OPEN) return;
    conn.socket.send(message, (err) => {
      if (err) conn.socket.terminate();
    });
  }

  function broadcast(room: SyncRoom, message: Uint8Array, except?: unknown): void {
    for (const conn of room.connections.values()) {
      if (conn !== except) send(conn, message);
    }
  }

  function isActorOrigin(origin: unknown): origin is ActorOrigin {
    return typeof origin === "object" && origin !== null && "actor" in origin;
  }

  /** Conexión que hoy controla ese `clientID` de awareness en la sala, si alguna. */
  function awarenessOwner(room: SyncRoom, clientId: number): Connection | undefined {
    for (const conn of room.connections.values()) {
      if (conn.awarenessIds.has(clientId)) return conn;
    }
    return undefined;
  }

  /**
   * Filtra un update de awareness sin decodificar sus estados (mismo formato
   * de cable que `encodeAwarenessUpdate`/`applyAwarenessUpdate` de
   * `y-protocols`), quedándose solo con las entradas cuyo `clientID` pase
   * `allow`. `null` si no queda ninguna.
   */
  function filterAwarenessUpdate(
    update: Uint8Array,
    allow: (clientId: number) => boolean,
  ): Uint8Array | null {
    const decoder = decoding.createDecoder(update);
    const len = decoding.readVarUint(decoder);
    const kept: { clientId: number; clock: number; state: string }[] = [];
    for (let i = 0; i < len; i++) {
      const clientId = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      const state = decoding.readVarString(decoder);
      if (allow(clientId)) kept.push({ clientId, clock, state });
    }
    if (kept.length === 0) return null;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, kept.length);
    for (const entry of kept) {
      encoding.writeVarUint(encoder, entry.clientId);
      encoding.writeVarUint(encoder, entry.clock);
      encoding.writeVarString(encoder, entry.state);
    }
    return encoding.toUint8Array(encoder);
  }

  /**
   * Si falla la persistencia, el doc en memoria tiene cambios que no están en
   * Postgres. Se descarta la sala y se cierran sus conexiones: al reconectar,
   * el doc se recarga de la base de datos y el sync step 2 de cada cliente
   * vuelve a enviar lo que falte, que entonces sí se persiste.
   */
  function failRoom(room: SyncRoom, err: unknown): void {
    if (room.closed) return;
    logger.error(`[editor-sync] persistencia fallida en la sala ${room.roomId}`, err);
    destroyRoom(room);
    for (const conn of room.connections.values()) {
      conn.socket.close(CLOSE_PERSISTENCE_FAILED, "persistence failed");
    }
  }

  function destroyRoom(room: SyncRoom): void {
    room.closed = true;
    if (rooms.get(room.roomId) === room) rooms.delete(room.roomId);
    room.awareness.destroy();
    room.doc.destroy();
  }

  function createRoom(roomId: string, doc: Y.Doc): SyncRoom {
    const awareness = new awarenessProtocol.Awareness(doc);
    // El servidor no es un colaborador: no publica estado propio.
    awareness.setLocalState(null);
    const room: SyncRoom = {
      roomId,
      doc,
      awareness,
      connections: new Map(),
      pending: 0,
      persisting: Promise.resolve(),
      closed: false,
    };

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      broadcast(room, encoding.toUint8Array(encoder), origin);
      if (!isActorOrigin(origin)) return;
      const { actor } = origin;
      room.persisting = room.persisting
        .then(async () => {
          if (room.closed) return;
          await drafts.appendUpdate(actor, roomId, update);
        })
        .catch((err: unknown) => failRoom(room, err));
    });

    awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const conn = isActorOrigin(origin) && "socket" in origin ? (origin as Connection) : null;
        if (conn && room.connections.get(conn.socket) === conn) {
          for (const id of added) conn.awarenessIds.add(id);
          for (const id of removed) conn.awarenessIds.delete(id);
        }
        const changed = [...added, ...updated, ...removed];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
        );
        broadcast(room, encoding.toUint8Array(encoder));
      },
    );

    return room;
  }

  /** Doc vivo de la sala; lo carga desde persistencia la primera vez. */
  async function getRoom(actor: Actor, roomId: string): Promise<SyncRoom> {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    let promise = loading.get(roomId);
    if (!promise) {
      promise = drafts
        .loadDraft(actor, roomId)
        .then((draft) => {
          const room = createRoom(roomId, buildDraftDoc(draft));
          rooms.set(roomId, room);
          return room;
        })
        .finally(() => loading.delete(roomId));
      loading.set(roomId, promise);
    }
    return promise;
  }

  /** Libera la sala cuando se va el último editor (tras persistir y compactar). */
  function releaseIfIdle(room: SyncRoom, lastActor: Actor): void {
    if (room.connections.size > 0 || room.pending > 0 || room.closed) return;
    void room.persisting.then(async () => {
      if (room.connections.size > 0 || room.pending > 0 || room.closed) return;
      destroyRoom(room);
      try {
        await drafts.compact(lastActor, room.roomId);
      } catch (err) {
        logger.warn(`[editor-sync] no se pudo compactar la sala ${room.roomId}`, err);
      }
    });
  }

  async function restoreInRoom(
    room: SyncRoom | undefined,
    actor: Actor,
    roomId: string,
    target: RestoreTarget,
  ): Promise<{ changed: boolean }> {
    if (!room || room.closed) {
      const result = await drafts.restoreDraft(actor, roomId, target);
      return { changed: result !== null };
    }
    // C-21: el plan se calcula contra el doc VIVO (`planRestoreAgainstDoc`),
    // no contra lo persistido en Postgres. Solo el punto `target` —historia
    // inmutable— viaja a BD; el lado "actual" del diff se lee de `room.doc`
    // de forma síncrona en el mismo tick en que se calcula el update (sin
    // await entre leerlo y aplicarlo más abajo), así que no queda ventana
    // para que una edición concurrente se aplique al doc entre que se calcula
    // el plan y se aplica, y se pierda o se aplique sobre una base obsoleta.
    const update = await drafts.planRestore(actor, roomId, target);
    if (!update) return { changed: false };
    if (room.closed) {
      const result = await drafts.restoreDraft(actor, roomId, target);
      return { changed: result !== null };
    }
    const origin: ActorOrigin = { actor };
    Y.applyUpdate(room.doc, update, origin);
    await room.persisting;
    return { changed: true };
  }

  function handleMessage(room: SyncRoom, conn: Connection, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
        if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
        return;
      }
      case MESSAGE_AWARENESS: {
        // C-21: una conexión solo puede tocar `clientID`s que ya controla o
        // que nadie más controla todavía (su primer anuncio de presencia) —
        // nunca los de otra conexión, o cualquier cliente podría suplantar el
        // cursor/estado de otro editor.
        const filtered = filterAwarenessUpdate(
          decoding.readVarUint8Array(decoder),
          (clientId) => {
            const owner = awarenessOwner(room, clientId);
            return owner === undefined || owner === conn;
          },
        );
        if (filtered) awarenessProtocol.applyAwarenessUpdate(room.awareness, filtered, conn);
        return;
      }
      case MESSAGE_QUERY_AWARENESS: {
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, [
            ...room.awareness.getStates().keys(),
          ]),
        );
        send(conn, encoding.toUint8Array(encoder));
        return;
      }
      case MESSAGE_RESTORE: {
        const { requestId, payload } = readRestorePayload(decoder);
        const target = parseRestoreRequest(payload);
        const reply = (response: RestoreResponse) =>
          send(conn, encodeRestoreResponse(requestId, response));
        if (!target) {
          reply({ ok: false, code: "INVALID_REQUEST", message: "Punto de restauración inválido" });
          return;
        }
        restoreInRoom(room, conn.actor, room.roomId, target).then(
          ({ changed }) => reply({ ok: true, changed }),
          (err: unknown) => {
            if (err instanceof RoomDraftError) {
              reply({ ok: false, code: err.code, message: err.message });
            } else {
              logger.error(`[editor-sync] restauración fallida en ${room.roomId}`, err);
              reply({ ok: false, code: "INTERNAL", message: "Error interno al restaurar" });
            }
          },
        );
        return;
      }
      default:
        // Tipos desconocidos (p. ej. `auth` de y-websocket): se ignoran.
        return;
    }
  }

  function setupConnection(room: SyncRoom, socket: WebSocket, actor: Actor): void {
    const conn: Connection = { socket, actor, awarenessIds: new Set(), alive: true };
    room.connections.set(socket, conn);
    socket.binaryType = "nodebuffer";

    socket.on("pong", () => {
      conn.alive = true;
    });
    socket.on("message", (raw: RawData) => {
      if (room.closed) return;
      try {
        handleMessage(room, conn, toUint8Array(raw));
      } catch (err) {
        logger.warn(`[editor-sync] mensaje inválido en ${room.roomId}`, err);
        socket.close(CLOSE_INVALID_DATA, "invalid message");
      }
    });
    socket.on("close", () => {
      room.connections.delete(socket);
      if (!room.closed && conn.awarenessIds.size > 0) {
        awarenessProtocol.removeAwarenessStates(room.awareness, [...conn.awarenessIds], null);
      }
      releaseIfIdle(room, actor);
    });

    // Sync step 1 del servidor + awareness actual de los demás.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(conn, encoding.toUint8Array(encoder));
    const states = room.awareness.getStates();
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      send(conn, encoding.toUint8Array(awarenessEncoder));
    }
  }

  function rejectUpgrade(socket: Duplex, status: number): void {
    if (!socket.writable) {
      socket.destroy();
      return;
    }
    const text = STATUS_TEXT[status] ?? "Error";
    socket.end(
      `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
    );
  }

  async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (shuttingDown) return rejectUpgrade(socket, 503);
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(SYNC_PATH_PREFIX)) return rejectUpgrade(socket, 404);
    let roomId: string;
    try {
      roomId = decodeURIComponent(url.pathname.slice(SYNC_PATH_PREFIX.length));
    } catch {
      return rejectUpgrade(socket, 400);
    }
    const origin = request.headers.origin;
    if (options.allowedOrigins && origin && !options.allowedOrigins.includes(origin)) {
      return rejectUpgrade(socket, 403);
    }

    let room: SyncRoom;
    let actor: Actor;
    try {
      actor = await resolveActor(request);
      await drafts.checkAccess(actor, roomId);
      room = await getRoom(actor, roomId);
      // Si la sala se liberó justo ahora (último editor saliendo), se recarga.
      if (room.closed) room = await getRoom(actor, roomId);
    } catch (err) {
      if (err instanceof RoomDraftError) return rejectUpgrade(socket, STATUS_BY_CODE[err.code]);
      logger.error(`[editor-sync] handshake fallido para ${roomId}`, err);
      return rejectUpgrade(socket, 500);
    }
    if (room.closed || shuttingDown) return rejectUpgrade(socket, 503);

    room.pending++;
    wss.handleUpgrade(request, socket, head, (ws) => {
      room.pending--;
      if (room.closed) {
        ws.close(CLOSE_PERSISTENCE_FAILED, "room closed");
        return;
      }
      setupConnection(room, ws, actor);
    });
  }

  return {
    handleUpgrade(request, socket, head) {
      socket.on("error", () => socket.destroy());
      upgrade(request, socket, head).catch((err: unknown) => {
        logger.error("[editor-sync] error en upgrade", err);
        socket.destroy();
      });
    },

    async listen(port, host) {
      const server = createServer((_req, res) => {
        res.writeHead(426, { "Content-Type": "text/plain" }).end("Upgrade Required");
      });
      server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      ownServer = server;
      return { port: (server.address() as AddressInfo).port, server };
    },

    async restore(actor, roomId, target) {
      await drafts.checkAccess(actor, roomId);
      return restoreInRoom(rooms.get(roomId), actor, roomId, target);
    },

    async applyUpdate(actor, roomId, update) {
      await drafts.checkAccess(actor, roomId);
      const room = rooms.get(roomId);
      if (!room || room.closed) {
        await drafts.appendUpdate(actor, roomId, update);
        return;
      }
      const origin: ActorOrigin = { actor };
      Y.applyUpdate(room.doc, update, origin);
      await room.persisting;
    },

    loadedRooms() {
      return [...rooms.keys()];
    },

    async close() {
      shuttingDown = true;
      unsubscribeRemote?.();
      if (pingTimer) clearInterval(pingTimer);
      const all = [...rooms.values()];
      for (const room of all) {
        for (const conn of room.connections.values()) {
          conn.socket.close(CLOSE_SERVER_SHUTDOWN, "server shutdown");
        }
      }
      await Promise.all(all.map((room) => room.persisting));
      for (const room of all) {
        for (const conn of room.connections.values()) conn.socket.terminate();
        if (!room.closed) destroyRoom(room);
      }
      wss.close();
      if (ownServer) {
        const server = ownServer;
        ownServer = null;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}

function toUint8Array(raw: RawData): Uint8Array {
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}
