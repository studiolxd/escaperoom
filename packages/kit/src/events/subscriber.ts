// No "server-only": imported only by the SSE/realtime route handler, but kept
// dependency-light. A single PSUBSCRIBE connection multiplexes every stream in
// this process — one Redis connection total, not one per browser tab.
// Listeners are demultiplexed in-process by exact channel.
import { logger } from "../logger";
import { getSubscriberRedis, redisPrefix } from "../redis";
import type { OrgEvent } from "./types";

type Listener = (event: OrgEvent) => void;

const globalForEvents = globalThis as unknown as {
  eventListeners?: Map<string, Set<Listener>>;
  eventSubscriberReady?: boolean;
};

function listeners(): Map<string, Set<Listener>> {
  return (globalForEvents.eventListeners ??= new Map());
}

/** Attaches the single pmessage handler once per process (HMR-safe). */
function ensureSubscribed(): boolean {
  const redis = getSubscriberRedis();
  if (!redis) return false;
  if (globalForEvents.eventSubscriberReady) return true;

  redis.psubscribe(`${redisPrefix()}:events:*`).catch((err) => {
    logger.warn({ err }, "events: psubscribe failed");
  });
  redis.on("pmessage", (_pattern, channel, message) => {
    const set = listeners().get(channel);
    if (!set || set.size === 0) return;
    let event: OrgEvent;
    try {
      event = JSON.parse(message) as OrgEvent;
    } catch (err) {
      logger.warn({ err, channel }, "events: bad message payload");
      return;
    }
    // Isolate each listener: one throwing (e.g. a closed SSE controller) must
    // not starve the rest of this channel's subscribers of the same event.
    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        logger.warn({ err, channel }, "events: listener threw");
      }
    }
  });
  globalForEvents.eventSubscriberReady = true;
  return true;
}

/**
 * Subscribes to the given channels for the lifetime of one connection. Returns
 * an unsubscribe function that removes just this connection's listeners.
 * No-op (returns a noop) when Redis is unavailable.
 */
export function subscribeChannels(channels: string[], onEvent: Listener): () => void {
  if (!ensureSubscribed()) return () => {};

  const map = listeners();
  for (const channel of channels) {
    const set = map.get(channel) ?? new Set<Listener>();
    set.add(onEvent);
    map.set(channel, set);
  }

  return () => {
    for (const channel of channels) {
      const set = map.get(channel);
      if (!set) continue;
      set.delete(onEvent);
      if (set.size === 0) map.delete(channel);
    }
  };
}
