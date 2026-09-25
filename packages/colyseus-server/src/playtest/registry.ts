import { randomUUID } from "node:crypto";
import type { RoomPackage } from "@escaperoom/shared/schemas";

/**
 * Registro de playtests del editor (ticket 3.8): el `RoomPackage` del borrador,
 * **congelado** en el momento de crear el playtest, con su autor y caducidad.
 *
 * Vive en memoria del proceso de Colyseus: la room de playtest es temporal y
 * se reconstruye desde aquí si se vació y alguien vuelve a entrar con el link
 * mientras no caduque. Con varios procesos haría falta llevarlo a la presence
 * compartida (Redis, fase 6); hoy hay un único proceso (specs/24).
 */

/** Playtests vivos por autor: al crear uno más se descarta el más antiguo. */
export const MAX_PLAYTESTS_PER_AUTHOR = 5;

/**
 * Tope global de playtests vivos en el proceso (C-16): sin él, muchos autores
 * distintos (cada uno bajo su propio tope de `MAX_PLAYTESTS_PER_AUTHOR`)
 * podían crecer el registro sin límite y agotar la memoria del proceso.
 */
export const MAX_PLAYTESTS_TOTAL = 500;

/** Cadencia del barrido periódico de caducados (C-16), independiente de que se registren nuevos. */
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/** El registro ya alcanzó `MAX_PLAYTESTS_TOTAL`: la ruta interna responde 429. */
export class PlaytestLimitError extends Error {
  constructor() {
    super("Límite global de playtests activos alcanzado");
    this.name = "PlaytestLimitError";
  }
}

export interface PlaytestEntry {
  playtestId: string;
  /** Usuario que lo creó (el autor del borrador). */
  authorId: string;
  /** Sala del editor de la que sale el borrador. */
  draftRoomId: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms: a partir de aquí el link no sirve y la room se cierra. */
  expiresAt: number;
}

export interface RegisterPlaytestInput {
  roomPackage: RoomPackage;
  authorId: string;
  draftRoomId: string;
  ttlSeconds: number;
}

interface StoredPlaytest extends PlaytestEntry {
  /** Instantánea serializada: nadie puede mutar el paquete congelado. */
  snapshot: string;
}

export class PlaytestRegistry {
  private readonly entries = new Map<string, StoredPlaytest>();
  /** Ids vivos por autor, en orden de alta (el primero es el más antiguo) — evita el `O(n)` de recorrer todo el registro en cada alta (C-16). */
  private readonly byAuthor = new Map<string, Set<string>>();
  private readonly maxTotal: number;
  private readonly sweepTimer: ReturnType<typeof setInterval> | null;

  constructor(
    private readonly now: () => number = Date.now,
    opts: { maxTotal?: number; sweepIntervalMs?: number } = {},
  ) {
    this.maxTotal = opts.maxTotal ?? MAX_PLAYTESTS_TOTAL;
    const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.sweepTimer = sweepIntervalMs > 0 ? setInterval(() => this.sweep(), sweepIntervalMs) : null;
    this.sweepTimer?.unref();
  }

  /** Congela el paquete y da de alta el playtest. */
  register(input: RegisterPlaytestInput): PlaytestEntry {
    if (this.entries.size >= this.maxTotal) {
      this.sweep();
      if (this.entries.size >= this.maxTotal) throw new PlaytestLimitError();
    }
    const createdAt = this.now();
    const stored: StoredPlaytest = {
      playtestId: randomUUID(),
      authorId: input.authorId,
      draftRoomId: input.draftRoomId,
      createdAt,
      expiresAt: createdAt + input.ttlSeconds * 1000,
      snapshot: JSON.stringify(input.roomPackage),
    };
    let own = this.byAuthor.get(input.authorId);
    if (!own) {
      own = new Set();
      this.byAuthor.set(input.authorId, own);
    }
    while (own.size >= MAX_PLAYTESTS_PER_AUTHOR) {
      const oldestId = own.values().next().value as string;
      own.delete(oldestId);
      this.entries.delete(oldestId);
    }
    own.add(stored.playtestId);
    this.entries.set(stored.playtestId, stored);
    return toEntry(stored);
  }

  /** Playtest vivo por id; `undefined` si no existe o ya caducó. */
  get(playtestId: string): PlaytestEntry | undefined {
    const stored = this.live(playtestId);
    return stored ? toEntry(stored) : undefined;
  }

  /** Copia propia del paquete congelado para una room (cada room muta la suya). */
  packageFor(playtestId: string): RoomPackage | undefined {
    const stored = this.live(playtestId);
    return stored ? (JSON.parse(stored.snapshot) as RoomPackage) : undefined;
  }

  /** Da de baja un playtest (p. ej. si no se pudo levantar su room). */
  delete(playtestId: string): void {
    this.removeEntry(playtestId);
  }

  /** Olvida los playtests caducados (llamado periódicamente, además de al registrar cerca del tope). */
  sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.removeEntry(id);
    }
  }

  get size(): number {
    this.sweep();
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.byAuthor.clear();
  }

  /** Detiene el barrido periódico (tests que no quieren temporizadores vivos). */
  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private removeEntry(playtestId: string): void {
    const stored = this.entries.get(playtestId);
    if (!stored) return;
    this.entries.delete(playtestId);
    this.byAuthor.get(stored.authorId)?.delete(playtestId);
  }

  private live(playtestId: string): StoredPlaytest | undefined {
    const stored = this.entries.get(playtestId);
    if (!stored) return undefined;
    if (stored.expiresAt <= this.now()) {
      this.removeEntry(playtestId);
      return undefined;
    }
    return stored;
  }
}

function toEntry(stored: StoredPlaytest): PlaytestEntry {
  const { playtestId, authorId, draftRoomId, createdAt, expiresAt } = stored;
  return { playtestId, authorId, draftRoomId, createdAt, expiresAt };
}

/** Registro del proceso (lo comparten la ruta interna y la `PlaytestRoom`). */
export const playtestRegistry = new PlaytestRegistry();
