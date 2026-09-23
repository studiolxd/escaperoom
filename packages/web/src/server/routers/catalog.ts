import { CatalogError } from "@escaperoom/shared/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";

/**
 * Router de tRPC del catálogo (UI). Adaptador fino: no hay lógica de dominio,
 * solo se delega en el servicio compartido con el `actor` del contexto.
 */
export const catalogRouter = router({
  getFeaturedRoom: publicProcedure.query(({ ctx }) => ctx.catalog.getFeaturedRoom(ctx.actor)),
  listRooms: publicProcedure
    .input(z.object({ language: z.union([z.string(), z.array(z.string())]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.catalog.listRooms(ctx.actor, { language: input?.language });
      } catch (error) {
        if (error instanceof CatalogError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
    }),
});
