import { filterChatText } from "../chat";
import type { Actor } from "./actor";
import { CatalogError, decodeCatalogCursor, encodeCatalogCursor, roundRating } from "./catalog";

/**
 * Reseñas de salas (specs/13 §3, specs/14 §9): una por usuario y sala
 * (`UNIQUE(userId, roomId)`), creada o editada con upsert.
 */
export type Review = {
  id: string;
  roomId: string;
  rating: number;
  text: string | null;
  authorDisplayName: string;
  createdAt: string;
  updatedAt: string;
};

/** Estado de la sala a efectos de reseñas (solo el catálogo publicado admite reseñas). */
export type ReviewableRoom = { roomId: string; authorId: string };

/**
 * Puerto de persistencia de reseñas. La implementación Prisma decide la
 * elegibilidad con compras y progreso reales; la de memoria, con conjuntos.
 */
export interface ReviewStore {
  /** Sala `published` y no borrada; `null` si no está en catálogo. */
  getReviewableRoom(roomId: string): Promise<ReviewableRoom | null>;
  /** ¿Ha comprado (compra `succeeded`) o jugado (progreso registrado) la sala? */
  hasPlayedOrPurchased(userId: string, roomId: string): Promise<boolean>;
  upsert(input: {
    userId: string;
    roomId: string;
    rating: number;
    text: string | null;
  }): Promise<{ review: Review; created: boolean }>;
  find(userId: string, roomId: string): Promise<Review | null>;
  /** Reseñas de la sala, más recientes (por edición) primero. */
  list(roomId: string, page: { offset: number; limit: number }): Promise<Review[]>;
  stats(roomId: string): Promise<{ avg: number | null; count: number }>;
}

export type ReviewErrorCode =
  | "UNAUTHENTICATED"
  | "ROOM_NOT_FOUND"
  | "REVIEW_NOT_ALLOWED"
  | "VALIDATION_ERROR"
  | "CONTENT_REJECTED";

/** Error de dominio de reseñas; los adaptadores lo traducen a HTTP/tRPC. */
export class ReviewError extends Error {
  readonly code: ReviewErrorCode;
  constructor(code: ReviewErrorCode, message: string) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
  }
}

export const REVIEW_TEXT_MAX_LENGTH = 2000;
export const REVIEWS_DEFAULT_LIMIT = 20;
export const REVIEWS_MAX_LIMIT = 50;

/** Entrada cruda de `POST /api/rooms/:roomId/reviews`. */
export type ReviewInput = { rating: unknown; text?: unknown };

/**
 * Valida y limpia la reseña. El texto pasa por el filtro de lenguaje de 2.1
 * (specs/17 §3): se desinfecta (HTML, control, espacios) y, si contiene
 * términos de la lista, se rechaza (🛑 "bloquea enviar"), no se censura: una
 * reseña pública con asteriscos no aporta y el usuario puede reformularla.
 *
 * La valoración admite medios puntos: {1, 1.5, 2, …, 5}. Se valida contra la
 * escala doblada (×2 debe ser un entero entre 2 y 10, el mismo rango que
 * `review_rating_check`) para no depender de comparaciones de coma flotante
 * sobre decimales, y se normaliza al medio punto exacto antes de devolverla.
 */
export function parseReviewInput(input: ReviewInput): { rating: number; text: string | null } {
  const { rating, text } = input;
  const doubled = typeof rating === "number" ? Math.round(rating * 2) : Number.NaN;
  const isHalfStep = typeof rating === "number" && Math.abs(rating * 2 - doubled) < 1e-9;
  if (!isHalfStep || doubled < 2 || doubled > 10) {
    throw new ReviewError(
      "VALIDATION_ERROR",
      "La valoración debe ser 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5 o 5",
    );
  }
  if (text !== undefined && text !== null && typeof text !== "string") {
    throw new ReviewError("VALIDATION_ERROR", "El texto de la reseña debe ser una cadena");
  }
  const filtered = filterChatText(text ?? "");
  if (filtered.text.length > REVIEW_TEXT_MAX_LENGTH) {
    throw new ReviewError(
      "VALIDATION_ERROR",
      `La reseña admite como mucho ${REVIEW_TEXT_MAX_LENGTH} caracteres`,
    );
  }
  if (filtered.filtered) {
    throw new ReviewError(
      "CONTENT_REJECTED",
      "La reseña contiene lenguaje no permitido; reformúlala para publicarla",
    );
  }
  return { rating: doubled / 2, text: filtered.text.length > 0 ? filtered.text : null };
}

