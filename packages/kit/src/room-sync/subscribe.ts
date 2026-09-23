import { logger } from "../logger";
import { getSubscriberRedis } from "../redis";
import { draftUpdateChannel } from "./channel";
import type { DraftUpdateEvent, DraftUpdateWireEvent } from "./types";

type Listener = (event: DraftUpdateEvent) => void;

const globalForRoomSync = globalThis as unknown as {
  draftUpdateListeners?: Set<Listener>;
  draftUpdateSubscribed?: boolean;
};

function listeners(): Set<Listener> {
  return (globalForRoomSync.draftUpdateListeners ??= new Set());
}

/** Attaches the single `message` handler once per process (HMR-safe), like `events/subscriber.ts`. */
function ensureSubscribed(): boolean {
  const redis = getSubscriberRedis();
  if (!redis) return false;
  if (globalForRoomSync.draftUpdateSubscribed) return true;

  const channel = draftUpdateChannel();
  redis.subscribe(channel).catch((err: unknown) => {
    logger.warn({ err }, "room-sync: subscribe failed");
  });
  redis.on("message", (ch: string, message: string) => {
    if (ch !== channel) return;
    const set = listeners();
    if (set.size === 0) return;
    let wire: DraftUpdateWireEvent;
    try {
      wire = JSON.parse(message) as DraftUpdateWireEvent;
    } catch (err) {
      logger.warn({ err }, "room-sync: bad message payload");
      return;
    }
    const event: DraftUpdateEvent = { ...wire, update: new Uint8Array(Buffer.from(wire.update, "base64")) };
    // Isolate each listener: one throwing must not starve the rest of the
    // process's rooms from the same event.
    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        logger.warn({ err, roomId: event.roomId }, "room-sync: listener threw");
      }
    }
  });
  globalForRoomSync.draftUpdateSubscribed = true;
  return true;
}

/**
 * Subscribes to draft updates published by OTHER processes: other
 * `editor-sync` instances (scaled horizontally) and the REST/MCP writers,
 * which have no live doc of their own. Returns an unsubscribe function.
 * No-op (returns a noop) when Redis is unavailable — the caller keeps working
 * for clients on THIS process, it just can't hear about writes made
 * elsewhere (decision log 2026-09-23).
 */
export function subscribeDraftUpdates(onEvent: Listener): () => void {
  if (!ensureSubscribed()) return () => {};
  const set = listeners();
  set.add(onEvent);
  return () => {
    set.delete(onEvent);
  };
}
