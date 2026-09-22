-- 0005_rooms — salas, draft Yjs y versiones publicadas (specs/14 §5)
-- `rooms.forked_from_version_id` apunta a `room_versions`, que se crea después:
-- la FK se añade al final con ALTER TABLE.
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
  forked_from_version_id uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX ix_rooms_author ON rooms(author_id);
CREATE INDEX ix_rooms_catalog ON rooms(status) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX ix_rooms_title_trgm ON rooms USING gin (title gin_trgm_ops);
CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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

ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_forked_from_version
  FOREIGN KEY (forked_from_version_id) REFERENCES room_versions(id);
