-- 0010_moderation — moderación y apelaciones (specs/14 §10)
CREATE TABLE "contentReport" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reporterId"       text NOT NULL REFERENCES "user"(id),
  "roomVersionId"    uuid NOT NULL REFERENCES "roomVersion"(id),
  reason             text NOT NULL,
  details            text,
  severity           text NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('critical','high','normal','low')),
  category           text NOT NULL DEFAULT 'other',
  source             text NOT NULL DEFAULT 'user_report',
  status             "contentReportStatus" NOT NULL DEFAULT 'pending',
  "reviewedBy"       text REFERENCES "user"(id),
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "reviewedAt"       timestamptz
);
CREATE INDEX "ixContentReportStatus" ON "contentReport"(status) WHERE status = 'pending';
CREATE INDEX "ixContentReportSeverity" ON "contentReport"(severity, "createdAt");

CREATE TABLE "moderationAppeal" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "creatorId"         text NOT NULL REFERENCES "user"(id),
  "roomId"            uuid REFERENCES "room"(id),           -- null si apela estado de cuenta
  "contentReportId"   uuid REFERENCES "contentReport"(id),
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','upheld','overturned')),
  "reviewedBy"        text REFERENCES "user"(id),
  "resolutionNote"    text,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "reviewedAt"        timestamptz
);
CREATE INDEX "ixModerationAppealStatus" ON "moderationAppeal"(status) WHERE status = 'pending';
