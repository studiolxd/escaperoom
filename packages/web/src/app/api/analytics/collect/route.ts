import { emitAnalyticsEvents } from "@escaperoom/shared/analytics";
import { resolveActorFromRequest } from "@/server/context";
import { env } from "@/env";
import { withRateLimit } from "@/server/rate-limit";
import { createAnalyticsCollectHandler } from "@/server/rest/analytics-collect";

export const runtime = "nodejs";

/**
 * POST /api/analytics/collect — punto de colección de analítica (specs/16 §5).
 * Valida contra la taxonomía, encola en Redis y responde 202 sin esperar a la
 * escritura en `analyticsEvent` (la hace `@escaperoom/worker`).
 */
export const POST = withRateLimit(
  "analytics-collect",
  createAnalyticsCollectHandler({
    emit: (events) => emitAnalyticsEvents(events),
    resolveActor: resolveActorFromRequest,
    serverSecret: env.ANALYTICS_SERVER_SECRET ?? null,
  }),
);
