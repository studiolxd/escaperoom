-- 0014_organization_dpa — firma del DPA de la organización (ticket 5.11, specs/18 §3.1).
--
-- `dpaSignedAt` ya existía desde 0003. Para que la aceptación sea demostrable
-- hace falta además QUÉ texto se aceptó (`dpaVersion`) y QUIÉN lo aceptó
-- (`dpaSignedBy`, owner/admin de la organización). Si el texto del DPA cambia
-- de versión, la firma anterior deja de habilitar las claves con email hasta
-- que se vuelva a firmar. Al borrar la cuenta del firmante se conserva la firma
-- (fecha y versión) y el firmante queda a `NULL`.
ALTER TABLE "organization"
  ADD COLUMN "dpaVersion"  text,
  ADD COLUMN "dpaSignedBy" text REFERENCES "user"(id) ON DELETE SET NULL;
