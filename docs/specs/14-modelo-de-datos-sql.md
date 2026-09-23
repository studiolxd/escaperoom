# 14 — Modelo de datos SQL y migraciones (PostgreSQL)

Depende de `02-modelo-de-negocio.md`, `11-protocolo-multijugador.md` y `13-api-rest.md`.
**Este es el DDL consolidado**: todas las adendas que antes vivían repartidas entre documentos
de enmienda están fusionadas aquí.

---

## 1. Decisiones de diseño

- **Motor de migraciones: Prisma ORM** (TypeScript) en `packages/shared/prisma`, con
  `prisma migrate`. Las migraciones de `prisma/migrations/` son **SQL escrito a mano desde este
  DDL** (incluyen triggers, funciones, CHECKs, índices parciales y particiones, que Prisma no
  expresa). `schema.prisma` se genera con `prisma db pull` sobre la base migrada.
- **Nomenclatura camelCase en todo** (ADR-016): tablas y columnas en camelCase. Las tablas de auth
  usan el **modelo canónico de Better Auth** (`user`, `session`, `account`, `verification`,
  `organization`, `member`, `invitation`).
- **IDs:** las tablas de auth usan `text` (los genera Better Auth). El dominio usa `uuid`
  (`gen_random_uuid()`), con excepciones `accessKey.code` (código corto) y las series temporales
  (`bigserial`).
- **`createdAt` / `updatedAt`** en `timestamptz`, default `now()`, con trigger genérico
  `"setUpdatedAt"()`. Better Auth gestiona `"user"."updatedAt"` en la app (sin trigger).
- **Borrado lógico** (`"deletedAt"`) en `user` y `room` (RGPD + moderación: retirar sin perder el
  histórico de compras/reseñas que las referencian).
- **Nunca se guardan soluciones de puzzles en columnas propias.** Los puzzles, reglas y códigos
  viven exclusivamente dentro de `"roomVersion".package` (JSONB). Las tablas relacionales solo
  referencian `puzzleId` como texto lógico, sin FK. **No hay tabla `puzzle`.**
- **Dinero en enteros** (`*Cents`, moneda `currency char(3)`), nunca `float`.
- **Créditos en enteros** (`balanceCredits bigint`), convención copiada de SLXD.
- **ENUM de Postgres** para estados cerrados (nombres de tipo camelCase); `CHECK` para reglas
  numéricas/lógicas puntuales.
- **La tabla de sesiones de partida es `gameSession`**, para no chocar con `session` (auth).

## 2. Extensiones, helper y ENUMs

```sql
-- 0001_extensions.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- búsqueda por título de sala
CREATE EXTENSION IF NOT EXISTS "citext";     -- email case-insensitive

CREATE OR REPLACE FUNCTION "setUpdatedAt"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

```sql
-- 0002_enums.sql
CREATE TYPE "creditMovementType"  AS ENUM ('purchase', 'consumption', 'refund', 'adjustment');
CREATE TYPE "roomStatus"          AS ENUM ('draft', 'published', 'unlisted', 'archived', 'removed');
CREATE TYPE "eventStatus"         AS ENUM ('draft', 'active', 'closed');
CREATE TYPE "groupingMode"        AS ENUM ('specific', 'random', 'free');
CREATE TYPE "sessionStatus"       AS ENUM ('pending', 'in_progress', 'ended', 'aborted');
CREATE TYPE "accessKeyType"       AS ENUM ('individual', 'rotating', 'group', 'batch');
CREATE TYPE "accessKeyStatus"     AS ENUM ('generated', 'sent', 'pending_confirmation', 'confirmed', 'active', 'used', 'expired');
CREATE TYPE "purchaseType"        AS ENUM ('room', 'room_license', 'event_credits', 'platform_credits');
CREATE TYPE "purchaseStatus"      AS ENUM ('pending', 'succeeded', 'refunded', 'failed');
CREATE TYPE "progressEventKind"   AS ENUM ('solved', 'hint_used', 'attempt_failed');
CREATE TYPE "contentReportStatus" AS ENUM ('pending', 'reviewed', 'actioned', 'dismissed');
CREATE TYPE "eventAudience"       AS ENUM ('general', 'educational');
```

## 3. Auth (modelo canónico de Better Auth)

```sql
-- 0003_auth.sql
CREATE TABLE "user" (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  email               citext NOT NULL UNIQUE,
  "emailVerified"     boolean NOT NULL DEFAULT false,
  image               text,
  locale              text NOT NULL DEFAULT 'es',
  "stripeAccountId"   text,
  "stripeCustomerId"  text,
  "isAdmin"           boolean NOT NULL DEFAULT false,
  "isModerator"       boolean NOT NULL DEFAULT false,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  "deletedAt"         timestamptz
);

