-- 0010_moderation — moderación y apelaciones (specs/14 §10)
CREATE TABLE content_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid NOT NULL REFERENCES users(id),
  room_version_id  uuid NOT NULL REFERENCES room_versions(id),
  reason           text NOT NULL,
  details          text,
  severity         text NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('critical','high','normal','low')),
  category         text NOT NULL DEFAULT 'other',
  source           text NOT NULL DEFAULT 'user_report',
  status           content_report_status NOT NULL DEFAULT 'pending',
  reviewed_by      uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz
);
CREATE INDEX ix_content_reports_status ON content_reports(status) WHERE status = 'pending';
CREATE INDEX ix_content_reports_severity ON content_reports(severity, created_at);

CREATE TABLE moderation_appeals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        uuid NOT NULL REFERENCES users(id),
  room_id           uuid REFERENCES rooms(id),           -- null si apela estado de cuenta
  content_report_id uuid REFERENCES content_reports(id),
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','upheld','overturned')),
  reviewed_by       uuid REFERENCES users(id),
  resolution_note   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz
);
CREATE INDEX ix_moderation_appeals_status ON moderation_appeals(status) WHERE status = 'pending';
