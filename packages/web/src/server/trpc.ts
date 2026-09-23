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
  /**
   * Gasta un intento de la política de rate limiting indicada (ticket 6.3) y
   * dice si cabe. Opcional: los tests de routers no lo inyectan (sin límite).
   */
  rateLimit?: (policy: "review-write") => Promise<{ ok: boolean; retryAfter: number }>;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
