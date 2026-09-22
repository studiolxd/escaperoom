# Esquema SQL completo y migraciones (PostgreSQL)

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§12), `protocolo-mensajes-colyseus.md` y `roompackage-rey-aldric-v1.0.md`.

Este documento es el DDL real: tipos, claves, índices, constraints y la estrategia de migraciones. Con esto se puede levantar la base de datos y empezar el backend sin preguntas pendientes sobre el modelo de datos.

---

## 1. Decisiones de diseño

- **Motor de migraciones: Drizzle ORM** (TypeScript). Vive en `packages/shared/db` — los tipos generados se comparten con la API, el servidor Colyseus y el MCP (mismo principio de "cero deriva de tipos" que ya usamos para los schemas Zod del MCP).
- **UUID v7** (ordenable por tiempo, mejor para índices que UUID v4 random) como PK en casi todas las tablas. Excepciones: `access_keys.code` (código corto legible/compartible) y las tablas de series temporales (`bigserial`).
- **`created_at` / `updated_at`** en `timestamptz`, default `now()`, en toda tabla mutable. `updated_at` se mantiene con trigger genérico (`set_updated_at()`), no en aplicación.
- **Borrado lógico** (`deleted_at timestamptz null`) en `users` y `rooms`: por RGPD y por moderación necesitamos poder "retirar" sin perder el histórico de compras/reseñas que los referencian.
- **Nunca se guardan soluciones de puzzles en columnas propias.** Los puzzles, reglas, códigos, etc. viven exclusivamente dentro de `room_versions.package` (JSONB, el RoomPackage). Las tablas relacionales solo referencian `puzzle_id` como texto (identificador lógico dentro del JSON), nunca como FK — no hay tabla `puzzles`.
- **Dinero en enteros** (`_cents`, moneda en `_currency char(3)`), nunca `float`.
- **Créditos en enteros** (`_credits bigint`), no decimales — ya es la convención copiada de SLXD.
- Se usan **tipos `ENUM` de Postgres** para estados cerrados (más baratos en índice y más explícitos que `CHECK IN (...)`) y `CHECK` para reglas numéricas/lógicas puntuales.

---

## 2. Extensiones y tipos base

```sql
-- 0001_extensions.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- búsqueda por título de sala en el catálogo

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
CREATE TYPE purchase_type          AS ENUM ('room', 'event_credits', 'platform_credits');
CREATE TYPE purchase_status        AS ENUM ('pending', 'succeeded', 'refunded', 'failed');
CREATE TYPE progress_event_kind    AS ENUM ('solved', 'hint_used', 'attempt_failed');
CREATE TYPE content_report_status  AS ENUM ('pending', 'reviewed', 'actioned', 'dismissed');
```

---

## 3. Usuarios y organizaciones (copiado/adaptado de SLXD)

Toda esta sección (usuarios, organizaciones, ledger de créditos §4) es la que **ya existe desarrollada en SLXD** y se porta con cambios mínimos: la mecánica de cuentas personales/de organización, saldo e histórico es idéntica; lo que cambia son las referencias de negocio (aquí `reference_type` apunta a compras de sala, eventos o generaciones IA, no a los conceptos propios de SLXD). El mapeo columna a columna exacto contra el DDL real de SLXD queda pendiente de hacerse cuando se ejecute la copia — aquí se define el esquema **destino**.

```sql
-- 0003_users_orgs.sql

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  password_hash     text,                      -- null si solo usa OAuth
  display_name      text NOT NULL,
  avatar_url        text,
  locale            text NOT NULL DEFAULT 'es',
  stripe_account_id text,                       -- Stripe Connect, solo si publica salas
  stripe_customer_id text,                      -- Stripe Customer, solo si compra
  is_admin          boolean NOT NULL DEFAULT false,
  is_moderator      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE EXTENSION IF NOT EXISTS citext;  -- email case-insensitive
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- "Creador" y "Organizador" no son roles de tabla: cualquier user puede publicar
-- una sala o crear un evento. is_admin/is_moderator son los únicos roles de staff.

CREATE TABLE oauth_identities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       text NOT NULL,                 -- 'google', 'github'...
  provider_uid   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  owner_user_id       uuid NOT NULL REFERENCES users(id),
  stripe_customer_id  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_members (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_role         text NOT NULL DEFAULT 'member' CHECK (org_role IN ('owner', 'admin', 'member')),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
```

