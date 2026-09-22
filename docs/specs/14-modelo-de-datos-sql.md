# 14 — Modelo de datos SQL y migraciones (PostgreSQL)

Depende de `02-modelo-de-negocio.md`, `11-protocolo-multijugador.md` y `13-api-rest.md`.
**Este es el DDL consolidado**: todas las adendas que antes vivían repartidas entre documentos
de enmienda están fusionadas aquí.

---

## 1. Decisiones de diseño

- **Motor de migraciones: Prisma ORM** (TypeScript) en `packages/shared/db`, con `prisma migrate`.
  Los tipos de Prisma Client se comparten con API, Colyseus y MCP ("cero deriva de tipos").
- **UUID v7** como PK en casi todas las tablas (ordenable por tiempo). Excepciones: `access_keys.code`
  (código corto) y las series temporales (`bigserial`).
- **`created_at` / `updated_at`** en `timestamptz`, default `now()`, con trigger genérico
  `set_updated_at()`.
- **Borrado lógico** (`deleted_at`) en `users` y `rooms` (RGPD + moderación: retirar sin perder el
  histórico de compras/reseñas que las referencian).
- **Nunca se guardan soluciones de puzzles en columnas propias.** Los puzzles, reglas y códigos
  viven exclusivamente dentro de `room_versions.package` (JSONB). Las tablas relacionales solo
  referencian `puzzle_id` como texto lógico, sin FK. **No hay tabla `puzzles`.**
- **Dinero en enteros** (`_cents`, moneda `_currency char(3)`), nunca `float`.
- **Créditos en enteros** (`_credits bigint`), convención copiada de SLXD.
- **ENUM de Postgres** para estados cerrados; `CHECK` para reglas numéricas/lógicas puntuales.

## 2. Extensiones y tipos base

```sql
-- 0001_extensions.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- búsqueda por título de sala
CREATE EXTENSION IF NOT EXISTS "citext";     -- email case-insensitive

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

```sql
-- 0002_enums.sql
CREATE TYPE credit_movement_type   AS ENUM ('purchase', 'consumption', 'refund', 'adjustment');
CREATE TYPE room_status            AS ENUM ('draft', 'published', 'unlisted', 'archived', 'removed');
CREATE TYPE event_status           AS ENUM ('draft', 'active', 'closed');
CREATE TYPE grouping_mode          AS ENUM ('specific', 'random', 'free');
CREATE TYPE session_status         AS ENUM ('pending', 'in_progress', 'ended', 'aborted');
CREATE TYPE access_key_type        AS ENUM ('individual', 'rotating', 'group', 'batch');
CREATE TYPE access_key_status      AS ENUM ('generated', 'sent', 'pending_confirmation', 'confirmed', 'active', 'used', 'expired');
CREATE TYPE purchase_type          AS ENUM ('room', 'room_license', 'event_credits', 'platform_credits');
CREATE TYPE purchase_status        AS ENUM ('pending', 'succeeded', 'refunded', 'failed');
CREATE TYPE progress_event_kind    AS ENUM ('solved', 'hint_used', 'attempt_failed');
CREATE TYPE content_report_status  AS ENUM ('pending', 'reviewed', 'actioned', 'dismissed');
CREATE TYPE event_audience         AS ENUM ('general', 'educational');
```

## 3. Usuarios y organizaciones (copiado/adaptado de SLXD)

```sql
-- 0003_users_orgs.sql
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  password_hash      text,                      -- null si solo usa OAuth
  display_name       text NOT NULL,
  avatar_url         text,
  locale             text NOT NULL DEFAULT 'es',
  stripe_account_id  text,                       -- Stripe Connect (creador)
  stripe_customer_id text,                       -- Stripe Customer (comprador)
  is_admin           boolean NOT NULL DEFAULT false,
  is_moderator       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- "Creador" y "Organizador" no son roles de tabla: cualquier user puede publicar o crear eventos.
