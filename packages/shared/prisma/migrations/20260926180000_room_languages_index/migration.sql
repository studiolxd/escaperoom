-- E-23 (auditoría 2026-09-24): el índice GIN `ixRoomVersionPackage` indexaba
-- el `RoomPackage` ENTERO (mapa, objetos, puzzles, diálogos...) para servir un
-- único filtro del catálogo (idiomas). Medido con ~4500 versiones/1500 salas
-- (paquete real, plantilla Rey Aldric): el índice pesaba 11 MB (vs 16 kB de
-- la tabla base sin TOAST) y, además, NUNCA se llegaba a usar en la consulta
-- real: el filtro `latest.package @> ...` se aplica sobre la salida ya
-- materializada del `DISTINCT ON` (la "última versión por sala"), no sobre
-- `roomVersion` directamente, así que Postgres no puede empujar el índice a
-- través de esa subconsulta (confirmado con EXPLAIN ANALYZE: siempre
-- "Filter" tras un Seq Scan, nunca "Bitmap Index Scan").
--
-- Se sustituye por una columna `languages` denormalizada en `room` (los
-- idiomas de la ÚLTIMA versión publicada), escrita en el mismo publish que
-- crea la `roomVersion`. Al vivir en `room` (una fila por sala, no por
-- versión) el filtro puede aplicarse ANTES del `DISTINCT ON` sobre las
-- versiones de las salas descartadas, no solo evitar leer el JSONB completo.
-- Backfill desde la última versión de cada sala (por `publishedAt`).
ALTER TABLE "room" ADD COLUMN "languages" text[] NOT NULL DEFAULT '{}';

UPDATE "room" r SET "languages" = COALESCE((
  SELECT ARRAY(SELECT jsonb_array_elements_text(v.package -> 'meta' -> 'languages'))
    FROM "roomVersion" v
   WHERE v."roomId" = r.id
   ORDER BY v."publishedAt" DESC
   LIMIT 1
), '{}');

CREATE INDEX "ixRoomLanguages" ON "room" USING gin ("languages");

DROP INDEX "ixRoomVersionPackage";
