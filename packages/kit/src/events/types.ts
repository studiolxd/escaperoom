/**
 * Realtime events fanned out over Redis pub/sub. Two channels: per-organization
 * (job lifecycle, visible to any member) and per-user (private).
 * Adaptado de @slxd/kit/events (ADR-017).
 */
export type OrgEvent =
  | {
      type: "job.progress";
      jobName: string;
      jobId: string;
      progress: number;
      data?: Record<string, unknown>;
    }
  | {
      type: "job.completed";
      jobName: string;
      jobId: string;
      data?: Record<string, unknown>;
    }
  | { type: "job.failed"; jobName: string; jobId: string; error: string }
  | { type: "notification.created"; notificationType: string };

/** Discriminator values, e.g. for client-side switch exhaustiveness. */
export type OrgEventType = OrgEvent["type"];