CREATE TABLE "session" (
  id                     text PRIMARY KEY,
  "expiresAt"            timestamptz NOT NULL,
  token                  text NOT NULL UNIQUE,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),
  "ipAddress"            text,
  "userAgent"            text,
  "userId"               text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "activeOrganizationId" text
);
CREATE INDEX "ixSessionUserId" ON "session"("userId");

CREATE TABLE "account" (
  id                       text PRIMARY KEY,
  "accountId"              text NOT NULL,
  "providerId"             text NOT NULL,
  "userId"                 text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken"            text,
  "refreshToken"           text,
  "idToken"                text,
  "accessTokenExpiresAt"   timestamptz,
  "refreshTokenExpiresAt"  timestamptz,
  scope                    text,
  password                 text,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixAccountUserId" ON "account"("userId");

CREATE TABLE "verification" (
  id          text PRIMARY KEY,
  identifier  text NOT NULL,
  value       text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixVerificationIdentifier" ON "verification"(identifier);

-- "Creador" y "Organizador" no son roles de tabla: cualquier user puede publicar o crear eventos.
CREATE TABLE "organization" (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  slug                text NOT NULL UNIQUE,
  logo                text,
  metadata            text,
  "stripeCustomerId"  text,
  "dpaSignedAt"       timestamptz,
  "createdAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "member" (
  id                text PRIMARY KEY,
  "organizationId"  text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  "userId"          text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'member',
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organizationId", "userId")
);
CREATE INDEX "ixMemberOrganizationId" ON "member"("organizationId");
CREATE INDEX "ixMemberUserId" ON "member"("userId");

CREATE TABLE "invitation" (
  id                text PRIMARY KEY,
  "organizationId"  text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  email             citext NOT NULL,
  role              text,
  status            text NOT NULL DEFAULT 'pending',
  "expiresAt"       timestamptz NOT NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "inviterId"       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX "ixInvitationOrganizationId" ON "invitation"("organizationId");
CREATE INDEX "ixInvitationEmail" ON "invitation"(email);
```

## 4. Ledger de créditos

```sql
-- 0004_credits.sql
CREATE TABLE "creditAccount" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"          text REFERENCES "user"(id),
  "organizationId"  text REFERENCES "organization"(id),
  "balanceCredits"  bigint NOT NULL DEFAULT 0 CHECK ("balanceCredits" >= 0),
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chkCreditAccountOwner" CHECK (
    (("userId" IS NOT NULL)::int + ("organizationId" IS NOT NULL)::int) = 1
  )
);
CREATE UNIQUE INDEX "uxCreditAccountUser" ON "creditAccount"("userId") WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "uxCreditAccountOrg"  ON "creditAccount"("organizationId") WHERE "organizationId" IS NOT NULL;
CREATE TRIGGER "trgCreditAccountUpdatedAt" BEFORE UPDATE ON "creditAccount"
  FOR EACH ROW EXECUTE FUNCTION "setUpdatedAt"();

CREATE TABLE "creditMovement" (
  id               bigserial PRIMARY KEY,
  "accountId"      uuid NOT NULL REFERENCES "creditAccount"(id),
  "movementType"   "creditMovementType" NOT NULL,
  "amountCredits"  bigint NOT NULL,             -- positivo = ingreso, negativo = consumo
  "balanceAfter"   bigint NOT NULL,
  "referenceType"  text,
  "referenceId"    text,                        -- audio: '{dialogId|hintId}:{locale}'
  metadata         jsonb NOT NULL DEFAULT '{}',
  "createdBy"      text REFERENCES "user"(id),
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixCreditMovementAccount" ON "creditMovement"("accountId", "createdAt" DESC);

-- El saldo NUNCA se escribe directo: siempre vía función transaccional.
CREATE OR REPLACE FUNCTION "applyCreditMovement"(
  p_account_id uuid, p_type "creditMovementType", p_amount bigint,
  p_reference_type text, p_reference_id text, p_metadata jsonb, p_created_by text
) RETURNS bigint AS $$
DECLARE v_new_balance bigint;
BEGIN
  UPDATE "creditAccount" SET "balanceCredits" = "balanceCredits" + p_amount
    WHERE id = p_account_id
    RETURNING "balanceCredits" INTO v_new_balance;
  INSERT INTO "creditMovement"("accountId", "movementType", "amountCredits", "balanceAfter",
    "referenceType", "referenceId", metadata, "createdBy")
    VALUES (p_account_id, p_type, p_amount, v_new_balance, p_reference_type, p_reference_id, p_metadata, p_created_by);
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;
-- El CHECK "balanceCredits" >= 0 hace que un consumo que dejaría saldo negativo aborte la
-- transacción entera (movimiento + update), sin caso especial en código.
```

## 5. Salas: cabecera, borrador colaborativo (Yjs) y versiones publicadas

```sql
-- 0005_rooms.sql
CREATE TABLE "room" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "authorId"             text NOT NULL REFERENCES "user"(id),
  title                  text NOT NULL,
  status                 "roomStatus" NOT NULL DEFAULT 'draft',
  "saleIndividual"       boolean NOT NULL DEFAULT true,
  "saleEvents"           boolean NOT NULL DEFAULT true,
  "priceCents"           int CHECK ("priceCents" IS NULL OR "priceCents" >= 0),
  currency               char(3) NOT NULL DEFAULT 'EUR',
  licensable             boolean NOT NULL DEFAULT false,
  "licensePriceCents"    int CHECK ("licensePriceCents" IS NULL OR "licensePriceCents" >= 0),
  "forkedFromRoomId"     uuid REFERENCES "room"(id),
  "forkedFromVersionId"  uuid,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),
  "deletedAt"            timestamptz
);
CREATE INDEX "ixRoomAuthor" ON "room"("authorId");
CREATE INDEX "ixRoomCatalog" ON "room"(status) WHERE status = 'published' AND "deletedAt" IS NULL;
CREATE INDEX "ixRoomTitleTrgm" ON "room" USING gin (title gin_trgm_ops);
CREATE TRIGGER "trgRoomUpdatedAt" BEFORE UPDATE ON "room"
  FOR EACH ROW EXECUTE FUNCTION "setUpdatedAt"();

