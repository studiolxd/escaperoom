-- E-7: ver 20260925133000_analytics_event_room_version_2026_09. Incluye la
-- partición DEFAULT (20260924210000_analytics_event_default_partition, E-6).
CREATE INDEX CONCURRENTLY "ixAnalyticsEvent_default_RoomVersion" ON "analyticsEvent_default"("roomVersionId", "createdAt");
