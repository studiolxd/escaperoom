import { redisPrefix } from "../redis";

// Kept in its own module like `events/channels.ts` — neither the publisher
// nor the subscriber needs to pull in the other's dependencies.

/**
 * Pub/sub channel for Yjs draft updates across `editor-sync` processes
 * (specs/09 §2, decision log 2026-09-23: sincronización en vivo entre
 * procesos del editor). A single fixed channel carries every room: the room
 * id travels inside the payload, and each process filters to the rooms it
 * has loaded — cheaper than one channel per room when most rooms have no
 * live editors most of the time.
 */
export function draftUpdateChannel(): string {
  return `${redisPrefix()}:editor-sync:draft-updates`;
}
