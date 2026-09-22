-- 0008_pricing_settings_progress — precios, ajustes, progreso y analítica (specs/14 §8)
CREATE TABLE "pricingTier" (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "minPlayers"              int NOT NULL,
  "maxPlayers"              int,                    -- null = sin límite superior
  "priceCentsPerPlayer"     int NOT NULL,
  currency                  char(3) NOT NULL DEFAULT 'EUR',
  "activeFrom"              timestamptz NOT NULL DEFAULT now(),
  "activeUntil"             timestamptz,
  "createdBy"               text NOT NULL REFERENCES "user"(id),
  "createdAt"               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixPricingTierActive" ON "pricingTier"("activeFrom", "activeUntil");

CREATE TABLE "platformSetting" (
  key           text PRIMARY KEY,
  value         jsonb NOT NULL,
  "updatedBy"   text REFERENCES "user"(id),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "platformSetting" (key, value) VALUES ('maxPlayersPerRoom', '6');

CREATE TABLE "progressEvent" (
  id                bigserial PRIMARY KEY,
  "sessionId"       uuid NOT NULL REFERENCES "gameSession"(id),
  "groupId"         uuid REFERENCES "group"(id),
  "playerId"        text REFERENCES "user"(id),    -- null si el jugador entró solo con clave
  "accessKeyCode"   text REFERENCES "accessKey"(code),
  "puzzleId"        text NOT NULL,                  -- id lógico dentro del RoomPackage, no FK
  "eventKind"       "progressEventKind" NOT NULL,
  "durationMs"      int,
  "hintsUsed"       int NOT NULL DEFAULT 0,
  "createdAt"       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixProgressEventSession" ON "progressEvent"("sessionId", "createdAt");
CREATE INDEX "ixProgressEventGroup" ON "progressEvent"("groupId");

CREATE TABLE "analyticsEvent" (
  id                bigserial NOT NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "eventType"       text NOT NULL,
  "sessionId"       uuid,
  "playerId"        text,
  "roomVersionId"   uuid,
  payload           jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, "createdAt")
) PARTITION BY RANGE ("createdAt");

CREATE TABLE "analyticsEvent_2026_09" PARTITION OF "analyticsEvent"
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "analyticsEvent_2026_10" PARTITION OF "analyticsEvent"
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE INDEX "ixAnalyticsEventType" ON "analyticsEvent"("eventType", "createdAt");
CREATE INDEX "ixAnalyticsEventSession" ON "analyticsEvent"("sessionId");
