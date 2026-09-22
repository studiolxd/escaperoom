-- 0006_events — eventos, sesiones de partida, grupos, claves y grabaciones (specs/14 §6).
-- La tabla de sesiones de partida es `gameSession` para no chocar con la `session`
-- de auth (Better Auth).
CREATE TABLE "event" (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizerId"               text NOT NULL REFERENCES "user"(id),
  "roomVersionId"             uuid NOT NULL REFERENCES "roomVersion"(id),
  title                       text NOT NULL,
  audience                    "eventAudience" NOT NULL DEFAULT 'general',
  "maxSimultaneousSessions"   smallint NOT NULL DEFAULT 10,
  "groupingMode"              "groupingMode" NOT NULL DEFAULT 'random',
  "requireConfirmation"       boolean NOT NULL DEFAULT false,
  config                      jsonb NOT NULL DEFAULT '{}',
  "expiryRules"               jsonb NOT NULL DEFAULT '[]',
  "pricingSnapshot"           jsonb NOT NULL,      -- tramos vigentes en el momento de compra
  "playersPurchased"          int NOT NULL,
  status                      "eventStatus" NOT NULL DEFAULT 'draft',
  "createdAt"                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixEventOrganizer" ON "event"("organizerId");

CREATE TABLE "gameSession" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId"          uuid NOT NULL REFERENCES "event"(id),
  "colyseusRoomId"   text,                        -- se rellena al arrancar la partida real
  name               text NOT NULL,
  status             "sessionStatus" NOT NULL DEFAULT 'pending',
  capacity           smallint NOT NULL,
  "startedAt"        timestamptz,
  "endedAt"          timestamptz,
  "createdAt"        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixGameSessionEvent" ON "gameSession"("eventId");

CREATE TABLE "group" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId"   uuid NOT NULL REFERENCES "gameSession"(id) ON DELETE CASCADE,
  name          text NOT NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixGroupSession" ON "group"("sessionId");

CREATE TABLE "accessKey" (
  code                  text PRIMARY KEY,        -- 'RALD-7F3K'
  "eventId"             uuid NOT NULL REFERENCES "event"(id),
  "sessionId"           uuid REFERENCES "gameSession"(id),
  "groupId"             uuid REFERENCES "group"(id),
  email                 citext,
  "keyType"             "accessKeyType" NOT NULL,
  status                "accessKeyStatus" NOT NULL DEFAULT 'generated',
  "singleUse"           boolean NOT NULL DEFAULT true,
  "requireConfirmation" boolean NOT NULL DEFAULT false,
  "regeneratedFrom"     text REFERENCES "accessKey"(code),
  "confirmedAt"         timestamptz,
  "activatedAt"         timestamptz,
  "usedAt"              timestamptz,
  "expiresAt"           timestamptz,
  "createdAt"           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixAccessKeyEvent" ON "accessKey"("eventId");
CREATE INDEX "ixAccessKeySession" ON "accessKey"("sessionId");
CREATE INDEX "ixAccessKeyExpirySweep" ON "accessKey"("expiresAt")
  WHERE status IN ('confirmed', 'active');

CREATE TABLE "eventRecording" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId"       uuid NOT NULL REFERENCES "gameSession"(id),
  "egressId"        text NOT NULL,
  "storagePath"     text,
  "consentStatus"   text NOT NULL DEFAULT 'pending'
    CHECK ("consentStatus" IN ('pending','unanimous','declined')),
  status            text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','recording','ready','failed','deleted')),
  "retentionUntil"  timestamptz,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "deletedAt"       timestamptz
);