CREATE TABLE oauth_identities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       text NOT NULL,                 -- 'google', 'github'...
  provider_uid   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE organizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  owner_user_id      uuid NOT NULL REFERENCES users(id),
  stripe_customer_id text,
  dpa_signed_at      timestamptz,               -- requisito para claves individuales con email
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_members (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_role         text NOT NULL DEFAULT 'member' CHECK (org_role IN ('owner','admin','member')),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
```

## 4. Ledger de créditos

```sql
-- 0004_credits.sql
CREATE TABLE credit_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users(id),
  organization_id  uuid REFERENCES organizations(id),
  balance_credits  bigint NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_exactly_one_owner CHECK (
    (user_id IS NOT NULL)::int + (organization_id IS NOT NULL)::int = 1
  )
);
CREATE UNIQUE INDEX ux_credit_accounts_user ON credit_accounts(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_credit_accounts_org  ON credit_accounts(organization_id) WHERE organization_id IS NOT NULL;
CREATE TRIGGER trg_credit_accounts_updated_at BEFORE UPDATE ON credit_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE credit_movements (
  id               bigserial PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES credit_accounts(id),
  movement_type    credit_movement_type NOT NULL,
  amount_credits   bigint NOT NULL,             -- positivo = ingreso, negativo = consumo
  balance_after    bigint NOT NULL,
  reference_type   text,                        -- 'audio_generation' | 'stripe_payment' | 'manual_adjustment'
  reference_id     text,                        -- id de generación IA, payment intent… (audio: '{dialogId|hintId}:{locale}')
  metadata         jsonb NOT NULL DEFAULT '{}', -- {"characters": 812, "voice_id": "..."}
  created_by       uuid REFERENCES users(id),   -- null = sistema
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_credit_movements_account ON credit_movements(account_id, created_at DESC);

-- El saldo NUNCA se escribe directo: siempre vía función transaccional.
CREATE OR REPLACE FUNCTION apply_credit_movement(
  p_account_id uuid, p_type credit_movement_type, p_amount bigint,
  p_reference_type text, p_reference_id text, p_metadata jsonb, p_created_by uuid
) RETURNS bigint AS $$
DECLARE v_new_balance bigint;
BEGIN
  UPDATE credit_accounts SET balance_credits = balance_credits + p_amount
    WHERE id = p_account_id
    RETURNING balance_credits INTO v_new_balance;
  INSERT INTO credit_movements(account_id, movement_type, amount_credits, balance_after,
    reference_type, reference_id, metadata, created_by)
    VALUES (p_account_id, p_type, p_amount, v_new_balance, p_reference_type, p_reference_id, p_metadata, p_created_by);
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;
-- El CHECK balance_credits >= 0 hace que un consumo que dejaría saldo negativo aborte la
-- transacción entera (movimiento + update), sin caso especial en código.
```

## 5. Salas: cabecera, borrador colaborativo (Yjs) y versiones publicadas

```sql
-- 0005_rooms.sql
CREATE TABLE rooms (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id             uuid NOT NULL REFERENCES users(id),
  title                 text NOT NULL,             -- denormalizado del draft
  status                room_status NOT NULL DEFAULT 'draft',
  sale_individual       boolean NOT NULL DEFAULT true,
  sale_events           boolean NOT NULL DEFAULT true,
  price_cents           int CHECK (price_cents IS NULL OR price_cents >= 0),
  currency              char(3) NOT NULL DEFAULT 'EUR',
  licensable            boolean NOT NULL DEFAULT false,
  license_price_cents   int CHECK (license_price_cents IS NULL OR license_price_cents >= 0),
  forked_from_room_id   uuid REFERENCES rooms(id),
  forked_from_version_id uuid REFERENCES room_versions(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX ix_rooms_author ON rooms(author_id);
CREATE INDEX ix_rooms_catalog ON rooms(status) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX ix_rooms_title_trgm ON rooms USING gin (title gin_trgm_ops);
CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- El linaje (forked_from_*) se conserva siempre (moderación, atribución interna), aunque la UI
-- decida no mostrarlo públicamente.

CREATE TABLE room_updates (
  id          bigserial PRIMARY KEY,
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  update_data bytea NOT NULL,
  author_id   uuid REFERENCES users(id),        -- null si lo generó el MCP
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_room_updates_room ON room_updates(room_id, id);

CREATE TABLE room_snapshots (
  id                      bigserial PRIMARY KEY,
  room_id                 uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  state                   bytea NOT NULL,
  updates_applied_through bigint NOT NULL,       -- último room_updates.id incluido
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_room_snapshots_room ON room_snapshots(room_id, id DESC);
-- Retención (job, no constraint): tras crear un snapshot, borrar room_updates con id <=
-- updates_applied_through de snapshots anteriores al último.

CREATE TABLE room_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL REFERENCES rooms(id),
  semver        text NOT NULL,                  -- '1.0.0', '1.1.0'...
  package       jsonb NOT NULL,                 -- RoomPackage íntegro (incluye packageFormat en meta)
  assets_hash   text NOT NULL,
  changelog     text,
  published_by  uuid NOT NULL REFERENCES users(id),
  published_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, semver)
);
CREATE INDEX ix_room_versions_room ON room_versions(room_id, published_at DESC);
CREATE INDEX ix_room_versions_package ON room_versions USING gin (package jsonb_path_ops);
```

## 6. Eventos, sesiones, grupos y claves de acceso

```sql
-- 0006_events.sql
CREATE TABLE events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id              uuid NOT NULL REFERENCES users(id),
  room_version_id           uuid NOT NULL REFERENCES room_versions(id),
  title                     text NOT NULL,
  audience                  event_audience NOT NULL DEFAULT 'general',
  max_simultaneous_sessions smallint NOT NULL DEFAULT 10,
  grouping_mode             grouping_mode NOT NULL DEFAULT 'random',
  require_confirmation      boolean NOT NULL DEFAULT false,
  config                    jsonb NOT NULL DEFAULT '{}',
    -- { "allowVideo": false, "recordingEnabled": false }
  expiry_rules              jsonb NOT NULL DEFAULT '[]',
    -- [{"type":"hours_after_start","hours":24},{"type":"on_session_end"},{"type":"on_group_complete"}]
  pricing_snapshot          jsonb NOT NULL,      -- tramos vigentes en el momento de compra
  players_purchased         int NOT NULL,
  status                    event_status NOT NULL DEFAULT 'draft',
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_events_organizer ON events(organizer_id);

CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES events(id),
  colyseus_room_id  text,                        -- se rellena al arrancar la partida real
  name              text NOT NULL,
  status            session_status NOT NULL DEFAULT 'pending',
  capacity          smallint NOT NULL,
  started_at        timestamptz,
  ended_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sessions_event ON sessions(event_id);

CREATE TABLE groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_groups_session ON groups(session_id);

CREATE TABLE access_keys (
  code                 text PRIMARY KEY,        -- 'RALD-7F3K'
  event_id             uuid NOT NULL REFERENCES events(id),
  session_id           uuid REFERENCES sessions(id),
  group_id             uuid REFERENCES groups(id),
  email                citext,
  key_type             access_key_type NOT NULL,
  status               access_key_status NOT NULL DEFAULT 'generated',
  single_use           boolean NOT NULL DEFAULT true,
  require_confirmation boolean NOT NULL DEFAULT false,
  regenerated_from     text REFERENCES access_keys(code),
  confirmed_at         timestamptz,
  activated_at         timestamptz,
  used_at              timestamptz,
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_access_keys_event ON access_keys(event_id);
CREATE INDEX ix_access_keys_session ON access_keys(session_id);
-- Caducidad por job periódico (cada 1 min):
--   UPDATE access_keys SET status = 'expired'
--   WHERE status IN ('confirmed','active') AND expires_at IS NOT NULL AND expires_at < now();
-- Se actualiza el status, no se borra la fila (el panel muestra claves caducadas).
CREATE INDEX ix_access_keys_expiry_sweep ON access_keys(expires_at)
  WHERE status IN ('confirmed', 'active');

CREATE TABLE event_recordings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES sessions(id),
  egress_id        text NOT NULL,
  storage_path     text,
  consent_status   text NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending','unanimous','declined')),
  status           text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','recording','ready','failed','deleted')),
  retention_until  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
```

## 7. Compras y pagos

```sql
-- 0007_purchases.sql
CREATE TABLE purchases (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users(id),
  purchase_type             purchase_type NOT NULL,
  room_version_id           uuid REFERENCES room_versions(id),   -- 'room' | 'room_license'
  event_id                  uuid REFERENCES events(id),          -- 'event_credits'
  resulting_room_id         uuid REFERENCES rooms(id),           -- fork completado (licencia/regalo)
  amount_cents              int NOT NULL,
  currency                  char(3) NOT NULL DEFAULT 'EUR',
  platform_fee_cents        int NOT NULL DEFAULT 0,
  creator_share_cents       int,
  stripe_payment_intent_id  text,                                -- null si amount = 0 (regalo)
  stripe_transfer_id        text,                                -- payout al creador vía Connect
  status                    purchase_status NOT NULL DEFAULT 'pending',
  play_session_started_at   timestamptz,                         -- B2C: una partida
  play_session_colyseus_id  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_purchase_target CHECK (
    (purchase_type IN ('room','room_license') AND room_version_id IS NOT NULL AND event_id IS NULL)
    OR (purchase_type = 'event_credits' AND event_id IS NOT NULL AND room_version_id IS NULL)
    OR (purchase_type = 'platform_credits' AND room_version_id IS NULL AND event_id IS NULL)
  ),
  CONSTRAINT chk_purchases_paid_needs_stripe CHECK (
    amount_cents = 0 OR stripe_payment_intent_id IS NOT NULL
  )
);
CREATE INDEX ix_purchases_user ON purchases(user_id, created_at DESC);
CREATE UNIQUE INDEX ux_purchases_stripe_pi ON purchases(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Idempotencia del webhook de Stripe
CREATE TABLE stripe_webhook_events (
  id          text PRIMARY KEY,                  -- event.id de Stripe
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
```

## 8. Precios, configuración de plataforma y progreso/analítica

```sql
-- 0008_pricing_settings_progress.sql

-- Tramos de precio editables: cambiar precios = nueva fila con active_from futuro + cierre de la
-- anterior con active_until. Nunca UPDATE de una fila vigente.
CREATE TABLE pricing_tiers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_players            int NOT NULL,
  max_players            int,                    -- null = sin límite superior (tramo "151+")
  price_cents_per_player int NOT NULL,
  currency               char(3) NOT NULL DEFAULT 'EUR',
  active_from            timestamptz NOT NULL DEFAULT now(),
  active_until           timestamptz,
  created_by             uuid NOT NULL REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_pricing_tiers_active ON pricing_tiers(active_from, active_until);

-- Ajustes de plataforma (p. ej. max_players_per_room, compartido por validador y LiveKit)
CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (key, value) VALUES ('max_players_per_room', '6');

-- Progreso "de negocio" (panel del organizador, ranking entre grupos)
CREATE TABLE progress_events (
  id               bigserial PRIMARY KEY,
  session_id       uuid NOT NULL REFERENCES sessions(id),
  group_id         uuid REFERENCES groups(id),
  player_id        uuid REFERENCES users(id),      -- null si el jugador entró solo con clave
  access_key_code  text REFERENCES access_keys(code),
  puzzle_id        text NOT NULL,                  -- id lógico dentro del RoomPackage, no FK
  event_kind       progress_event_kind NOT NULL,
  duration_ms      int,
  hints_used       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_progress_events_session ON progress_events(session_id, created_at);
CREATE INDEX ix_progress_events_group ON progress_events(group_id);

-- Analítica fina (alta volumen → particionada por mes desde el día uno)
CREATE TABLE analytics_events (
  id               bigserial NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  event_type       text NOT NULL,
  session_id       uuid,
  player_id        uuid,
  room_version_id  uuid,
  payload          jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE analytics_events_2026_09 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE analytics_events_2026_10 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- Job mensual crea la partición del mes siguiente con 1 mes de antelación y archiva >12 meses.
CREATE INDEX ix_analytics_events_type ON analytics_events(event_type, created_at);
CREATE INDEX ix_analytics_events_session ON analytics_events(session_id);
```

## 9. Reseñas

```sql
-- 0009_reviews.sql
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  room_id     uuid NOT NULL REFERENCES rooms(id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, room_id)
);
CREATE INDEX ix_reviews_room ON reviews(room_id);
CREATE TRIGGER trg_reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- La reseña se ancla a room_id (la sala en general), no a room_version_id: parchear no debe
-- fragmentar el conteo de estrellas del catálogo.
```

## 10. Moderación y apelaciones

```sql
-- 0010_moderation.sql
CREATE TABLE content_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid NOT NULL REFERENCES users(id),
  room_version_id  uuid NOT NULL REFERENCES room_versions(id),
  reason           text NOT NULL,
  details          text,
  severity         text NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('critical','high','normal','low')),
  category         text NOT NULL DEFAULT 'other',
    -- 'illegal_content' | 'minor_safety' | 'harassment' | 'copyright' | 'spam' | 'quality' | 'other'
  source           text NOT NULL DEFAULT 'user_report',
    -- 'user_report' | 'auto_flag' | 'random_sample'
  status           content_report_status NOT NULL DEFAULT 'pending',
  reviewed_by      uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz
);
CREATE INDEX ix_content_reports_status ON content_reports(status) WHERE status = 'pending';
CREATE INDEX ix_content_reports_severity ON content_reports(severity, created_at);

CREATE TABLE moderation_appeals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        uuid NOT NULL REFERENCES users(id),
  room_id           uuid REFERENCES rooms(id),           -- null si apela estado de cuenta
  content_report_id uuid REFERENCES content_reports(id),
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','upheld','overturned')),
  reviewed_by       uuid REFERENCES users(id),
  resolution_note   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz
);
CREATE INDEX ix_moderation_appeals_status ON moderation_appeals(status) WHERE status = 'pending';
```

## 11. Relaciones — vista de conjunto

```
users ──< organization_members >── organizations
users ──< credit_accounts >── organizations        (dueño exclusivo: user XOR org)
credit_accounts ──< credit_movements

users ──< rooms ──< room_updates / room_snapshots / room_versions
rooms ──< rooms (forked_from_room_id)              (linaje de licencias)

users ──< events >── room_versions
events ──< sessions ──< groups
events ──< access_keys >── sessions / groups
sessions ──< event_recordings

users ──< purchases >── room_versions | events
purchases ──< rooms (resulting_room_id)

sessions ──< progress_events >── groups / access_keys

users ──< reviews >── rooms
users ──< content_reports >── room_versions
users ──< moderation_appeals >── rooms | content_reports

pricing_tiers / platform_settings / stripe_webhook_events     (independientes)
analytics_events                                               (sin FK, alto volumen)
```

## 12. Estrategia de migraciones

- Carpeta `packages/shared/db/prisma/migrations/`, generadas con `prisma migrate dev`; las
  migraciones SQL resultantes son la fuente de verdad para `prisma migrate deploy`.
- Numeración secuencial `0001_extensions` … `0010_moderation` (cada bloque de esta spec es una
  migración real, en este orden, por dependencias de FK).
- **Migración de datos de SLXD** (usuarios, organizaciones, ledger de créditos): script de
  importación aparte (`scripts/import-slxd-ledger.ts`), a ejecutar una sola vez tras `0004_credits.sql`.
  El esquema destino ya está fijado en §3–§4; el script solo transforma.
- Entorno local: `pnpm db:migrate` aplica migraciones pendientes; `pnpm db:seed` carga usuario
  admin, creador de ejemplo y publica el Rey Aldric como `room_versions` real.
- CI: cada PR levanta Postgres efímero, aplica todas las migraciones desde cero y corre el test
  E2E del Rey Aldric.
- **Job de purga de `analytics_events`** (pendiente, Fase 6): la partición ya existe; falta el
  cron (pg_cron o scheduler del backend) con retención de 24 meses en detalle.

## 13. Dependencias

- `specs/02-modelo-de-negocio.md`, `specs/13-api-rest.md`, `specs/12-voz-y-webcam-livekit.md`,
  `specs/17-moderacion-de-contenido.md`, `specs/18-legal-rgpd-y-menores.md`.
