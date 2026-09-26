-- Medios de la introducción de una sala (encargo lobby-diseño, specs/04
-- "Introducción: vídeo y subtítulos"): el vídeo (mp4/webm, hasta 200 MB, se
-- sube directo al bucket con un PUT presignado) y los subtítulos WebVTT por
-- idioma. El borrador los referencia como `media:<id>`; al publicar se copian
-- a una clave direccionada por contenido (`assets/rooms/<roomId>/<sha256>.<ext>`)
-- y el paquete congelado ya no depende de esta tabla.
--
-- `pending` = el vídeo tiene URL de subida pero aún no se ha comprobado el
-- objeto (HEAD + magic bytes); solo `ready` es utilizable. Los subtítulos (y
-- el vídeo subido por el MCP, que llega en el propio cuerpo) nacen `ready`.
-- Sin moderación previa (decisión del usuario), como el audio (ADR-039).
CREATE TABLE "introMediaAsset" (
  id              uuid PRIMARY KEY,                                   -- generado en el servicio (forma la clave del bucket)
  "ownerId"       text NOT NULL REFERENCES "user"(id),
  "roomId"        uuid NOT NULL REFERENCES "room"(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('video', 'subtitles')),
  lang            text,                                               -- idioma de los subtítulos (null en el vídeo)
  "storageKey"    text NOT NULL UNIQUE,                               -- uploads/intro/{roomId}/{id}.{mp4|webm|vtt}
  "contentType"   text NOT NULL,
  "byteSize"      int NOT NULL    CHECK ("byteSize" >= 0),            -- declarado en `pending`, real en `ready`
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'subtitles') = (lang IS NOT NULL))
);
CREATE INDEX "ixIntroMediaAssetRoom" ON "introMediaAsset"("roomId", "createdAt" DESC);
CREATE INDEX "ixIntroMediaAssetOwner" ON "introMediaAsset"("ownerId");
