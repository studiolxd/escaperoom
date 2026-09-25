-- E-7: purga horaria de emails (access-key-email-purge-prisma-store.ts)
-- hace UPDATE "accessKey" k ... WHERE k."eventId" = er."eventId" AND
-- k.email IS NOT NULL AND k.email NOT LIKE 'purged:%'. Parcial: solo
-- indexa claves con email aún sin purgar. No representable en
-- schema.prisma; ver el comentario `///` del modelo `accessKey` (E-18).
CREATE INDEX CONCURRENTLY "ixAccessKeyEventEmailPending" ON "accessKey"("eventId")
  WHERE email IS NOT NULL AND email NOT LIKE 'purged:%';
