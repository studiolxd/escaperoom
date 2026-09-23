import { ReviewError, type ReviewErrorCode } from "@escaperoom/shared/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";

const TRPC_CODE: Record<ReviewErrorCode, TRPCError["code"]> = {
  UNAUTHENTICATED: "UNAUTHORIZED",
  REVIEW_NOT_ALLOWED: "FORBIDDEN",
  ROOM_NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "BAD_REQUEST",
  CONTENT_REJECTED: "UNPROCESSABLE_CONTENT",
};

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ReviewError) {
      throw new TRPCError({ code: TRPC_CODE[error.code], message: error.message, cause: error });
    }
    throw error;
  }
}

/** Router de tRPC de reseñas (UI). Mismo servicio que `/api/rooms/:roomId/reviews`. */
export const reviewsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        roomId: z.string(),
        cursor: z.string().nullish(),
        limit: z.union([z.number(), z.string()]).nullish(),
      }),
    )
    .query(({ ctx, input }) =>
      translate(() => ctx.reviews.listReviews(ctx.actor, input.roomId, input)),
    ),
  viewerState: publicProcedure
    .input(z.object({ roomId: z.string() }))
    .query(({ ctx, input }) =>
      translate(() => ctx.reviews.getViewerState(ctx.actor, input.roomId)),
    ),
  upsert: publicProcedure
    .input(z.object({ roomId: z.string(), rating: z.unknown(), text: z.unknown().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Mismo cubo que `POST /api/rooms/:roomId/reviews` (ticket 6.3).
      const limited = await ctx.rateLimit?.("review-write");
      if (limited && !limited.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Demasiadas reseñas: vuelve a intentarlo en ${limited.retryAfter} s.`,
        });
      }
      return translate(() =>
        ctx.reviews.upsertReview(ctx.actor, input.roomId, {
          rating: input.rating,
          text: input.text,
        }),
      );
    }),
});
