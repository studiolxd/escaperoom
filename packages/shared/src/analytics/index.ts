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
  mapGameplayEvent,
  type DialogReadEvent,
  type GameplayAnalyticsContext,
  type GameplayEvent,
  type HintRequestedEvent,
  type ItemCombinedEvent,
  type ItemGrantedEvent,
  type PuzzleAttemptedEvent,
  type PuzzleAvailableEvent,
  type PuzzleFailedEvent,
  type PuzzleSolvedEvent,
} from "./gameplay";
export {
  createGameplayAnalyticsEmitter,
  emitGameplayEvents,
  type EmitGameplayResult,
  type GameplayAnalyticsEmitter,
} from "./gameplay-emitter";
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
export {
  ANALYTICS_EVENT_TABLE,
  ANALYTICS_PARTITIONS_AHEAD,
  ANALYTICS_PARTITIONS_LOCK_KEY,
  ANALYTICS_RETENTION_MONTHS,
  addMonths,
  createPartitionSql,
  detachPartitionSql,
  dropPartitionSql,
  maintainAnalyticsPartitions,
  parsePartitionName,
  partitionBounds,
  partitionName,
  planPartitionMaintenance,
  retentionCutoff,
  yearMonthOf,
  type PartitionMaintenanceDb,
  type PartitionMaintenanceOptions,
  type PartitionMaintenanceResult,
  type PartitionMaintenanceTx,
  type PartitionPlan,
  type YearMonth,
} from "./partitions";
export { createPrismaPartitionMaintenanceDb } from "./partitions-prisma";
