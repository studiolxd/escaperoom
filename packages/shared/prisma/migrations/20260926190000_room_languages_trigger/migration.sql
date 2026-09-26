-- E-23 (revisión de la coordinadora sobre la PR de 20260926180000): dejar
-- `room.languages` en manos de que cada sitio que crea/actualiza una
-- `roomVersion` se acuerde de escribirlo (`insertVersion`) es frágil — el
-- seed (`prisma/seed.ts`), fixtures de e2e (`events-only-room.spec.ts`, SQL
-- directo) y cualquier escritura futura (MCP, restauración de moderación,
-- scripts de dev) pueden crear una `roomVersion` sin pasar por ahí, y la
-- sala queda con `languages = '{}'` — invisible para cualquier filtro de
-- idioma del catálogo, sin que ningún test lo note si no filtra por idioma.
--
-- Se mueve la denormalización a un trigger: se recalcula `room.languages`
-- desde la versión con `publishedAt` más reciente de la sala en cada INSERT
-- o UPDATE de `package` sobre `roomVersion`, sin importar quién escriba la
-- fila (aplicación, seed, SQL a mano, MCP). Recalcular desde la fila más
-- reciente (no solo copiar `NEW.package`) es correcto también si alguna
-- vez se insertan versiones fuera de orden (`publishedAt` no creciente).
CREATE OR REPLACE FUNCTION "syncRoomLanguagesFromVersion"()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "room" SET "languages" = COALESCE((
    SELECT ARRAY(SELECT jsonb_array_elements_text(v.package -> 'meta' -> 'languages'))
      FROM "roomVersion" v
     WHERE v."roomId" = NEW."roomId"
     ORDER BY v."publishedAt" DESC
     LIMIT 1
  ), '{}')
  WHERE id = NEW."roomId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trgRoomVersionSyncLanguages"
  AFTER INSERT OR UPDATE OF package ON "roomVersion"
  FOR EACH ROW EXECUTE FUNCTION "syncRoomLanguagesFromVersion"();
