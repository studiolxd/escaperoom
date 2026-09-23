import { logger } from "../logger";
import { getRedis } from "../redis";
import { draftUpdateChannel } from "./channel";
import type { DraftUpdateEvent, DraftUpdateWireEvent } from "./types";

// PUBLISH is a regular command, so it reuses the shared client (no dedicated
// connection like the subscriber needs) — same as `events/publish.ts`.

/**
 * Publishes a draft update for OTHER `editor-sync` processes to pick up
 * (`subscribeDraftUpdates`). Best-effort and non-blocking: without
 * `REDIS_URL`, or if Redis is down, this is a no-op — the process that
 * produced the update already applied it to its own doc and persisted it, so
 * its own connected editors are unaffected either way; only cross-process
 * propagation is skipped (decision log 2026-09-23).
 */
export async function publishDraftUpdate(event: DraftUpdateEvent): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const wire: DraftUpdateWireEvent = {
    roomId: event.roomId,
    authorId: event.authorId,
    originId: event.originId,
    update: Buffer.from(event.update).toString("base64"),
  };
  try {
    await redis.publish(draftUpdateChannel(), JSON.stringify(wire));
    return true;
  } catch (err) {
    logger.warn({ err, roomId: event.roomId }, "room-sync: publish failed");
    return false;
  }
}
