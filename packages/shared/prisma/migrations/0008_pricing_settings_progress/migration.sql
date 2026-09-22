-- 0008_pricing_settings_progress — precios, ajustes, progreso y analítica (specs/14 §8)
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

CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (key, value) VALUES ('max_players_per_room', '6');

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
CREATE INDEX ix_analytics_events_type ON analytics_events(event_type, created_at);
CREATE INDEX ix_analytics_events_session ON analytics_events(session_id);
