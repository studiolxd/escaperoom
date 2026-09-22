import { emitAnalyticsEvents } from "@escaperoom/shared/analytics";
import { createAnalyticsCollectHandler } from "@/server/rest/analytics-collect";

export const runtime = "nodejs";

/**
 * POST /api/analytics/collect — punto de colección de analítica (specs/16 §5).
 * Valida contra la taxonomía, encola en Redis y responde 202 sin esperar a la
 * escritura en `analyticsEvent` (la hace `@escaperoom/worker`).
 */
export const POST = createAnalyticsCollectHandler({
  emit: (events) => emitAnalyticsEvents(events),
});
