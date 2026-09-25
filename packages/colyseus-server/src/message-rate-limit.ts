import {
  CHAT_RATE_LIMIT_EMPTY,
  checkChatRateLimit,
  type ChatRateLimitConfig,
  type ChatRateLimitResult,
  type ChatRateLimitState,
} from "@escaperoom/shared/chat";
import { GAME_MESSAGES } from "./constants.js";
import { MEDIA_TOKEN_REQUEST_MESSAGE } from "./media/index.js";

/**
 * Rate limit POR MENSAJE de la `GameRoom` (specs/11 §9, ticket 6.3).
 *
 * Ventana deslizante en memoria por jugador (`sessionId`) y tipo de mensaje:
 * el estado vive en la instancia de la room, así que un cliente que inunda
 * solo gasta SU cuota y el resto de jugadores de la partida no lo nota. No
 * hace falta Redis: una partida vive entera en un proceso de Colyseus.
 *
 * Reutiliza `checkChatRateLimit` de `shared` (la ventana del chat, ticket
 * 2.1), que es genérica: log de instantes aceptados en `(now - window, now]`.
 */

export type MessageRateLimit = ChatRateLimitConfig;

export interface GameMessageRateLimits {
  /** Límite por tipo de mensaje. Un tipo sin entrada solo cuenta para `total`. */
  perType: Readonly<Record<string, MessageRateLimit>>;
  /** Tipos cuyo límite es por puzzle (`puzzleId` del payload), no por jugador. */
  perPuzzle: ReadonlySet<string>;
  /** Tope de mensajes de cualquier tipo por jugador (incluidos chat y medios). */
  total: MessageRateLimit;
}

const perSecond = (max: number): MessageRateLimit => ({ max, windowMs: 1_000 });

/**
 * Tabla de specs/11 §9 más los mensajes que la spec no cita (documentados en
 * `docs/reference/seguridad.md` §2). El chat NO está aquí: `RoomChat` ya aplica sus
 * 2 msg/s con su propio error (ticket 2.1); solo cuenta para el total.
 */
export const GAME_MESSAGE_RATE_LIMITS: GameMessageRateLimits = {
  perType: {
    [GAME_MESSAGES.move]: perSecond(10),
    [GAME_MESSAGES.interact]: perSecond(4),
    [GAME_MESSAGES.puzzleAttempt]: perSecond(2),
    [GAME_MESSAGES.combine]: perSecond(3),
    // Fuera de la tabla de la spec: mismos órdenes de magnitud que su gemelo.
    [GAME_MESSAGES.useItem]: perSecond(4),
    [GAME_MESSAGES.puzzleOpen]: perSecond(4),
    [GAME_MESSAGES.puzzleClose]: perSecond(4),
    [GAME_MESSAGES.plateState]: perSecond(10),
    [GAME_MESSAGES.splitView]: perSecond(4),
    [GAME_MESSAGES.hintRequest]: perSecond(2),
    [GAME_MESSAGES.startGame]: perSecond(2),
    [MEDIA_TOKEN_REQUEST_MESSAGE]: perSecond(2),
  },
  perPuzzle: new Set([GAME_MESSAGES.puzzleAttempt]),
  total: perSecond(30),
};

/** Código de error de protocolo del rechazo (specs/11 §7), el mismo que el del chat. */
export const MESSAGE_RATE_LIMITED_ERROR = "RATE_LIMITED" as const;

/**
 * `GAME_MESSAGE_RATE_LIMIT=off` lo apaga. Existe para el E2E de protocolo del
 * ticket 2.12, cuyos clientes-máquina encadenan intentos sin la cadencia de
 * una persona; en cualquier otro entorno (y en el resto de tests) está
 * encendido.
 */
export function readGameMessageRateLimits(
  env: Record<string, string | undefined> = process.env,
): GameMessageRateLimits | null {
  const flag = env.GAME_MESSAGE_RATE_LIMIT?.trim().toLowerCase();
  return flag === "off" || flag === "false" ? null : GAME_MESSAGE_RATE_LIMITS;
}

export type MessageRateDecision =
  | { ok: true }
  | {
      ok: false;
      /** Clave del cubo agotado (`move`, `puzzle_attempt:p-1`, `*`). */
      bucket: string;
      retryAfterMs: number;
      /** `false` si ya se avisó al cliente de este tipo de mensaje en la ventana. */
      notify: boolean;
    };

const TOTAL_BUCKET = "*";
/** Por encima de tantos cubos por jugador se purgan los caducados (puzzleIds inventados). */
const MAX_BUCKETS_PER_CLIENT = 64;

