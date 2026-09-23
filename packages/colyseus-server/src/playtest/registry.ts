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

  constructor(private readonly now: () => number = Date.now) {}

  /** Congela el paquete y da de alta el playtest. */
  register(input: RegisterPlaytestInput): PlaytestEntry {
    this.sweep();
    const createdAt = this.now();
    const stored: StoredPlaytest = {
      playtestId: randomUUID(),
      authorId: input.authorId,
      draftRoomId: input.draftRoomId,
      createdAt,
      expiresAt: createdAt + input.ttlSeconds * 1000,
      snapshot: JSON.stringify(input.roomPackage),
    };
    const own = [...this.entries.values()]
      .filter((entry) => entry.authorId === input.authorId)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const old of own.slice(0, Math.max(0, own.length - MAX_PLAYTESTS_PER_AUTHOR + 1))) {
      this.entries.delete(old.playtestId);
    }
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
    this.entries.delete(playtestId);
  }

  /** Olvida los playtests caducados. */
  sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }

  get size(): number {
    this.sweep();
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private live(playtestId: string): StoredPlaytest | undefined {
    const stored = this.entries.get(playtestId);
    if (!stored) return undefined;
    if (stored.expiresAt <= this.now()) {
      this.entries.delete(playtestId);
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
