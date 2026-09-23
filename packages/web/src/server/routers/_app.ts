import { router } from "../trpc";
import { catalogRouter } from "./catalog";
import { reviewsRouter } from "./reviews";

/** Router raíz de tRPC (UI). */
export const appRouter = router({
  catalog: catalogRouter,
  reviews: reviewsRouter,
});

export type AppRouter = typeof appRouter;