---

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
-- Una cuenta por titular (personal o de organización)
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
  reference_type   text,                        -- 'audio_generation' | 'stripe_payment' | 'manual_adjustment'...
  reference_id     text,                        -- id de la generación IA, del payment intent, etc.
  metadata         jsonb NOT NULL DEFAULT '{}', -- p.ej. {"characters": 812, "voice_id": "..."}
  created_by       uuid REFERENCES users(id),   -- quién disparó el movimiento (null = sistema)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_credit_movements_account ON credit_movements(account_id, created_at DESC);

-- El saldo NUNCA se escribe directo en credit_accounts desde la aplicación:
-- siempre vía función que inserta el movimiento y actualiza el balance en la misma transacción.
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
-- El CHECK balance_credits >= 0 de la tabla hace que un consumo que dejaría saldo
-- negativo aborte la transacción entera (movimiento + update) — sin caso especial en código.
```

---

## 5. Salas: cabecera, borrador colaborativo (Yjs) y versiones publicadas

```sql
-- 0005_rooms.sql

CREATE TABLE rooms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       uuid NOT NULL REFERENCES users(id),
  title           text NOT NULL,               -- denormalizado del draft, para listar rápido en "mis salas"
  status          room_status NOT NULL DEFAULT 'draft',
  sale_individual boolean NOT NULL DEFAULT true,
  sale_events     boolean NOT NULL DEFAULT true,
  price_cents     int CHECK (price_cents IS NULL OR price_cents >= 0),
  currency        char(3) NOT NULL DEFAULT 'EUR',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX ix_rooms_author ON rooms(author_id);
CREATE INDEX ix_rooms_catalog ON rooms(status) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX ix_rooms_title_trgm ON rooms USING gin (title gin_trgm_ops);  -- búsqueda de catálogo
CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Log append-only de updates binarios de Yjs (la escritura continua del editor colaborativo).
CREATE TABLE room_updates (
  id          bigserial PRIMARY KEY,
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  update_data bytea NOT NULL,
  author_id   uuid REFERENCES users(id),        -- null si lo generó el agente MCP con su propio actor id aparte
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_room_updates_room ON room_updates(room_id, id);

-- Snapshot periódico (squash) para no tener que reproducir miles de updates al abrir el editor.
CREATE TABLE room_snapshots (
  id                      bigserial PRIMARY KEY,
  room_id                 uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  state                   bytea NOT NULL,
  updates_applied_through bigint NOT NULL,       -- último room_updates.id incluido en este snapshot
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_room_snapshots_room ON room_snapshots(room_id, id DESC);
-- Política de retención (job periódico, no constraint de BD): tras crear un snapshot nuevo,
-- borrar room_updates con id <= updates_applied_through de snapshots anteriores al último.

-- Versión publicada e inmutable: el RoomPackage completo tal y como se define en
-- especificaciones-escape-room-creator-v1.0.md §9, congelado en JSONB.
CREATE TABLE room_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL REFERENCES rooms(id),
  semver        text NOT NULL,                  -- '1.0.0', '1.1.0'...
  package       jsonb NOT NULL,                 -- RoomPackage íntegro
  assets_hash   text NOT NULL,                  -- hash del manifest de assets empaquetados en R2
  changelog     text,
  published_by  uuid NOT NULL REFERENCES users(id),
  published_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, semver)
);
CREATE INDEX ix_room_versions_room ON room_versions(room_id, published_at DESC);
-- Índice GIN para que el validador/MCP puedan hacer consultas puntuales sobre el JSON si hace falta
CREATE INDEX ix_room_versions_package ON room_versions USING gin (package jsonb_path_ops);
```

---

## 6. Eventos, sesiones, grupos y claves de acceso

```sql
-- 0006_events.sql

CREATE TABLE events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id             uuid NOT NULL REFERENCES users(id),
  room_version_id          uuid NOT NULL REFERENCES room_versions(id),
  title                    text NOT NULL,
  max_simultaneous_sessions smallint NOT NULL DEFAULT 10,
  grouping_mode            grouping_mode NOT NULL DEFAULT 'random',
  require_confirmation     boolean NOT NULL DEFAULT false,
  expiry_rules             jsonb NOT NULL DEFAULT '[]',
    -- array combinable, p.ej.:
    -- [{"type":"hours_after_start","hours":24},
    --  {"type":"on_session_end"},
    --  {"type":"on_group_complete"}]
  pricing_snapshot         jsonb NOT NULL,      -- tabla de tramos vigente en el momento de compra (§3.2)
  players_purchased        int NOT NULL,
  status                   event_status NOT NULL DEFAULT 'draft',
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_events_organizer ON events(organizer_id);

CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events(id),
  colyseus_room_id text,                        -- se rellena al arrancar la partida real
  name             text NOT NULL,
  status           session_status NOT NULL DEFAULT 'pending',
  capacity         smallint NOT NULL,
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sessions_event ON sessions(event_id);

CREATE TABLE groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_groups_session ON groups(session_id);

-- code es la PK: es el propio identificador que se reparte/canjea, no hace falta uuid aparte.
CREATE TABLE access_keys (
  code                 text PRIMARY KEY,        -- código corto, p.ej. 'RALD-7F3K'
  event_id             uuid NOT NULL REFERENCES events(id),
  session_id           uuid REFERENCES sessions(id),
  group_id             uuid REFERENCES groups(id),
  email                citext,
  key_type             access_key_type NOT NULL,
  status               access_key_status NOT NULL DEFAULT 'generated',
  single_use           boolean NOT NULL DEFAULT true,
  require_confirmation boolean NOT NULL DEFAULT false,
  regenerated_from     text REFERENCES access_keys(code),  -- historial de rotación de claves 'rotating'
  confirmed_at         timestamptz,
  activated_at         timestamptz,
  used_at              timestamptz,
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_access_keys_event ON access_keys(event_id);
CREATE INDEX ix_access_keys_session ON access_keys(session_id);
-- La caducidad NO se aplica con TTL nativo (Postgres no lo tiene): un job periódico
-- (pg_cron o el scheduler del backend, cada 1 min) hace
--   UPDATE access_keys SET status = 'expired'
--   WHERE status IN ('confirmed','active') AND expires_at IS NOT NULL AND expires_at < now();
-- Se actualiza el status en vez de borrar la fila: el panel del organizador necesita
-- seguir mostrando claves caducadas (§3.5, "claves: enviadas/confirmadas/usadas/caducadas").
CREATE INDEX ix_access_keys_expiry_sweep ON access_keys(expires_at)
  WHERE status IN ('confirmed', 'active');
```

---

## 7. Compras y pagos

```sql
-- 0007_purchases.sql

CREATE TABLE purchases (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id),
  purchase_type            purchase_type NOT NULL,
  room_version_id          uuid REFERENCES room_versions(id),   -- solo si purchase_type = 'room'
  event_id                 uuid REFERENCES events(id),          -- solo si purchase_type = 'event_credits'
  amount_cents             int NOT NULL,
  currency                 char(3) NOT NULL DEFAULT 'EUR',
  platform_fee_cents       int NOT NULL DEFAULT 0,
  creator_share_cents      int,                                 -- null si no aplica reparto (eventos)
  stripe_payment_intent_id text NOT NULL,
  stripe_transfer_id       text,                                -- payout al creador vía Stripe Connect
  status                   purchase_status NOT NULL DEFAULT 'pending',
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_purchase_target CHECK (
    (purchase_type = 'room' AND room_version_id IS NOT NULL AND event_id IS NULL)
    OR (purchase_type = 'event_credits' AND event_id IS NOT NULL AND room_version_id IS NULL)
    OR (purchase_type = 'platform_credits' AND room_version_id IS NULL AND event_id IS NULL)
  )
);
CREATE INDEX ix_purchases_user ON purchases(user_id, created_at DESC);
CREATE UNIQUE INDEX ux_purchases_stripe_pi ON purchases(stripe_payment_intent_id);
```

---

## 8. Progreso de partida y analítica

```sql
-- 0008_progress_analytics.sql

-- Progreso "de negocio" (panel del organizador, ranking entre grupos) — volumen moderado,
-- no partición necesaria a corto plazo.
CREATE TABLE progress_events (
  id               bigserial PRIMARY KEY,
  session_id       uuid NOT NULL REFERENCES sessions(id),
  group_id         uuid REFERENCES groups(id),
  player_id        uuid REFERENCES users(id),      -- null si el jugador entró solo con clave (sin cuenta)
  access_key_code  text REFERENCES access_keys(code),
  puzzle_id        text NOT NULL,                  -- id lógico dentro del RoomPackage, no FK
  event_kind       progress_event_kind NOT NULL,
  duration_ms      int,
  hints_used       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_progress_events_session ON progress_events(session_id, created_at);
CREATE INDEX ix_progress_events_group ON progress_events(group_id);

-- Analítica fina (todo evento de telemetría del punto 7 del roadmap: onboarding_step,
-- movimientos agregados, uso de pistas, embudo de compra...). Alto volumen → particionada
-- por mes desde el día uno.
CREATE TABLE analytics_events (
  id               bigserial NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  event_type       text NOT NULL,
  session_id       uuid,
  player_id        uuid,
  room_version_id  uuid,
  payload          jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, created_at)              -- la clave de partición debe estar en la PK
) PARTITION BY RANGE (created_at);

