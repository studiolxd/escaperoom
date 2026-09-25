-- E-7: ver 20260925133000_analytics_event_room_version_2026_09.
CREATE INDEX CONCURRENTLY "ixAnalyticsEvent_2026_10_RoomVersion" ON "analyticsEvent_2026_10"("roomVersionId", "createdAt");
