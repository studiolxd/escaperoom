import type { PrismaClient } from "../../generated/client";
import { UUID_RE } from "./common";
import type { Review, ReviewStore } from "./reviews";

type ReviewRow = {
  id: string;
  roomId: string;
  rating: number;
  text: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { name: string };
};

/** `review.rating` en BD está en escala doblada (2–10); aquí se expone 1–5 con medios puntos. */
function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    roomId: row.roomId,
    rating: row.rating / 2,
    text: row.text,
    authorDisplayName: row.user.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const REVIEW_SELECT = {
  id: true,
  roomId: true,
  rating: true,
  text: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true } },
} as const;

/** Store de reseñas sobre Postgres (`review`, `purchase`, `progressEvent`). */
export function createPrismaReviewStore(prisma: PrismaClient): ReviewStore {
  return {
    async getReviewableRoom(roomId) {
      if (!UUID_RE.test(roomId)) return null;
      const room = await prisma.room.findFirst({
        where: { id: roomId, status: "published", deletedAt: null },
        select: { id: true, authorId: true },
      });
      return room ? { roomId: room.id, authorId: room.authorId } : null;
    },

    async hasPlayedOrPurchased(userId, roomId) {
      // Compra cobrada de una versión de la sala (B2C o licencia) o progreso
      // registrado como jugador en una sesión de un evento de la sala.
      const rows = await prisma.$queryRaw<Array<{ eligible: boolean }>>`
        SELECT EXISTS (
                 SELECT 1 FROM "purchase" p
                   JOIN "roomVersion" v ON v.id = p."roomVersionId"
                  WHERE p."userId" = ${userId} AND v."roomId" = ${roomId}::uuid
                    AND p.status = 'succeeded' AND p."purchaseType" IN ('room', 'room_license')
               ) OR EXISTS (
                 SELECT 1 FROM "progressEvent" pe
                   JOIN "gameSession" gs ON gs.id = pe."sessionId"
                   JOIN "event" e ON e.id = gs."eventId"
                   JOIN "roomVersion" v ON v.id = e."roomVersionId"
                  WHERE pe."playerId" = ${userId} AND v."roomId" = ${roomId}::uuid
               ) AS eligible`;
      return rows[0]?.eligible === true;
    },

    async upsert({ userId, roomId, rating, text }) {
      // `xmax = 0` distingue la fila recién insertada de la actualizada por el
      // ON CONFLICT, en una sola sentencia atómica sobre UNIQUE(userId, roomId).
      // `rating` llega en escala 1–5 (medios puntos); se dobla para la BD.
      const doubled = Math.round(rating * 2);
      const rows = await prisma.$queryRaw<Array<{ id: string; created: boolean }>>`
        INSERT INTO "review" ("userId", "roomId", rating, text)
        VALUES (${userId}, ${roomId}::uuid, ${doubled}, ${text})
        ON CONFLICT ("userId", "roomId")
        DO UPDATE SET rating = EXCLUDED.rating, text = EXCLUDED.text
        RETURNING id, (xmax = 0) AS created`;
      const row = rows[0];
      if (!row) throw new Error("upsert de reseña sin fila devuelta");
      const review = await prisma.review.findUniqueOrThrow({
        where: { id: row.id },
        select: REVIEW_SELECT,
      });
      return { review: toReview(review), created: row.created };
    },

    async find(userId, roomId) {
      if (!UUID_RE.test(roomId)) return null;
      const review = await prisma.review.findUnique({
        where: { userId_roomId: { userId, roomId } },
        select: REVIEW_SELECT,
      });
      return review ? toReview(review) : null;
    },

    async list(roomId, page) {
      // Las reseñas ocultas por moderación (6.1) no se listan ni cuentan.
      const rows = await prisma.review.findMany({
        where: { roomId, hiddenAt: null },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
        select: REVIEW_SELECT,
      });
      return rows.map(toReview);
    },

    async stats(roomId) {
      const agg = await prisma.review.aggregate({
        where: { roomId, hiddenAt: null },
        _avg: { rating: true },
        _count: { _all: true },
      });
      const avg = agg._avg.rating;
      return { avg: avg === null ? null : avg / 2, count: agg._count._all };
    },
  };
}
