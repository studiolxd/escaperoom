-- 0002_enums — ENUMs de Postgres (specs/14 §2)
CREATE TYPE "creditMovementType"  AS ENUM ('purchase', 'consumption', 'refund', 'adjustment');
CREATE TYPE "roomStatus"          AS ENUM ('draft', 'published', 'unlisted', 'archived', 'removed');
CREATE TYPE "eventStatus"         AS ENUM ('draft', 'active', 'closed');
CREATE TYPE "groupingMode"        AS ENUM ('specific', 'random', 'free');
CREATE TYPE "sessionStatus"       AS ENUM ('pending', 'in_progress', 'ended', 'aborted');
CREATE TYPE "accessKeyType"       AS ENUM ('individual', 'rotating', 'group', 'batch');
CREATE TYPE "accessKeyStatus"     AS ENUM ('generated', 'sent', 'pending_confirmation', 'confirmed', 'active', 'used', 'expired');
CREATE TYPE "purchaseType"        AS ENUM ('room', 'room_license', 'event_credits', 'platform_credits');
CREATE TYPE "purchaseStatus"      AS ENUM ('pending', 'succeeded', 'refunded', 'failed');
CREATE TYPE "progressEventKind"   AS ENUM ('solved', 'hint_used', 'attempt_failed');
CREATE TYPE "contentReportStatus" AS ENUM ('pending', 'reviewed', 'actioned', 'dismissed');
CREATE TYPE "eventAudience"       AS ENUM ('general', 'educational');
