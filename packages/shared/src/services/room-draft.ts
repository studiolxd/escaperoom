import * as Y from "yjs";
import { isAnonymous, type Actor } from "./actor";

/**
 * Borrador colaborativo de una sala (specs/09 §2, specs/14 §5). El documento de
 * la sala ES un doc Yjs; PostgreSQL solo guarda sus updates binarios en
 * `roomUpdate` y, cada N updates, un snapshot compactado en `roomSnapshot`.
 *
 * Reconstruir el doc = último snapshot + updates con `id > updatesAppliedThrough`.
 * Los updates nunca se borran al compactar: son el historial (restauración).
 */

/** Snapshot compactado del doc: estado completo hasta `updatesAppliedThrough`. */
export type DraftSnapshot = {
  id: bigint;
  roomId: string;
  state: Uint8Array;
  /** Último `roomUpdate.id` incluido en `state`. */
  updatesAppliedThrough: bigint;
  createdAt: Date;
};

/** Update binario de Yjs tal y como se persiste en `roomUpdate`. */
export type DraftUpdate = {
  id: bigint;
  roomId: string;
  data: Uint8Array;
  /** `null` si lo generó el MCP u otro proceso sin usuario. */
  authorId: string | null;
  createdAt: Date;
};

/** Metadata de un snapshot, sin el estado binario (listado de historial). */
export type DraftSnapshotMeta = Omit<DraftSnapshot, "state"> & { byteSize: number };

/** Lo mínimo de `room` que necesita la autorización del draft. */
export type DraftRoomRef = { id: string; authorId: string };

/** Operaciones de lectura/escritura sobre las tablas del draft. */
export interface RoomDraftTx {
  /**
   * Snapshot más reciente; con `atOrBeforeUpdateId`, el más reciente cuyo
   * `updatesAppliedThrough <= atOrBeforeUpdateId` (restauración).
   */
  latestSnapshot(roomId: string, atOrBeforeUpdateId?: bigint): Promise<DraftSnapshot | null>;
  /**
   * Updates con `id > afterId` (y `id <= throughId` si se indica), en orden
   * ascendente de `id`.
   */
  updatesAfter(roomId: string, afterId: bigint, throughId?: bigint): Promise<DraftUpdate[]>;
  countUpdatesAfter(roomId: string, afterId: bigint): Promise<number>;
  insertUpdate(roomId: string, data: Uint8Array, authorId: string | null): Promise<DraftUpdate>;
  insertSnapshot(
    roomId: string,
    state: Uint8Array,
    updatesAppliedThrough: bigint,
  ): Promise<DraftSnapshot>;
}

/**
 * Puerto de persistencia del draft (ADR-022): el servicio no depende de Prisma.
 * `withRoomLock` serializa las escrituras de una misma sala (en Postgres, un
 * `SELECT … FOR UPDATE` sobre `room`) para que los `id` de `roomUpdate` de esa
 * sala se confirmen en orden y un snapshot nunca "salte" un update en vuelo.
 */
export interface RoomDraftStore extends RoomDraftTx {
  /** La sala viva (sin `deletedAt`), o `null` si no existe o está borrada. */
  findRoom(roomId: string): Promise<DraftRoomRef | null>;
  /** Da de alta una sala en borrador (`room` con `status = draft`) sin updates. */
  createRoom(input: { authorId: string; title: string }): Promise<DraftRoomRef>;
  /** Metadata de un snapshot concreto de la sala (sin estado), o `null`. */
  findSnapshot(roomId: string, snapshotId: bigint): Promise<Omit<DraftSnapshot, "state"> | null>;
  listSnapshots(roomId: string, limit: number): Promise<DraftSnapshotMeta[]>;
  withRoomLock<T>(roomId: string, fn: (tx: RoomDraftTx) => Promise<T>): Promise<T>;
}

export type RoomDraftErrorCode =
  "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_UPDATE" | "PAYLOAD_TOO_LARGE";

/** Error de dominio del draft; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class RoomDraftError extends Error {
  readonly code: RoomDraftErrorCode;
  constructor(code: RoomDraftErrorCode, message: string) {
    super(message);
    this.name = "RoomDraftError";
    this.code = code;
  }
}

/** Estado del draft para arrancar el editor: último snapshot + updates posteriores. */
export type RoomDraft = {
  roomId: string;
  snapshot: DraftSnapshot | null;
  updates: DraftUpdate[];
};