function isAnonymous(actor: Actor): boolean {
  return actor.role === "anonymous";
}

function parsePage(input: { cursor?: string | null; limit?: string | number | null }) {
  let offset: number;
  try {
    offset = decodeCatalogCursor(input.cursor);
  } catch (error) {
    if (error instanceof CatalogError) throw new ReviewError("VALIDATION_ERROR", error.message);
    throw error;
  }
  const raw = input.limit;
  const limit =
    raw === undefined || raw === null || raw === "" ? REVIEWS_DEFAULT_LIMIT : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > REVIEWS_MAX_LIMIT) {
    throw new ReviewError(
      "VALIDATION_ERROR",
      `"limit" debe ser un entero entre 1 y ${REVIEWS_MAX_LIMIT}`,
    );
  }
  return { offset, limit };
}

export type ReviewListResult = {
  items: Review[];
  nextCursor: string | null;
  ratingAvg: number | null;
  ratingCount: number;
};

/** Lo que la UI necesita para pintar (o no) el formulario de reseña. */
export type ReviewViewerState = {
  canReview: boolean;
  reason: "ok" | "anonymous" | "own_room" | "not_played";
  review: Review | null;
};

/**
 * Servicio de reseñas. Criterio de elegibilidad (mínimo mientras no hay
 * checkout, 5.1): puede reseñar quien tenga una compra `succeeded` de una
 * versión de la sala o haya jugado una partida de ella (progreso registrado
 * como jugador); nunca su autor.
 */
export function createReviewService(deps: { store: ReviewStore }) {
  const { store } = deps;

  async function requireRoom(roomId: string): Promise<ReviewableRoom> {
    const room = await store.getReviewableRoom(roomId);
    if (!room) throw new ReviewError("ROOM_NOT_FOUND", "La sala no existe o no está publicada");
    return room;
  }

  async function viewerState(actor: Actor, room: ReviewableRoom): Promise<ReviewViewerState> {
    if (isAnonymous(actor)) return { canReview: false, reason: "anonymous", review: null };
    if (room.authorId === actor.userId) {
      return { canReview: false, reason: "own_room", review: null };
    }
    const [eligible, review] = await Promise.all([
      store.hasPlayedOrPurchased(actor.userId, room.roomId),
      store.find(actor.userId, room.roomId),
    ]);
    return eligible
      ? { canReview: true, reason: "ok", review }
      : { canReview: false, reason: "not_played", review };
  }

  return {
    /** Reseñas públicas de una sala del catálogo, paginadas, con la media y el recuento. */
    async listReviews(
      _actor: Actor,
      roomId: string,
      input: { cursor?: string | null; limit?: string | number | null } = {},
    ): Promise<ReviewListResult> {
      const { offset, limit } = parsePage(input);
      await requireRoom(roomId);
      const [rows, stats] = await Promise.all([
        store.list(roomId, { offset, limit: limit + 1 }),
        store.stats(roomId),
      ]);
      return {
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? encodeCatalogCursor(offset + limit) : null,
        ratingAvg: roundRating(stats.avg, stats.count),
        ratingCount: stats.count,
      };
    },

    /** ¿Puede el actor reseñar esta sala? Incluye su reseña actual para editarla. */
    async getViewerState(actor: Actor, roomId: string): Promise<ReviewViewerState> {
      return viewerState(actor, await requireRoom(roomId));
    },

    /**
     * Crea o edita la reseña del actor (una por usuario y sala). Devuelve si se
     * creó y la valoración agregada ya actualizada.
     */
    async upsertReview(
      actor: Actor,
      roomId: string,
      input: ReviewInput,
    ): Promise<{
      review: Review;
      created: boolean;
      ratingAvg: number | null;
      ratingCount: number;
    }> {
      if (isAnonymous(actor)) {
        throw new ReviewError("UNAUTHENTICATED", "Inicia sesión para reseñar");
      }
      const data = parseReviewInput(input);
      const room = await requireRoom(roomId);
      const state = await viewerState(actor, room);
      if (!state.canReview) {
        throw new ReviewError(
          "REVIEW_NOT_ALLOWED",
          state.reason === "own_room"
            ? "No puedes reseñar tu propia sala"
            : "Solo puede reseñar quien ha jugado o comprado la sala",
        );
      }
      const { review, created } = await store.upsert({ userId: actor.userId, roomId, ...data });
      const stats = await store.stats(roomId);
      return {
        review,
        created,
        ratingAvg: roundRating(stats.avg, stats.count),
        ratingCount: stats.count,
      };
    },
  };
}

