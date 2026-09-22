import { logger } from "../logger";
import { getRedis } from "../redis";
import { orgChannel, userChannel } from "./channels";
import type { OrgEvent } from "./types";

// PUBLISH is a regular command, so it reuses the shared client (no dedicated
// connection like the subscriber needs). Realtime-gated and best-effort: with
// the feature off or Redis down, publishing is a no-op — the UI still works
// via its polling fallback.

/**
 * Builds `publishOrgEvent`/`publishUserEvent` bound to a realtime flag. A thunk
 * is accepted so a caller reading the flag from a live config object gets a
 * fresh read on every publish rather than a value captured at boot.
 */
export function createEventPublisher(deps: { realtimeEnabled: boolean | (() => boolean) }) {
  const isEnabled = () =>
    typeof deps.realtimeEnabled === "function" ? deps.realtimeEnabled() : deps.realtimeEnabled;

  async function publish(channel: string, event: OrgEvent): Promise<boolean> {
    if (!isEnabled()) return false;
    const redis = getRedis();
    if (!redis) return false;
    try {
      await redis.publish(channel, JSON.stringify(event));
      return true;
    } catch (err) {
      logger.warn({ err, channel }, "events: publish failed");
      return false;
    }
  }

  return {
    /** Publishes to an organization's channel (job lifecycle, member-visible). */
    publishOrgEvent(organizationId: string, event: OrgEvent): Promise<boolean> {
      return publish(orgChannel(organizationId), event);
    },
    /** Publishes to a user's private channel (notifications). */
    publishUserEvent(userId: string, event: OrgEvent): Promise<boolean> {
      return publish(userChannel(userId), event);
    },
  };
}