CREATE TABLE analytics_events_2026_09 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE analytics_events_2026_10 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- Job mensual (pg_cron o ticket de mantenimiento del roadmap) crea la partición del
-- mes siguiente con 1 mes de antelación y opcionalmente archiva/comprime particiones > 12 meses.

CREATE INDEX ix_analytics_events_type ON analytics_events(event_type, created_at);
CREATE INDEX ix_analytics_events_session ON analytics_events(session_id);
```

---

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
```

> **Nota de diseño respecto al §12 original:** la reseña se ancla a `room_id` (la sala en general), no a `room_version_id`. Un jugador puntúa "esta sala" tras jugarla; si tuviera que repetir reseña en cada parche del creador, el conteo de estrellas del catálogo se fragmentaría entre versiones sin motivo de negocio. El `UNIQUE (user_id, room_id)` también resuelve de forma natural "una reseña por jugador y sala" sin lógica extra en la API.

---

## 10. Moderación de contenido (placeholder ligero)

El diseño completo del pipeline de moderación es el **punto 8** de la lista pendiente (automático vs. humano, tiempos, escalado, política de strikes). Aquí solo se fija la tabla mínima para no bloquear el resto del esquema:

```sql
-- 0010_moderation.sql

CREATE TABLE content_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid NOT NULL REFERENCES users(id),
  room_version_id  uuid NOT NULL REFERENCES room_versions(id),
  reason           text NOT NULL,
  details          text,
  status           content_report_status NOT NULL DEFAULT 'pending',
  reviewed_by      uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz
);
CREATE INDEX ix_content_reports_status ON content_reports(status) WHERE status = 'pending';
```

---

## 11. Relaciones — vista de conjunto

```
users ──< organization_members >── organizations
users ──< credit_accounts >── organizations        (dueño exclusivo: user XOR org)
credit_accounts ──< credit_movements

users ──< rooms
rooms ──< room_updates              (log Yjs)
rooms ──< room_snapshots            (squash Yjs)
rooms ──< room_versions             (RoomPackage congelado, JSONB)

users ──< events >── room_versions
events ──< sessions ──< groups
events ──< access_keys >── sessions
groups ──< access_keys

users ──< purchases >── room_versions | events

sessions ──< progress_events >── groups
                              >── access_keys (jugador invitado sin cuenta)

users ──< reviews >── rooms

users ──< content_reports >── room_versions

analytics_events            (independiente, solo referencias lógicas — sin FK, alto volumen)
```

---

## 12. Estrategia de migraciones

- Carpeta `packages/shared/db/migrations/`, generadas con `drizzle-kit generate` a partir del schema TypeScript — el archivo `.sql` resultante es el que efectivamente se versiona (no se edita el schema TS y se asume sincronizado; el `.sql` generado es la fuente de verdad para `drizzle-kit migrate`).
- Numeración secuencial tal y como aparece en este documento (`0001_extensions` … `0010_moderation`): cada bloque de esta especificación es una migración real, en este orden, porque hay dependencias de FK entre bloques (p. ej. `credit_accounts` necesita que `users` y `organizations` ya existan).
- **Migración de datos de SLXD** (usuarios, organizaciones, ledger de créditos): no es una migración de esquema sino un script de importación aparte (`scripts/import-slxd-ledger.ts`), a ejecutar una sola vez tras `0004_credits.sql`. Pendiente de escribir el mapeo columna a columna cuando se disponga del DDL real de SLXD — el esquema destino ya está fijado en la sección 3–4 de este documento, así que ese script solo necesita transformar, no hay ambigüedad del lado de llegada.
- Entorno local (`docker-compose`, ya en el ticket 0.2 del roadmap): `pnpm db:migrate` aplica todas las migraciones pendientes contra el Postgres del contenedor; `pnpm db:seed` carga un usuario admin, un creador de ejemplo y publica el Rey Aldric (`room-package-rey-aldric-v1.0.md`) como `room_versions` real — así el entorno de desarrollo arranca siempre con contenido jugable.
- CI (GitHub Actions, ya en el stack): cada PR levanta Postgres efímero, aplica todas las migraciones desde cero y corre el test E2E del Rey Aldric (mencionado en el punto 1) como smoke test de que el esquema soporta el fixture completo.