export type ReviewService = ReturnType<typeof createReviewService>;

/** Store en memoria (tests): misma semántica que Postgres, `UNIQUE(userId, roomId)`. */
export function createInMemoryReviewStore(seed: {
  rooms: ReviewableRoom[];
  /** Pares `userId:roomId` que han jugado o comprado. */
  eligible?: Iterable<string>;
  users?: Record<string, string>;
  now?: () => Date;
}) {
  const rooms = new Map(seed.rooms.map((room) => [room.roomId, room]));
  const eligible = new Set(seed.eligible ?? []);
  const users = seed.users ?? {};
  const now = seed.now ?? (() => new Date());
  const reviews = new Map<string, Review & { userId: string }>();
  let seq = 0;

  const key = (userId: string, roomId: string) => `${userId}:${roomId}`;
  const strip = (review: Review & { userId: string }): Review => ({
    id: review.id,
    roomId: review.roomId,
    rating: review.rating,
    text: review.text,
    authorDisplayName: review.authorDisplayName,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  });

  /** Estadísticas síncronas: también alimentan el listado en memoria. */
  function ratingStats(roomId: string): { avg: number | null; count: number } {
    const ratings = [...reviews.values()].filter((r) => r.roomId === roomId).map((r) => r.rating);
    if (ratings.length === 0) return { avg: null, count: 0 };
    return { avg: ratings.reduce((a, b) => a + b, 0) / ratings.length, count: ratings.length };
  }

  const store: ReviewStore & {
    ratingStats: typeof ratingStats;
    markEligible(userId: string, roomId: string): void;
  } = {
    ratingStats,
    markEligible(userId, roomId) {
      eligible.add(key(userId, roomId));
    },
    async getReviewableRoom(roomId) {
      return rooms.get(roomId) ?? null;
    },
    async hasPlayedOrPurchased(userId, roomId) {
      return eligible.has(key(userId, roomId));
    },
    async upsert({ userId, roomId, rating, text }) {
      const existing = reviews.get(key(userId, roomId));
      const at = now().toISOString();
      const next = existing
        ? { ...existing, rating, text, updatedAt: at }
        : {
            id: `review-${++seq}`,
            userId,
            roomId,
            rating,
            text,
            authorDisplayName: users[userId] ?? userId,
            createdAt: at,
            updatedAt: at,
          };
      reviews.set(key(userId, roomId), next);
      return { review: strip(next), created: !existing };
    },
    async find(userId, roomId) {
      const review = reviews.get(key(userId, roomId));
      return review ? strip(review) : null;
    },
    async list(roomId, page) {
      return [...reviews.values()]
        .filter((r) => r.roomId === roomId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
        .slice(page.offset, page.offset + page.limit)
        .map(strip);
    },
    async stats(roomId) {
      return ratingStats(roomId);
    },
  };
  return store;
}
