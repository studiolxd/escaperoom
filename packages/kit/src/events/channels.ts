import { redisPrefix } from "../redis";

// Channel naming is shared by publisher and subscriber — kept in its own
// module so neither pulls the other's dependencies.

/** Pub/sub channel for an organization's events (job lifecycle, member-visible). */
export function orgChannel(organizationId: string): string {
  return `${redisPrefix()}:events:org:${organizationId}`;
}

/** Pub/sub channel for a user's private events. */
export function userChannel(userId: string): string {
  return `${redisPrefix()}:events:user:${userId}`;
}