interface Bucket {
  state: ChatRateLimitState;
  windowMs: number;
}

interface ClientLimits {
  buckets: Map<string, Bucket>;
  /** Tipo de mensaje → hasta cuándo no se repite el aviso de rechazo. */
  mutedUntil: Map<string, number>;
}

/** Estado del rate limit de una room: cubos y avisos por jugador. */
export class MessageRateLimiter {
  private readonly clients = new Map<string, ClientLimits>();

  constructor(
    private readonly limits: GameMessageRateLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Registra un mensaje de `sessionId` y decide si se procesa.
   *
   * C-14: el cubo por tipo se evalúa PRIMERO (`peek`, sin tocar el estado); si
   * rechaza, el cubo `total` ni se mira, así que un tipo que rechaza no le come
   * cuota del total al resto de mensajes del jugador. Solo si el tipo pasa (o
   * no tiene límite propio) se mira el `total`; si también pasa, se confirman
   * (`commit`) los dos cubos a la vez.
   */
  check(sessionId: string, type: string, payload: unknown): MessageRateDecision {
    const now = this.now();
    let client = this.clients.get(sessionId);
    if (!client) {
      client = { buckets: new Map(), mutedUntil: new Map() };
      this.clients.set(sessionId, client);
    }

    const limit = this.limits.perType[type];
    const typeKey = limit
      ? this.limits.perPuzzle.has(type)
        ? `${type}:${puzzleIdOf(payload)}`
        : type
      : undefined;

    const typePeek = typeKey && limit ? this.peek(client.buckets, typeKey, limit, now) : undefined;
    if (typePeek && !typePeek.ok) {
      return this.reject(client, type, typeKey!, typePeek.retryAfterMs, now);
    }
    const totalPeek = this.peek(client.buckets, TOTAL_BUCKET, this.limits.total, now);
    if (!totalPeek.ok) {
      return this.reject(client, type, TOTAL_BUCKET, totalPeek.retryAfterMs, now);
    }

    this.commit(client.buckets, TOTAL_BUCKET, totalPeek, this.limits.total.windowMs);
    if (typeKey && typePeek && limit) this.commit(client.buckets, typeKey, typePeek, limit.windowMs);
    return { ok: true };
  }

  /** Olvida al jugador (al salir de la room). */
  forget(sessionId: string): void {
    this.clients.delete(sessionId);
  }

  private reject(
    client: ClientLimits,
    type: string,
    bucket: string,
    retryAfterMs: number,
    now: number,
  ): MessageRateDecision {
    // Un aviso por tipo de mensaje y ventana: al que inunda no se le inunda de errores.
    const notify = now >= (client.mutedUntil.get(type) ?? 0);
    if (notify) client.mutedUntil.set(type, now + retryAfterMs);
    return { ok: false, bucket, retryAfterMs, notify };
  }

  /** Calcula si el mensaje cabría en el cubo `key`, sin confirmar el estado nuevo. */
  private peek(
    buckets: Map<string, Bucket>,
    key: string,
    limit: MessageRateLimit,
    now: number,
  ): ChatRateLimitResult {
    if (!buckets.has(key) && buckets.size >= MAX_BUCKETS_PER_CLIENT) this.prune(buckets, now);
    const bucket = buckets.get(key) ?? { state: CHAT_RATE_LIMIT_EMPTY, windowMs: limit.windowMs };
    return checkChatRateLimit(bucket.state, now, limit);
  }

  /** Confirma el estado calculado por `peek` en el cubo `key`. */
  private commit(
    buckets: Map<string, Bucket>,
    key: string,
    result: ChatRateLimitResult,
    windowMs: number,
  ): void {
    buckets.set(key, { state: result.state, windowMs });
  }

  private prune(buckets: Map<string, Bucket>, now: number): void {
    for (const [key, bucket] of buckets) {
      const last = bucket.state.hits[bucket.state.hits.length - 1];
      if (key !== TOTAL_BUCKET && (last === undefined || last <= now - bucket.windowMs)) {
        buckets.delete(key);
      }
    }
    // Si todos siguen vivos (inundación de puzzleIds distintos), se sacrifica el más viejo.
    if (buckets.size >= MAX_BUCKETS_PER_CLIENT) {
      const oldest = [...buckets.keys()].find((key) => key !== TOTAL_BUCKET);
      if (oldest) buckets.delete(oldest);
    }
  }
}

function puzzleIdOf(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const puzzleId = (payload as { puzzleId?: unknown }).puzzleId;
  return typeof puzzleId === "string" ? puzzleId.slice(0, 64) : "";
}
