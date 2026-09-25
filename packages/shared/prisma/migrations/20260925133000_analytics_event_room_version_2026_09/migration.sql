-- E-7: analyticsEvent.roomVersionId sin índice; el dashboard de un creador
-- agrega analítica por versión de sala. Postgres no admite CREATE INDEX
-- CONCURRENTLY directamente sobre una tabla particionada (17.11): se crea
-- CONCURRENTLY en cada partición existente y luego se adjunta al índice
-- particionado del padre (ver 20260925133300). Las particiones mensuales
-- futuras (packages/shared/src/analytics/partitions.ts) heredan el índice
-- automáticamente al crearse, sin necesidad de repetir este paso.
CREATE INDEX CONCURRENTLY "ixAnalyticsEvent_2026_09_RoomVersion" ON "analyticsEvent_2026_09"("roomVersionId", "createdAt");