CREATE TABLE "roomUpdate" (
  id            bigserial PRIMARY KEY,
  "roomId"      uuid NOT NULL REFERENCES "room"(id) ON DELETE CASCADE,
  "updateData"  bytea NOT NULL,
  "authorId"    text REFERENCES "user"(id),        -- null si lo generó el MCP
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixRoomUpdateRoom" ON "roomUpdate"("roomId", id);

CREATE TABLE "roomSnapshot" (
  id                       bigserial PRIMARY KEY,
  "roomId"                 uuid NOT NULL REFERENCES "room"(id) ON DELETE CASCADE,
  state                    bytea NOT NULL,
  "updatesAppliedThrough"  bigint NOT NULL,
  "createdAt"              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixRoomSnapshotRoom" ON "roomSnapshot"("roomId", id DESC);

CREATE TABLE "roomVersion" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roomId"       uuid NOT NULL REFERENCES "room"(id),
  semver         text NOT NULL,
  package        jsonb NOT NULL,                   -- RoomPackage íntegro
  "assetsHash"   text NOT NULL,
  changelog      text,
  "publishedBy"  text NOT NULL REFERENCES "user"(id),
  "publishedAt"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("roomId", semver)
);
CREATE INDEX "ixRoomVersionRoom" ON "roomVersion"("roomId", "publishedAt" DESC);
CREATE INDEX "ixRoomVersionPackage" ON "roomVersion" USING gin (package jsonb_path_ops);

ALTER TABLE "room"
  ADD CONSTRAINT "fkRoomForkedFromVersion"
  FOREIGN KEY ("forkedFromVersionId") REFERENCES "roomVersion"(id);
```

## 6. Eventos, sesiones de partida, grupos y claves de acceso

```sql
-- 0006_events.sql
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
  "pricingSnapshot"           jsonb NOT NULL,
  "playersPurchased"          int NOT NULL,
  status                      "eventStatus" NOT NULL DEFAULT 'draft',
  "createdAt"                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixEventOrganizer" ON "event"("organizerId");

CREATE TABLE "gameSession" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId"          uuid NOT NULL REFERENCES "event"(id),
  "colyseusRoomId"   text,
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
```

### 6.1 Asientos por clave y fin de grupo (ticket 5.5)

Migración posterior a esta spec, `0012_access_keys` (`specs/02` §4): una clave de grupo o rotativa
es un código compartido para N personas, así que la clave necesita saber cuántos asientos concede y
cuántos se han canjeado; y la regla `on_group_complete` necesita saber cuándo un grupo superó la sala.

```sql
-- 0012_access_keys.sql
ALTER TABLE "accessKey"
  ADD COLUMN seats           int NOT NULL DEFAULT 1,   -- individual/batch = 1; group/rotating = N
  ADD COLUMN "redeemedCount" int NOT NULL DEFAULT 0,   -- asientos canjeados (5.8)
  ADD CONSTRAINT "ckAccessKeySeats"
    CHECK (seats >= 0 AND "redeemedCount" >= 0 AND "redeemedCount" <= seats);
CREATE INDEX "ixAccessKeyGroup" ON "accessKey"("groupId");
DROP INDEX "ixAccessKeyExpirySweep";                   -- ahora cubre cualquier clave viva
CREATE INDEX "ixAccessKeyExpirySweep" ON "accessKey"("expiresAt")
  WHERE status NOT IN ('used', 'expired') AND "expiresAt" IS NOT NULL;
ALTER TABLE "group" ADD COLUMN "completedAt" timestamptz;  -- lo escribe el servidor de partida
```

- `Σ seats` de las claves de un evento ≤ `event."playersPurchased"` (lo garantiza el servicio con la
  fila del evento bloqueada).
- Al rotar, la clave vieja pasa a `expired` con `seats = "redeemedCount"` (puede quedar en 0) y la
  nueva (`regeneratedFrom`) hereda el resto: rotar no crea ni destruye asientos.

### 6.2 Envío de invitaciones (ticket 5.6)

Migración `0013_access_key_sent_at` (`specs/02` §4.4): sin confirmación obligatoria la clave nace
`active` y enviarla por email no cambia su estado (`sent` no es canjeable), así que el panel necesita
saber aparte si la invitación salió.

```sql
-- 0013_access_key_sent_at.sql
ALTER TABLE "accessKey" ADD COLUMN "sentAt" timestamptz;  -- último envío correcto del email
```

- Con `requireConfirmation`, el envío lleva además la clave de `generated`/`sent` a
  `pending_confirmation`; el enlace firmado del email la pasa a `confirmed` (`confirmedAt`).
- No se guarda el cuerpo del email ni un historial de envíos; la cola (Redis) solo lleva el código y
  el tipo de email, nunca la dirección (minimización, `specs/18` §3).

## 7. Compras y pagos

```sql
-- 0007_purchases.sql
CREATE TABLE "purchase" (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"                  text NOT NULL REFERENCES "user"(id),
  "purchaseType"            "purchaseType" NOT NULL,
  "roomVersionId"           uuid REFERENCES "roomVersion"(id),
  "eventId"                 uuid REFERENCES "event"(id),
  "resultingRoomId"         uuid REFERENCES "room"(id),
  "amountCents"             int NOT NULL,
  currency                  char(3) NOT NULL DEFAULT 'EUR',
  "platformFeeCents"        int NOT NULL DEFAULT 0,
  "creatorShareCents"       int,
  "stripePaymentIntentId"   text,
  "stripeTransferId"        text,
  status                    "purchaseStatus" NOT NULL DEFAULT 'pending',
  "playSessionStartedAt"    timestamptz,
  "playSessionColyseusId"   text,
  "createdAt"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chkPurchaseTarget" CHECK (
    ("purchaseType" IN ('room','room_license') AND "roomVersionId" IS NOT NULL AND "eventId" IS NULL)
    OR ("purchaseType" = 'event_credits' AND "eventId" IS NOT NULL AND "roomVersionId" IS NULL)
    OR ("purchaseType" = 'platform_credits' AND "roomVersionId" IS NULL AND "eventId" IS NULL)
  ),
  CONSTRAINT "chkPurchasePaidNeedsStripe" CHECK (
    "amountCents" = 0 OR "stripePaymentIntentId" IS NOT NULL
  )
);
CREATE INDEX "ixPurchaseUser" ON "purchase"("userId", "createdAt" DESC);
CREATE UNIQUE INDEX "uxPurchaseStripePi" ON "purchase"("stripePaymentIntentId")
  WHERE "stripePaymentIntentId" IS NOT NULL;

