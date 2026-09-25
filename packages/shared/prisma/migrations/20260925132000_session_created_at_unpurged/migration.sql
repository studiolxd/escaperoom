-- E-7: purga horaria (session-ip-ua-purge-prisma-store.ts) filtra por
-- "createdAt" <= cutoff y (ipAddress/userAgent NOT LIKE 'purged:%'); sin
-- índice recorre toda la tabla de sesiones en cada pasada, incluidas las
-- ya purgadas. Parcial: solo indexa filas aún no purgadas (se reduce con
-- cada pasada). No representable en schema.prisma (sin soporte de índices
-- parciales); ver el comentario `///` del modelo `session` (E-18).
CREATE INDEX CONCURRENTLY "ixSessionCreatedAtUnpurged" ON "session"("createdAt")
  WHERE ("ipAddress" IS NOT NULL AND "ipAddress" NOT LIKE 'purged:%')
     OR ("userAgent" IS NOT NULL AND "userAgent" NOT LIKE 'purged:%');
