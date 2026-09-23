import type { Actor, CatalogService, ReviewService } from "@escaperoom/shared/services";
import { initTRPC } from "@trpc/server";

/**
 * Contexto de tRPC: el `actor` derivado de la sesión (o invitado) y los
 * servicios de dominio compartidos. Se define aquí, sin importar auth ni Prisma, para que
 * los routers se puedan testear con un contexto inyectado y sin base de datos.
 */
export type Context = {
  actor: Actor;
  catalog: CatalogService;
  reviews: ReviewService;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