CREATE TABLE "stripeWebhookEvent" (
  id            text PRIMARY KEY,
  type          text NOT NULL,
  "receivedAt"  timestamptz NOT NULL DEFAULT now()
);
```

## 8. Precios, configuración de plataforma y progreso/analítica

```sql
-- 0008_pricing_settings_progress.sql
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
  "playerId"        text REFERENCES "user"(id),
  "accessKeyCode"   text REFERENCES "accessKey"(code),
  "puzzleId"        text NOT NULL,
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
```

## 9. Reseñas

```sql
-- 0009_reviews.sql
CREATE TABLE "review" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     text NOT NULL REFERENCES "user"(id),
  "roomId"     uuid NOT NULL REFERENCES "room"(id),
  rating       smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text         text,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "roomId")
);
CREATE INDEX "ixReviewRoom" ON "review"("roomId");
CREATE TRIGGER "trgReviewUpdatedAt" BEFORE UPDATE ON "review"
  FOR EACH ROW EXECUTE FUNCTION "setUpdatedAt"();
```

## 10. Moderación y apelaciones

```sql
-- 0010_moderation.sql
CREATE TABLE "contentReport" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reporterId"       text NOT NULL REFERENCES "user"(id),
  "roomVersionId"    uuid NOT NULL REFERENCES "roomVersion"(id),
  reason             text NOT NULL,
  details            text,
  severity           text NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('critical','high','normal','low')),
  category           text NOT NULL DEFAULT 'other',
  source             text NOT NULL DEFAULT 'user_report',
  status             "contentReportStatus" NOT NULL DEFAULT 'pending',
  "reviewedBy"       text REFERENCES "user"(id),
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "reviewedAt"       timestamptz
);
CREATE INDEX "ixContentReportStatus" ON "contentReport"(status) WHERE status = 'pending';
CREATE INDEX "ixContentReportSeverity" ON "contentReport"(severity, "createdAt");