export type AppendUpdateResult = {
  update: Omit<DraftUpdate, "data">;
  /** Snapshot creado por la compactación periódica, si este update la disparó. */
  snapshot: DraftSnapshotMeta | null;
};

/**
 * Punto del historial al que restaurar: un snapshot (`GET …/history`) o un
 * `roomUpdate.id` concreto. `{ updateId: 0n }` = el doc vacío inicial.
 */
export type RestoreTarget = { snapshotId: bigint } | { updateId: bigint };

/** Cada cuántos updates desde el último snapshot se compacta (specs/09 §2). */
export const DEFAULT_SNAPSHOT_EVERY = 100;
/** Tamaño máximo de un update individual (un update de edición normal ocupa bytes/KB). */
export const DEFAULT_MAX_UPDATE_BYTES = 1024 * 1024;
/** Tamaño máximo de página del historial de snapshots. */
export const MAX_HISTORY_LIMIT = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aplica un draft (snapshot + updates) sobre un doc Yjs nuevo. */
export function buildDraftDoc(draft: Pick<RoomDraft, "snapshot" | "updates">): Y.Doc {
  const doc = new Y.Doc();
  Y.transact(doc, () => {
    if (draft.snapshot) Y.applyUpdate(doc, draft.snapshot.state);
    for (const update of draft.updates) Y.applyUpdate(doc, update.data);
  });
  return doc;
}

