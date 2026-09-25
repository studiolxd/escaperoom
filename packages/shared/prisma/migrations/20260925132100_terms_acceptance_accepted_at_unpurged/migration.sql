-- E-7: mismo caso que ixSessionCreatedAtUnpurged, sobre
-- terms-acceptance-ip-ua-purge-prisma-store.ts ("acceptedAt" <= cutoff).
-- No representable en schema.prisma; ver el comentario `///` del modelo
-- `termsAcceptance` (E-18).
CREATE INDEX CONCURRENTLY "ixTermsAcceptanceAcceptedAtUnpurged" ON "termsAcceptance"("acceptedAt")
  WHERE ("ipAddress" IS NOT NULL AND "ipAddress" NOT LIKE 'purged:%')
     OR ("userAgent" IS NOT NULL AND "userAgent" NOT LIKE 'purged:%');
