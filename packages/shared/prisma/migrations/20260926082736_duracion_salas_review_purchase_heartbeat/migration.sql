-- AlterTable
ALTER TABLE "purchase" ADD COLUMN     "playSessionHeartbeatAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "review" ADD COLUMN     "durationOverridden" BOOLEAN NOT NULL DEFAULT false;