/** Estado completo del draft codificado como un único update Yjs. */
export function encodeDraftState(draft: Pick<RoomDraft, "snapshot" | "updates">): Uint8Array {
  const doc = buildDraftDoc(draft);
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** `true` si los bytes se decodifican como un update Yjs (v1) bien formado. */
export function isValidYjsUpdate(data: Uint8Array): boolean {
  if (data.byteLength === 0) return false;
  try {
    Y.decodeUpdate(data);
    return true;
  } catch {
    return false;
  }
}

function toMeta(snapshot: DraftSnapshot): DraftSnapshotMeta {
  return {
    id: snapshot.id,
    roomId: snapshot.roomId,
    updatesAppliedThrough: snapshot.updatesAppliedThrough,
    createdAt: snapshot.createdAt,
    byteSize: snapshot.state.byteLength,
  };
}

/**
 * Update Yjs que, aplicado sobre el estado actual, devuelve el CONTENIDO del
 * doc al del punto `target` sin reescribir la historia (specs/09 §2).
 *
 * Técnica: se reconstruye el doc en el punto objetivo, se aplica encima (en
 * una sola transacción rastreada por un `UndoManager` de alcance doc completo)
 * todo lo posterior, y se deshace esa transacción. Las operaciones de "deshacer"
 * son operaciones nuevas del CRDT (borran lo insertado después y re-crean lo
 * borrado después), así que el resultado es un update normal que se añade al
 * historial y que mergea con ediciones concurrentes. Devuelve `null` si no hay
 * nada que deshacer (el doc ya está en ese punto).
 */
export function buildRestoreUpdate(input: {
  target: Pick<RoomDraft, "snapshot" | "updates">;
  current: Pick<RoomDraft, "snapshot" | "updates">;
}): Uint8Array | null {
  const doc = buildDraftDoc(input.target);
  const tracked = Symbol("restore");
  const undo = new Y.UndoManager(doc, { trackedOrigins: new Set([tracked]), captureTimeout: 0 });
  // Con alcance doc completo el UndoManager apila aunque la transacción no
  // cambie nada: se detecta aparte si lo posterior al punto aporta algo.
  let changed = false;
  const onAfterTransaction = (tr: Y.Transaction) => {
    if (tr.origin === tracked) changed = tr.changed.size > 0 || tr.deleteSet.clients.size > 0;
  };
  doc.on("afterTransaction", onAfterTransaction);
  try {
    Y.transact(
      doc,
      () => {
        if (input.current.snapshot) Y.applyUpdate(doc, input.current.snapshot.state);
        for (const update of input.current.updates) Y.applyUpdate(doc, update.data);
      },
      tracked,
    );
    doc.off("afterTransaction", onAfterTransaction);
    if (!changed) return null;
    const before = Y.encodeStateVector(doc);
    while (undo.undoStack.length > 0) undo.undo();
    const update = Y.encodeStateAsUpdate(doc, before);
    const { structs, ds } = Y.decodeUpdate(update);
    return structs.length > 0 || ds.clients.size > 0 ? update : null;
  } finally {
    undo.destroy();
    doc.destroy();
  }
}

/**
 * Compacta dentro del lock: último snapshot + updates posteriores → nuevo
 * snapshot. Devuelve `null` si no hay updates nuevos que compactar.
 */
async function compactInTx(tx: RoomDraftTx, roomId: string): Promise<DraftSnapshot | null> {
  const snapshot = await tx.latestSnapshot(roomId);
  const updates = await tx.updatesAfter(roomId, snapshot?.updatesAppliedThrough ?? 0n);
  const last = updates.at(-1);
  if (!last) return null;
  const state = encodeDraftState({ snapshot, updates });
  return tx.insertSnapshot(roomId, state, last.id);
}

/**
 * Servicio del draft Yjs. Autorización: solo el autor de la sala lee o escribe
 * su draft (el modelo de datos de specs/14 aún no tiene coeditores).
 */
export function createRoomDraftService(deps: {
  store: RoomDraftStore;
  snapshotEvery?: number;
  maxUpdateBytes?: number;
}) {
  const { store } = deps;
  const snapshotEvery = deps.snapshotEvery ?? DEFAULT_SNAPSHOT_EVERY;
  const maxUpdateBytes = deps.maxUpdateBytes ?? DEFAULT_MAX_UPDATE_BYTES;

  /** Resuelve el `roomUpdate.id` hasta el que llega el punto de restauración. */
  async function resolveRestorePoint(roomId: string, target: RestoreTarget): Promise<bigint> {
    if ("snapshotId" in target) {
      const snapshot = await store.findSnapshot(roomId, target.snapshotId);
      if (!snapshot) throw new RoomDraftError("NOT_FOUND", "Snapshot no encontrado");
      return snapshot.updatesAppliedThrough;
    }
    if (target.updateId < 0n) throw new RoomDraftError("NOT_FOUND", "Update no encontrado");
    if (target.updateId === 0n) return 0n;
    const [update] = await store.updatesAfter(roomId, target.updateId - 1n, target.updateId);
    if (!update) throw new RoomDraftError("NOT_FOUND", "Update no encontrado");
    return update.id;
  }

  async function planRestoreInTx(
    tx: RoomDraftTx,
    roomId: string,
    through: bigint,
  ): Promise<Uint8Array | null> {
    const targetSnapshot = await tx.latestSnapshot(roomId, through);
    const targetUpdates = await tx.updatesAfter(
      roomId,
      targetSnapshot?.updatesAppliedThrough ?? 0n,
      through,
    );
    const snapshot = await tx.latestSnapshot(roomId);
    const updates = await tx.updatesAfter(roomId, snapshot?.updatesAppliedThrough ?? 0n);
    return buildRestoreUpdate({
      target: { snapshot: targetSnapshot, updates: targetUpdates },
      current: { snapshot, updates },
    });
  }

  async function appendInTx(
    tx: RoomDraftTx,
    roomId: string,
    data: Uint8Array,
    authorId: string | null,
  ): Promise<AppendUpdateResult> {
    const inserted = await tx.insertUpdate(roomId, data, authorId);
    const update = {
      id: inserted.id,
      roomId: inserted.roomId,
      authorId: inserted.authorId,
      createdAt: inserted.createdAt,
    };
    const latest = await tx.latestSnapshot(roomId);
    const pending = await tx.countUpdatesAfter(roomId, latest?.updatesAppliedThrough ?? 0n);
    const snapshot = pending >= snapshotEvery ? await compactInTx(tx, roomId) : null;
    return { update, snapshot: snapshot ? toMeta(snapshot) : null };
  }

  async function authorize(actor: Actor, roomId: string): Promise<DraftRoomRef> {
    if (isAnonymous(actor)) throw new RoomDraftError("UNAUTHORIZED", "No hay sesión");
    const room = UUID_RE.test(roomId) ? await store.findRoom(roomId) : null;
    if (!room) throw new RoomDraftError("NOT_FOUND", "Sala no encontrada");
    if (room.authorId !== actor.userId) {
      throw new RoomDraftError("FORBIDDEN", "No tienes permiso de edición sobre esta sala");
    }
    return room;
  }

  return {
    /**
     * Crea una sala en borrador del actor (su autor) con el update inicial del
     * doc Yjs, si se indica. El doc lo construye quien llama (editor o MCP) con
     * los comandos de la sala; el servicio solo persiste.
     */
    async createDraft(
      actor: Actor,
      input: { title: string; initialUpdate?: (roomId: string) => Uint8Array },
    ): Promise<DraftRoomRef> {
      if (isAnonymous(actor)) throw new RoomDraftError("UNAUTHORIZED", "No hay sesión");
      const room = await store.createRoom({ authorId: actor.userId, title: input.title });
      if (input.initialUpdate) {
        const data = input.initialUpdate(room.id);
        if (!isValidYjsUpdate(data)) {
          throw new RoomDraftError("INVALID_UPDATE", "El update inicial no es un update Yjs válido");
        }
        await store.withRoomLock(room.id, (tx) => appendInTx(tx, room.id, data, actor.userId));
      }
      return room;
    },

    /** `GET /api/rooms/:roomId/draft` — bootstrap del editor. */
    async loadDraft(actor: Actor, roomId: string): Promise<RoomDraft> {
      await authorize(actor, roomId);
      const snapshot = await store.latestSnapshot(roomId);
      const updates = await store.updatesAfter(roomId, snapshot?.updatesAppliedThrough ?? 0n);
      return { roomId, snapshot, updates };
    },

    /**
     * `POST /api/rooms/:roomId/update` — append de un update binario. Si con él
     * se alcanzan `snapshotEvery` updates desde el último snapshot, compacta en
     * la misma transacción.
     */
    async appendUpdate(
      actor: Actor,
      roomId: string,
      data: Uint8Array,
      opts: { authorId?: string | null } = {},
    ): Promise<AppendUpdateResult> {
      await authorize(actor, roomId);
      if (data.byteLength > maxUpdateBytes) {
        throw new RoomDraftError(
          "PAYLOAD_TOO_LARGE",
          `El update supera el máximo de ${maxUpdateBytes} bytes`,
        );
      }
      if (!isValidYjsUpdate(data)) {
        throw new RoomDraftError("INVALID_UPDATE", "El cuerpo no es un update Yjs válido");
      }
      const authorId = opts.authorId === undefined ? actor.userId : opts.authorId;

      return store.withRoomLock(roomId, (tx) => appendInTx(tx, roomId, data, authorId));
    },

    /**
     * Comprueba que el actor puede editar el draft (misma regla que las rutas
     * REST). La usa el handshake del WebSocket de edición (ticket 3.3).
     */
    async checkAccess(actor: Actor, roomId: string): Promise<void> {
      await authorize(actor, roomId);
    },

    /**
     * Calcula (sin escribir) el update que restaura el contenido del draft al
     * punto `target`. `null` si el doc ya está en ese punto. Lo usa el servidor
     * de sincronización para aplicarlo sobre el doc vivo y difundirlo.
     */
    async planRestore(
      actor: Actor,
      roomId: string,
      target: RestoreTarget,
    ): Promise<Uint8Array | null> {
      await authorize(actor, roomId);
      const through = await resolveRestorePoint(roomId, target);
      return planRestoreInTx(store, roomId, through);
    },

    /**
     * Restaura el draft al punto `target` añadiendo un update nuevo (la
     * historia no se borra: se puede volver a restaurar a cualquier punto,
     * incluido el anterior a esta restauración). Para salas sin sesión de
     * edición abierta; con sesión viva, restaura el servidor de sincronización.
     */
    async restoreDraft(
      actor: Actor,
      roomId: string,
      target: RestoreTarget,
    ): Promise<AppendUpdateResult | null> {
      await authorize(actor, roomId);
      const through = await resolveRestorePoint(roomId, target);
      return store.withRoomLock(roomId, async (tx) => {
        const update = await planRestoreInTx(tx, roomId, through);
        return update ? appendInTx(tx, roomId, update, actor.userId) : null;
      });
    },

    /** Fuerza una compactación (p. ej. al cerrar la última sesión de edición). */
    async compact(actor: Actor, roomId: string): Promise<DraftSnapshotMeta | null> {
      await authorize(actor, roomId);
      const snapshot = await store.withRoomLock(roomId, (tx) => compactInTx(tx, roomId));
      return snapshot ? toMeta(snapshot) : null;
    },

    /** `GET /api/rooms/:roomId/history` — snapshots, del más reciente al más antiguo. */
    async listHistory(
      actor: Actor,
      roomId: string,
      limit: number = MAX_HISTORY_LIMIT,
    ): Promise<DraftSnapshotMeta[]> {
      await authorize(actor, roomId);
      const safeLimit = Math.min(Math.max(1, Math.trunc(limit) || 1), MAX_HISTORY_LIMIT);
      return store.listSnapshots(roomId, safeLimit);
    },
  };
}

export type RoomDraftService = ReturnType<typeof createRoomDraftService>;

/**
 * Store en memoria con la misma semántica que el de Prisma (ids crecientes
 * globales, lock por sala). Lo usan los tests y superficies sin base de datos.
 */
export function createInMemoryRoomDraftStore(
  rooms: DraftRoomRef[] = [],
): RoomDraftStore & { addRoom(room: DraftRoomRef): void } {
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const updates: DraftUpdate[] = [];
  const snapshots: DraftSnapshot[] = [];
  const locks = new Map<string, Promise<unknown>>();
  let nextUpdateId = 1n;
  let nextSnapshotId = 1n;

  const tx: RoomDraftTx = {
    async latestSnapshot(roomId, atOrBeforeUpdateId) {
      return (
        snapshots
          .filter(
            (s) =>
              s.roomId === roomId &&
              (atOrBeforeUpdateId === undefined || s.updatesAppliedThrough <= atOrBeforeUpdateId),
          )
          .at(-1) ?? null
      );
    },
    async updatesAfter(roomId, afterId, throughId) {
      return updates.filter(
        (u) =>
          u.roomId === roomId && u.id > afterId && (throughId === undefined || u.id <= throughId),
      );
    },
    async countUpdatesAfter(roomId, afterId) {
      return updates.filter((u) => u.roomId === roomId && u.id > afterId).length;
    },
    async insertUpdate(roomId, data, authorId) {
      const row: DraftUpdate = {
        id: nextUpdateId++,
        roomId,
        data: data.slice(),
        authorId,
        createdAt: new Date(),
      };
      updates.push(row);
      return row;
    },
    async insertSnapshot(roomId, state, updatesAppliedThrough) {
      const row: DraftSnapshot = {
        id: nextSnapshotId++,
        roomId,
        state: state.slice(),
        updatesAppliedThrough,
        createdAt: new Date(),
      };
      snapshots.push(row);
      return row;
    },
  };

  return {
    ...tx,
    addRoom(room) {
      roomById.set(room.id, room);
    },
    async createRoom({ authorId }) {
      const room = { id: globalThis.crypto.randomUUID(), authorId };
      roomById.set(room.id, room);
      return room;
    },
    async findRoom(roomId) {
      return roomById.get(roomId) ?? null;
    },
    async findSnapshot(roomId, snapshotId) {
      const found = snapshots.find((s) => s.roomId === roomId && s.id === snapshotId);
      if (!found) return null;
      return {
        id: found.id,
        roomId: found.roomId,
        updatesAppliedThrough: found.updatesAppliedThrough,
        createdAt: found.createdAt,
      };
    },
    async listSnapshots(roomId, limit) {
      return snapshots
        .filter((s) => s.roomId === roomId)
        .reverse()
        .slice(0, limit)
        .map(toMeta);
    },
    async withRoomLock(roomId, fn) {
      const previous = locks.get(roomId) ?? Promise.resolve();
      const run = previous.then(
        () => fn(tx),
        () => fn(tx),
      );
      locks.set(
        roomId,
        run.catch(() => undefined),
      );
      return run;
    },
  };
}
