import { router } from "../trpc";
import { catalogRouter } from "./catalog";

/** Router raíz de tRPC (UI). */
export const appRouter = router({
  catalog: catalogRouter,
});

export type AppRouter = typeof appRouter;
