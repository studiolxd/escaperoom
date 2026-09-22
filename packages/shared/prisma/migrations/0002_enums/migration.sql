-- 0002_enums — ENUMs de Postgres (specs/14 §2)
CREATE TYPE credit_movement_type   AS ENUM ('purchase', 'consumption', 'refund', 'adjustment');
CREATE TYPE room_status            AS ENUM ('draft', 'published', 'unlisted', 'archived', 'removed');
CREATE TYPE event_status           AS ENUM ('draft', 'active', 'closed');
CREATE TYPE grouping_mode          AS ENUM ('specific', 'random', 'free');
CREATE TYPE session_status         AS ENUM ('pending', 'in_progress', 'ended', 'aborted');
CREATE TYPE access_key_type        AS ENUM ('individual', 'rotating', 'group', 'batch');
CREATE TYPE access_key_status      AS ENUM ('generated', 'sent', 'pending_confirmation', 'confirmed', 'active', 'used', 'expired');
CREATE TYPE purchase_type          AS ENUM ('room', 'room_license', 'event_credits', 'platform_credits');
CREATE TYPE purchase_status        AS ENUM ('pending', 'succeeded', 'refunded', 'failed');
CREATE TYPE progress_event_kind    AS ENUM ('solved', 'hint_used', 'attempt_failed');
CREATE TYPE content_report_status  AS ENUM ('pending', 'reviewed', 'actioned', 'dismissed');
CREATE TYPE event_audience         AS ENUM ('general', 'educational');
