import { CatalogError } from "@escaperoom/shared/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";

const multi = z.union([z.string(), z.array(z.string())]).optional();
const intLike = z.union([z.number(), z.string()]).nullish();

/** Misma entrada que la query de `GET /api/rooms`; la validación fina es del servicio. */
const listRoomsInput = z
  .object({
    language: multi,
    difficulty: z
      .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
      .optional(),
    minPrice: intLike,
    maxPrice: intLike,
    minPlayers: intLike,
    maxPlayers: intLike,
    players: intLike,
    q: z.string().nullish(),
    sort: z.string().nullish(),
    cursor: z.string().nullish(),
    limit: intLike,
  })
  .optional();

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CatalogError) {
      throw new TRPCError({
        code: error.code === "ROOM_NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST",
        message: error.message,
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Router de tRPC del catálogo (UI). Adaptador fino: no hay lógica de dominio,
 * solo se delega en el servicio compartido con el `actor` del contexto.
 */
export const catalogRouter = router({
  getFeaturedRoom: publicProcedure.query(({ ctx }) => ctx.catalog.getFeaturedRoom(ctx.actor)),
  listRooms: publicProcedure.input(listRoomsInput).query(({ ctx, input }) => {
    const { difficulty, ...rest } = input ?? {};
    const difficulties = Array.isArray(difficulty) ? difficulty.map(String) : difficulty;
    return translate(() => ctx.catalog.listRooms(ctx.actor, { ...rest, difficulty: difficulties }));
  }),
  getRoom: publicProcedure
    .input(z.object({ roomId: z.string() }))
    .query(({ ctx, input }) => translate(() => ctx.catalog.getRoom(ctx.actor, input.roomId))),
});
