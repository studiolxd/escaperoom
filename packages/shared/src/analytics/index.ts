/**
 * Analítica — punto de colección y emisión (specs/16). Los esquemas/taxonomía
 * viven en `@escaperoom/shared/schemas`; aquí está la cola y la emisión.
 */
export {
  ANALYTICS_QUEUE_NAME,
  analyticsQueue,
  createAnalyticsQueue,
  emitAnalyticsEvents,
  type EmitAnalyticsResult,
} from "./queue";
export {
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_MAX_BATCH,
  AnalyticsEventTypeSchema,
  AnalyticsEventInputSchema,
  validateAnalyticsCollect,
  validateAnalyticsEvent,
  type AnalyticsCollectValidation,
  type AnalyticsEventInput,
  type AnalyticsEventType,
  type AnalyticsValidation,
} from "../schemas/analytics";
