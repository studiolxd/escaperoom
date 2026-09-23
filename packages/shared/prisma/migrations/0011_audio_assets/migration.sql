-- 0011_audio_assets — audio subido por el creador con moderación previa (ticket 3.11,
-- specs/15 §1 y §4, specs/17 §1). Las subidas de assets custom son la excepción a la
-- moderación post-publicación: nacen 'pending' y solo un moderador las aprueba o rechaza.
-- La biblioteca incluida NO vive aquí (manifiesto en código, binarios en el bucket).
CREATE TABLE "audioAsset" (
  id                  uuid PRIMARY KEY,                       -- generado en el servicio (forma la clave del bucket)
  "ownerId"           text NOT NULL REFERENCES "user"(id),
  "organizationId"    text REFERENCES "organization"(id),     -- organización activa al subir (informativo)
  "storageKey"        text NOT NULL UNIQUE,                   -- uploads/audio/{ownerId}/{id}.mp3
  "originalFilename"  text NOT NULL,
  "contentType"       text NOT NULL,
  "byteSize"          int NOT NULL CHECK ("byteSize" > 0),
  "durationMs"        int NOT NULL CHECK ("durationMs" > 0),
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  "moderationFlags"   text[] NOT NULL DEFAULT '{}',           -- señales del pre-filtro automático (specs/17 §3)
  "rejectionReason"   text,
  "reviewedBy"        text REFERENCES "user"(id),
  "reviewedAt"        timestamptz,
  "rightsDeclaredAt"  timestamptz NOT NULL,                   -- el creador declara tener los derechos (specs/18 §2)
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR "rejectionReason" IS NOT NULL),
  CHECK ((status = 'pending') = ("reviewedAt" IS NULL))
);
CREATE INDEX "ixAudioAssetOwner" ON "audioAsset"("ownerId", "createdAt" DESC);
CREATE INDEX "ixAudioAssetPending" ON "audioAsset"("createdAt") WHERE status = 'pending';
