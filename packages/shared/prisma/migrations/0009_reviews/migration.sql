-- 0009_reviews — reseñas (specs/14 §9)
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
