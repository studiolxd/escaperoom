-- 0009_reviews — reseñas (specs/14 §9)
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
