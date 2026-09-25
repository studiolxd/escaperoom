import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import {
  DEFAULT_MAX_UPDATE_BYTES,
  RoomDraftError,
  buildDraftDoc,
  isValidYjsUpdate,
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
  /** Si se indica, se rechaza (403) todo `Origin` que no esté en la lista. */
  allowedOrigins?: readonly string[];
  /**
   * Si es `true`, SIN `allowedOrigins` se falla cerrado (C-10): solo se acepta
   * un `Origin` ausente (cliente sin cookie, p. ej. Bearer) o igual al `Host`
   * de la petición, en vez de aceptar cualquiera. Actívese en producción — un
   * despliegue real sin `EDITOR_SYNC_ALLOWED_ORIGINS`/`NEXT_PUBLIC_APP_URL`
   * debe negarse a aceptar orígenes arbitrarios en vez de degradar en
   * silencio. Con `allowedOrigins` configurado, este flag no hace nada.
   */
  strictOriginWithoutAllowlist?: boolean;
  /**
   * Tamaño máximo de un mensaje WebSocket (por defecto, `maxUpdateBytes`: un
   * mensaje más grande no podría contener un update válido de todos modos, y
   * mantenerlo igual evita la ventana de C-12 en la que un mensaje cabía en
   * `maxPayload` pero superaba `maxUpdateBytes`).
   */
  maxMessageBytes?: number;
  /**
   * Tamaño máximo de un único update Yjs (C-12): se valida ANTES de
   * aplicarlo al doc vivo, así que un update que lo supere nunca llega a
   * mutar el estado compartido ni a difundirse — solo se cierra ese socket.
   * Por defecto, el mismo límite que `RoomDraftService.appendUpdate`
   * (`DEFAULT_MAX_UPDATE_BYTES`); si se pasa un valor distinto al del
   * servicio de persistencia, un update podría pasar aquí y fallar igualmente
   * al persistir — mantenerlos iguales.
   */
  maxUpdateBytes?: number;
  /** Tope de bytes del doc (tras compactar) que un socket puede seguir aumentando (C-11). */
  maxDocBytes?: number;
  /** Conexiones simultáneas por `userId` en la misma sala (C-11): protege de un mismo usuario agotando memoria con muchas pestañas/scripts. */
  maxConnectionsPerUser?: number;
  /**
   * Mensajes por segundo que admite un socket antes de cerrarlo (C-11), SIN
   * contar `MESSAGE_AWARENESS` (tiene su propio cubo, ver
   * `maxAwarenessMessagesPerSecond`): cubre `syncStep2`/`update`,
   * `MESSAGE_QUERY_AWARENESS` y `MESSAGE_RESTORE`. Ver
   * `DEFAULT_MAX_MESSAGES_PER_SECOND` para cómo se fijó el valor por defecto.
   */
  maxMessagesPerSecond?: number;
  /**
   * Mensajes `MESSAGE_AWARENESS` (cursor/selección de otros editores) por
   * segundo que admite un socket (C-11): cubo aparte del genérico de arriba
   * — el objetivo de C-11 es frenar abusos, no penalizar presencia legítima
   * de alta frecuencia (cursores) compartiendo cupo con las escrituras al doc.
   */
  maxAwarenessMessagesPerSecond?: number;
  /** `syncStep1` (fuerza `encodeStateAsUpdate` del doc entero) por minuto que admite un socket (C-11). */
  maxSyncStep1PerMinute?: number;
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

const DEFAULT_PING_INTERVAL_MS = 30_000;
/** Doc de una sala de tamaño normal ronda cientos de KB; 20 MB da margen sin dejar crecer sin tope (C-11). */
const DEFAULT_MAX_DOC_BYTES = 20 * 1024 * 1024;
/** Un mismo usuario editando desde varias pestañas/dispositivos no suele pasar de un puñado (C-11). */
const DEFAULT_MAX_CONNECTIONS_PER_USER = 8;
/**
 * C-11, revisado tras la review de la coordinadora en la PR #159: el pico
 * REAL de mensajes/s de un editor legítimo no es un número inventado, es
 * medible en el propio cliente — `STROKE_FLUSH_INTERVAL_MS` (ver
 * `room-doc/tool-controller.ts`, auditoría D-17) limita el pincel/borrador a
 * como mucho un volcado de trazo (una transacción Yjs = un mensaje WS) cada
 * 32 ms, es decir `1000 / 32 ≈ 31,3` mensajes/s sostenidos durante una
 * pincelada continua — el único origen de tráfico de alta frecuencia que
 * escribe hoy en el doc (colocar/decorar/antorcha son un mensaje por clic;
 * arrastrar un objeto no toca el doc hasta soltar). El límite anterior (50)
 * daba un margen de ×1,6 sobre ese pico: de sobra en el caso medio, pero sin
 * margen para jitter del `setInterval`/reloj del navegador ni para una
 * pincelada en el instante exacto en que además llega un `MESSAGE_RESTORE` o
 * un `MESSAGE_QUERY_AWARENESS` (que SÍ comparten este cubo, ver más abajo).
 * Se fija ×4 sobre el pico medido — el test de regresión
 * "trazo realista de pincel + awareness no provoca cierre" en `test/sync.test.ts`
 * reproduce ese pico exacto contra el valor por defecto (sin overrides) y
 * comprueba que no se corta. `MESSAGE_AWARENESS` NO cuenta aquí — tiene su
 * propio cubo, ver `DEFAULT_MAX_AWARENESS_MESSAGES_PER_SECOND`.
 */
export const DEFAULT_MAX_MESSAGES_PER_SECOND = 120;
/**
 * Todavía no hay UI de presencia (cursor/selección de otros editores) que
 * emita `MESSAGE_AWARENESS` en el cliente — cuando se implemente, medirá su
 * propio pico real con la misma metodología que `STROKE_FLUSH_INTERVAL_MS` de
 * arriba y este valor se revisará entonces. Mientras tanto se deja un cupo
 * generoso (los presence-cursors de otros editores colaborativos suelen
 * throttlear entre 10 y 30 Hz en el cliente) para no acoplar por adelantado
 * un límite de servidor a una implementación que aún no existe.
 */
export const DEFAULT_MAX_AWARENESS_MESSAGES_PER_SECOND = 60;
/**
 * `EditorSyncProvider` reconecta con backoff exponencial (100 ms → 10 s, ver
 * `sync/provider.ts`): incluso en el peor caso de una red que parpadea sin
 * parar (cada intento conecta y se cae al instante, reiniciando el backoff),
 * el número de reconexiones LOGRADAS —las únicas que mandan `syncStep1`— en
 * un minuto no se acerca a este tope; se deja ×2 de margen sobre esa
 * estimación para no cortar una reconexión legítima tras un corte de red.
 */
export const DEFAULT_MAX_SYNC_STEP1_PER_MINUTE = 30;

/** Códigos de cierre propios (rango 4000–4999 reservado a aplicaciones). */
export const CLOSE_PERSISTENCE_FAILED = 4500;
export const CLOSE_SERVER_SHUTDOWN = 1001;
const CLOSE_INVALID_DATA = 1007;
/** Update sintácticamente inválido o que supera `maxUpdateBytes` (C-12): se cierra solo ese socket. */
const CLOSE_UPDATE_REJECTED = 1009;
/** Límite de conexiones, mensajes/s, `syncStep1`/min o bytes del doc superado (C-11). */
const CLOSE_POLICY_VIOLATION = 1008;

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
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/**
 * Cubo de tokens simple para limitar la cadencia de un socket (C-11): se
 * recarga de forma continua (no por ventanas fijas), así que un socket que
 * lleva un rato callado no acumula una ráfaga desproporcionada.
 */
class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  tryTake(now = Date.now()): boolean {
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillPerMs);
      this.lastRefillMs = now;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Origen de una transacción sobre el doc vivo: quién la hizo (para persistir con su autoría). */
type ActorOrigin = { actor: Actor };

type Connection = ActorOrigin & {
  socket: WebSocket;
  /** `clientID`s de awareness controlados por esta conexión. */
  awarenessIds: Set<number>;
  alive: boolean;
  /** C-11: cadencia de mensajes (sin awareness), de awareness y de `syncStep1` de ESTA conexión. */
  messageBucket: TokenBucket;
  awarenessBucket: TokenBucket;
  syncStep1Bucket: TokenBucket;
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
  /**
   * Tamaño aproximado del doc (C-11): bytes del último snapshot compactado
   * conocido + bytes de los updates aplicados desde entonces. Es una cota
   * superior barata (no reencode el doc en cada mensaje, que es justo lo que
   * evita C-9/C-11): tras compactar se recalibra al tamaño real del
   * snapshot, así que no crece sin límite aunque la estimación se desvíe un
   * poco entre compactaciones.
   */
  docBytes: number;
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
  const maxUpdateBytes = options.maxUpdateBytes ?? DEFAULT_MAX_UPDATE_BYTES;
  const maxDocBytes = options.maxDocBytes ?? DEFAULT_MAX_DOC_BYTES;
  const maxConnectionsPerUser = options.maxConnectionsPerUser ?? DEFAULT_MAX_CONNECTIONS_PER_USER;
  const maxMessagesPerSecond = options.maxMessagesPerSecond ?? DEFAULT_MAX_MESSAGES_PER_SECOND;
  const maxAwarenessMessagesPerSecond =
    options.maxAwarenessMessagesPerSecond ?? DEFAULT_MAX_AWARENESS_MESSAGES_PER_SECOND;
  const maxSyncStep1PerMinute = options.maxSyncStep1PerMinute ?? DEFAULT_MAX_SYNC_STEP1_PER_MINUTE;
  const wss = new WebSocketServer({
    noServer: true,
    // C-12: nunca por encima de `maxUpdateBytes` — así un mensaje que cupiera
    // en `maxPayload` pero superase el límite de update ya ni siquiera llega
    // a `message` (lo cierra `ws`); la comprobación explícita de más abajo
    // sigue ahí como defensa en profundidad y para dar un código propio.
    maxPayload: options.maxMessageBytes ?? maxUpdateBytes,
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
      // Coste único al cargar la sala (no en el camino caliente de cada mensaje).
      docBytes: Y.encodeStateAsUpdate(doc).byteLength,
    };

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      broadcast(room, encoding.toUint8Array(encoder), origin);
      if (!isActorOrigin(origin)) return;
      const { actor } = origin;
      room.docBytes += update.byteLength;
      room.persisting = room.persisting
        .then(async () => {
          if (room.closed) return;
          const result = await drafts.appendUpdate(actor, roomId, update);
          // Recalibra al tamaño real del snapshot recién compactado (C-11):
          // corrige la desviación de la estimación incremental de arriba.
          if (result.snapshot) room.docBytes = result.snapshot.byteSize;
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
    const update = await drafts.planRestoreAgainstDoc(actor, roomId, target, room.doc);
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
        const syncType = decoding.readVarUint(decoder);
        if (syncType === syncProtocol.messageYjsSyncStep1) {
          // C-11: `syncStep1` fuerza `encodeStateAsUpdate` del doc entero en
          // la respuesta — más caro que un update normal, así que tiene su
          // propio cubo (más estrecho) además del genérico de mensajes/s.
          if (!conn.syncStep1Bucket.tryTake()) {
            conn.socket.close(CLOSE_POLICY_VIOLATION, "too many syncStep1");
            return;
          }
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.writeSyncStep2(encoder, room.doc, decoding.readVarUint8Array(decoder));
          if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
          return;
        }
        if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
          // C-12: se valida tamaño y forma ANTES de tocar el doc vivo — con el
          // orden anterior (aplicar y validar al persistir) un update entre
          // `maxUpdateBytes` y `maxPayload` se integraba y difundía, y solo
          // fallaba al guardar, lo que expulsaba a TODOS los editores
          // (`failRoom`) por un mensaje reproducible en bucle al reconectar.
          const update = decoding.readVarUint8Array(decoder);
          if (update.byteLength > maxUpdateBytes || !isValidYjsUpdate(update)) {
            conn.socket.close(CLOSE_UPDATE_REJECTED, "invalid or oversized update");
            return;
          }
          // C-11: tope de bytes del doc (tras compactar) que un socket puede
          // seguir empujando — se comprueba antes de aplicar, así un doc que
          // ya está en el límite rechaza el update en vez de crecer sin fin.
          if (room.docBytes + update.byteLength > maxDocBytes) {
            conn.socket.close(CLOSE_POLICY_VIOLATION, "doc size limit reached");
            return;
          }
          Y.applyUpdate(room.doc, update, conn);
          return;
        }
        // Subtipo de sync desconocido: se ignora (paridad con el `default` de abajo).
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
    const conn: Connection = {
      socket,
      actor,
      awarenessIds: new Set(),
      alive: true,
      messageBucket: new TokenBucket(maxMessagesPerSecond, maxMessagesPerSecond / 1000),
      awarenessBucket: new TokenBucket(
        maxAwarenessMessagesPerSecond,
        maxAwarenessMessagesPerSecond / 1000,
      ),
      syncStep1Bucket: new TokenBucket(maxSyncStep1PerMinute, maxSyncStep1PerMinute / 60_000),
    };
    room.connections.set(socket, conn);
    socket.binaryType = "nodebuffer";

    socket.on("pong", () => {
      conn.alive = true;
    });
    socket.on("message", (raw: RawData) => {
      if (room.closed) return;
      const data = toUint8Array(raw);
      // C-11: cadencia por tipo de mensaje, antes de procesar nada — se
      // detecta el tipo (un varuint) sin decodificar el resto. `MESSAGE_AWARENESS`
      // tiene su propio cubo, más generoso (ver `maxAwarenessMessagesPerSecond`):
      // no comparte cupo con las escrituras al doc para no penalizar presencia
      // legítima de alta frecuencia con el límite pensado para frenar abusos.
      let messageType: number;
      try {
        messageType = decoding.readVarUint(decoding.createDecoder(data));
      } catch (err) {
        logger.warn(`[editor-sync] mensaje inválido en ${room.roomId}`, err);
        socket.close(CLOSE_INVALID_DATA, "invalid message");
        return;
      }
      const bucket = messageType === MESSAGE_AWARENESS ? conn.awarenessBucket : conn.messageBucket;
      if (!bucket.tryTake()) {
        socket.close(
          CLOSE_POLICY_VIOLATION,
          messageType === MESSAGE_AWARENESS ? "too many awareness updates" : "too many messages",
        );
        return;
      }
      try {
        handleMessage(room, conn, data);
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

  /**
   * C-10: antes, sin `allowedOrigins` configurado se aceptaba cualquier
   * `Origin` (o su ausencia), así que un despliegue que arrancara sin
   * `EDITOR_SYNC_ALLOWED_ORIGINS`/`NEXT_PUBLIC_APP_URL` quedaba abierto a
   * cross-site WebSocket hijacking (la identidad viaja por cookie,
   * `SameSite=Lax` la envía igual en upgrades GET de otro sitio). Con lista
   * configurada se mantiene el comportamiento histórico: un `Origin` ausente
   * se acepta (clientes no-navegador — MCP, scripts — con cookie/Authorization
   * pero sin ese header) y uno presente debe pertenecer a la lista. Sin
   * lista, falla cerrado si `strictOriginWithoutAllowlist` lo pide: con
   * cookie, `Origin` pasa a ser obligatorio (un navegador real SIEMPRE lo
   * envía en un upgrade con cookie, así que su ausencia aquí solo puede venir
   * de un cliente no-navegador reproduciéndola fuera de uno); sin cookie,
   * solo se acepta el mismo `Host` que el propio servidor.
   */
  function isOriginAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (options.allowedOrigins) return !origin || options.allowedOrigins.includes(origin);
    if (!options.strictOriginWithoutAllowlist) return true;
    if (request.headers.cookie && !origin) return false;
    if (!origin) return true;
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
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
    if (!isOriginAllowed(request)) return rejectUpgrade(socket, 403);

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

    // C-11: cap de conexiones por usuario en la sala — un mismo usuario ya
    // autorizado (solo el autor del borrador llega hasta aquí) no puede
    // agotar memoria del proceso abriendo sockets sin límite.
    let connectionsForActor = 0;
    for (const conn of room.connections.values()) {
      if (conn.actor.userId === actor.userId) connectionsForActor++;
    }
    if (connectionsForActor >= maxConnectionsPerUser) return rejectUpgrade(socket, 429);

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
      // C-12: misma validación que el mensaje WS — sin sala viva ya la hacía
      // `drafts.appendUpdate`, pero aplicar directo al doc vivo se la saltaba
      // y dejaba el mismo bucle de `failRoom` para un caller (MCP/REST) que
      // reintente el mismo update tras la desconexión de todos los editores.
      if (update.byteLength > maxUpdateBytes) {
        throw new RoomDraftError(
          "PAYLOAD_TOO_LARGE",
          `El update supera el máximo de ${maxUpdateBytes} bytes`,
        );
      }
      if (!isValidYjsUpdate(update)) {
        throw new RoomDraftError("INVALID_UPDATE", "El update no es un update Yjs válido");
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
