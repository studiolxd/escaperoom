-- E-7: crea el índice particionado del padre (vacío, sin escanear datos
-- porque usa ONLY) y adjunta los índices ya construidos CONCURRENTLY en
-- cada partición existente. En cuanto todas las particiones están
-- adjuntas, el índice del padre pasa a válido automáticamente. Nombre
-- igual al `map` de schema.prisma (@@index([roomVersionId, createdAt]))
-- para que `prisma migrate diff` no proponga recrearlo.
CREATE INDEX "ixAnalyticsEventRoomVersion" ON ONLY "analyticsEvent"("roomVersionId", "createdAt");
ALTER INDEX "ixAnalyticsEventRoomVersion" ATTACH PARTITION "ixAnalyticsEvent_2026_09_RoomVersion";
ALTER INDEX "ixAnalyticsEventRoomVersion" ATTACH PARTITION "ixAnalyticsEvent_2026_10_RoomVersion";
ALTER INDEX "ixAnalyticsEventRoomVersion" ATTACH PARTITION "ixAnalyticsEvent_default_RoomVersion";