CREATE TABLE "moderationAppeal" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "creatorId"         text NOT NULL REFERENCES "user"(id),
  "roomId"            uuid REFERENCES "room"(id),
  "contentReportId"   uuid REFERENCES "contentReport"(id),
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','upheld','overturned')),
  "reviewedBy"        text REFERENCES "user"(id),
  "resolutionNote"    text,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "reviewedAt"        timestamptz
);
CREATE INDEX "ixModerationAppealStatus" ON "moderationAppeal"(status) WHERE status = 'pending';
```

### 10.1 Audio subido por el creador (ticket 3.11)

Migración posterior a esta spec, `0011_audio_assets` (`specs/15` §1 y §4, `specs/17` §1): las
subidas de assets custom pasan por la cola humana **antes** de poder usarse en una sala publicada.
La biblioteca incluida no vive en la base de datos (manifiesto en código, binarios en R2).

```sql
-- 0011_audio_assets.sql
CREATE TABLE "audioAsset" (
  id                  uuid PRIMARY KEY,               -- generado en el servicio (forma la clave de R2)
  "ownerId"           text NOT NULL REFERENCES "user"(id),
  "organizationId"    text REFERENCES "organization"(id),
  "storageKey"        text NOT NULL UNIQUE,           -- uploads/audio/{ownerId}/{id}.mp3
  "originalFilename"  text NOT NULL,
  "contentType"       text NOT NULL,
  "byteSize"          int NOT NULL CHECK ("byteSize" > 0),
  "durationMs"        int NOT NULL CHECK ("durationMs" > 0),
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  "moderationFlags"   text[] NOT NULL DEFAULT '{}',
  "rejectionReason"   text,
  "reviewedBy"        text REFERENCES "user"(id),
  "reviewedAt"        timestamptz,
  "rightsDeclaredAt"  timestamptz NOT NULL,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR "rejectionReason" IS NOT NULL),
  CHECK ((status = 'pending') = ("reviewedAt" IS NULL))
);
CREATE INDEX "ixAudioAssetOwner" ON "audioAsset"("ownerId", "createdAt" DESC);
CREATE INDEX "ixAudioAssetPending" ON "audioAsset"("createdAt") WHERE status = 'pending';
```

## 11. Relaciones — vista de conjunto

```
user ──< member >── organization
user ──< creditAccount >── organization            (dueño exclusivo: user XOR org)
creditAccount ──< creditMovement

