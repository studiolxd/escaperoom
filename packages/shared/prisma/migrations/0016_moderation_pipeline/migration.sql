-- 0016_moderation_pipeline — pipeline de moderación (ticket 6.1, specs/17).
--
-- `contentReport` (0010) solo sabía apuntar a una `roomVersion` y siempre con un
-- usuario que reporta. Para el pipeline completo hace falta:
--   · destino genérico (`targetType`): sala, reseña o usuario, con el dueño del
--     contenido (`targetUserId`) para aplicar strikes y congelaciones;
--   · reportes sin persona detrás (`source` = 'precheck' | 'sampling');
--   · SLA de primera revisión (`slaDueAt`, specs/17 §4.1), la acción aplicada y
--     el estado previo de la sala para poder restaurarla (despublicación
--     automática de un reporte crítico, specs/17 §5.1);
--   · la huella del contenido bloqueado por el pre-check (`contentHash`) para
--     que una apelación estimada deje pasar ESE contenido.
-- Además: reseñas ocultables (`review.hiddenAt`), strikes con consecuencia
-- (specs/17 §6) y la apelación enlazada al strike que levanta.
ALTER TABLE "contentReport"
  ALTER COLUMN "reporterId" DROP NOT NULL,
  ALTER COLUMN "roomVersionId" DROP NOT NULL,
  ADD COLUMN "targetType"       text NOT NULL DEFAULT 'room'
    CHECK ("targetType" IN ('room','review','user')),
  ADD COLUMN "roomId"           uuid REFERENCES "room"(id),
  ADD COLUMN "reviewId"         uuid REFERENCES "review"(id),
  ADD COLUMN "targetUserId"     text REFERENCES "user"(id),  -- dueño del contenido (autor, reseñador o el usuario reportado)
  ADD COLUMN "slaDueAt"         timestamptz,
  ADD COLUMN "actionTaken"      text
    CHECK ("actionTaken" IN ('unpublish','hide','warn','block','none')),
  ADD COLUMN "autoActioned"     boolean NOT NULL DEFAULT false, -- acción automática vigente hasta la revisión humana
  ADD COLUMN "roomStatusBefore" "roomStatus",                  -- estado de la sala antes de despublicarla
  ADD COLUMN "contentHash"      text,
  ADD COLUMN "flags"            text[] NOT NULL DEFAULT '{}',   -- señales del pre-check automático
  ADD COLUMN "resolutionNote"   text,
  ADD CONSTRAINT "ckContentReportReporter"
    CHECK (source <> 'user_report' OR "reporterId" IS NOT NULL),
  ADD CONSTRAINT "ckContentReportTarget"
    CHECK (("targetType" = 'room'   AND "roomId" IS NOT NULL)
        OR ("targetType" = 'review' AND "reviewId" IS NOT NULL)
        OR ("targetType" = 'user'   AND "targetUserId" IS NOT NULL));
-- Las filas de 0010 apuntaban a una versión: se completa la sala y su autor.
UPDATE "contentReport" c
   SET "roomId" = v."roomId", "targetUserId" = r."authorId"
  FROM "roomVersion" v JOIN "room" r ON r.id = v."roomId"
 WHERE v.id = c."roomVersionId" AND c."roomId" IS NULL;
CREATE INDEX "ixContentReportRoom" ON "contentReport"("roomId") WHERE "roomId" IS NOT NULL;
CREATE INDEX "ixContentReportTargetUser" ON "contentReport"("targetUserId", status);

ALTER TABLE "review"
  ADD COLUMN "hiddenAt" timestamptz,
  ADD COLUMN "hiddenBy" text REFERENCES "user"(id);

CREATE TABLE "moderationStrike" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"          text NOT NULL REFERENCES "user"(id),
  "contentReportId" uuid REFERENCES "contentReport"(id),
  severity          text NOT NULL CHECK (severity IN ('critical','high','normal')),
  -- Consecuencia vigente (specs/17 §6); se recalcula al revocar otro strike.
  consequence       text NOT NULL CHECK (consequence IN ('warning','suspension','ban')),
  reason            text NOT NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "revokedAt"       timestamptz,
  "revokedBy"       text REFERENCES "user"(id)
);
CREATE INDEX "ixModerationStrikeUser" ON "moderationStrike"("userId", "createdAt");

ALTER TABLE "moderationAppeal"
  ADD COLUMN "strikeId" uuid REFERENCES "moderationStrike"(id),
  ADD COLUMN "slaDueAt" timestamptz;
