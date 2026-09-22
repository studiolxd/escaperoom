import { publicProcedure, router } from "../trpc";

/**
 * Router de tRPC del catálogo (UI). Adaptador fino: no hay lógica de dominio,
 * solo se delega en el servicio compartido con el `actor` del contexto.
 */
export const catalogRouter = router({
  getFeaturedRoom: publicProcedure.query(({ ctx }) => ctx.catalog.getFeaturedRoom(ctx.actor)),
});
