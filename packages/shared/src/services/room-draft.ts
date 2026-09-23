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
  latestSnapshot(roomId: string): Promise<DraftSnapshot | null>;
  /** Updates con `id > afterId`, en orden ascendente de `id`. */
  updatesAfter(roomId: string, afterId: bigint): Promise<DraftUpdate[]>;
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
  listSnapshots(roomId: string, limit: number): Promise<DraftSnapshotMeta[]>;
  withRoomLock<T>(roomId: string, fn: (tx: RoomDraftTx) => Promise<T>): Promise<T>;
}

export type RoomDraftErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_UPDATE"
  | "PAYLOAD_TOO_LARGE";

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

      return store.withRoomLock(roomId, async (tx) => {
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
    async latestSnapshot(roomId) {
      return snapshots.filter((s) => s.roomId === roomId).at(-1) ?? null;
    },
    async updatesAfter(roomId, afterId) {
      return updates.filter((u) => u.roomId === roomId && u.id > afterId);
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
    async findRoom(roomId) {
      return roomById.get(roomId) ?? null;
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
