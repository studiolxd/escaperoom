-- 0005_rooms — salas, draft Yjs y versiones publicadas (specs/14 §5)
-- "room"."forkedFromVersionId" apunta a "roomVersion", que se crea después:
-- la FK se añade al final con ALTER TABLE.
CREATE TABLE "room" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "authorId"             text NOT NULL REFERENCES "user"(id),
  title                  text NOT NULL,             -- denormalizado del draft
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
  "updatesAppliedThrough"  bigint NOT NULL,        -- último "roomUpdate".id incluido
  "createdAt"              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixRoomSnapshotRoom" ON "roomSnapshot"("roomId", id DESC);

CREATE TABLE "roomVersion" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roomId"       uuid NOT NULL REFERENCES "room"(id),
  semver         text NOT NULL,                    -- '1.0.0', '1.1.0'...
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