user ──< room ──< roomUpdate / roomSnapshot / roomVersion
room ──< room (forkedFromRoomId)                   (linaje de licencias)

user ──< event >── roomVersion
event ──< gameSession ──< group
event ──< accessKey >── gameSession / group
gameSession ──< eventRecording

user ──< purchase >── roomVersion | event
purchase ──< room (resultingRoomId)

gameSession ──< progressEvent >── group / accessKey

user ──< review >── room

user ──< contentReport >── roomVersion
user ──< moderationAppeal >── room | contentReport
user ──< audioAsset                                (dueño; revisor = user moderador)

pricingTier / platformSetting / stripeWebhookEvent     (independientes)
analyticsEvent                                         (sin FK, alto volumen)
```

## 12. Estrategia de migraciones

- Carpeta `packages/shared/prisma/migrations/`: migraciones **SQL escritas a mano desde este DDL**,
  aplicadas con `prisma migrate deploy`. `packages/shared/prisma/schema.prisma` se genera con
  `prisma db pull` sobre la base migrada (no se edita a mano) y el cliente con `prisma generate`.
- Numeración secuencial `0001_extensions` … `0010_moderation` (cada bloque de esta spec es una
  migración real, en este orden, por dependencias de FK).
- **Sin migración de datos de SLXD** (decisión 2026-09-22): de SLXD se reutiliza **código**
  (identidad/orgs/ledger se copian/adaptan, ADR-017), no sus datos. No hay script de importación.
- Entorno local: `pnpm db:migrate` aplica migraciones pendientes; `pnpm db:seed` carga usuario
  admin, creador de ejemplo y publica el Rey Aldric como `roomVersion` real.
- CI: cada PR levanta Postgres efímero, aplica todas las migraciones desde cero y corre el test
  E2E del Rey Aldric.
- **Job de purga de `analyticsEvent`** (pendiente, Fase 6): la partición ya existe; falta el
  cron (pg_cron o scheduler del backend) con retención de 24 meses en detalle.

## 13. Dependencias

- `specs/02-modelo-de-negocio.md`, `specs/13-api-rest.md`, `specs/12-voz-y-webcam-livekit.md`,
  `specs/17-moderacion-de-contenido.md`, `specs/18-legal-rgpd-y-menores.md`.
