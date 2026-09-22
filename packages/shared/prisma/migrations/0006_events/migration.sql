-- 0006_events — eventos, sesiones, grupos, claves y grabaciones (specs/14 §6)
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
  expiry_rules              jsonb NOT NULL DEFAULT '[]',
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
