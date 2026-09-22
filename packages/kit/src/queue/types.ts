import type { Job, JobsOptions, Queue } from "bullmq";

/** Declarative description of a queue — its name and per-queue job defaults. */
export type QueueDefinition<TPayload> = {
  /** Unique queue name — collisions between kit and product queues throw at boot. */
  name: string;
  /** Overrides merged over the runtime config's defaultJobOptions. */
  defaultJobOptions?: JobsOptions;
  /**
   * Phantom field carrying TPayload so the generic is used structurally —
   * never set it. (QueueDefinition<A> and QueueDefinition<B> must not be
   * mutually assignable by accident.)
   */
  _payload?: TPayload;
};

/** What `defineQueue` returns — the app-facing handle to enqueue work. */
export type QueueHandle<TPayload> = QueueDefinition<TPayload> & {
  /**
   * Adds a job. Returns its id, or null when queues are disabled (no-op —
   * callers must tolerate "the work will happen on the next maintenance run").
   */
  enqueue(payload: TPayload, opts?: JobsOptions): Promise<string | null>;
  /** The lazy underlying BullMQ Queue — null when queues are disabled. */
  getQueue(): Queue<TPayload> | null;
};

/** Structural logger shape — the kit stays free of any app's own logger type. */
export interface QueueLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Context handed to every processor — the app's own Prisma client and logger. */
export type ProcessorContext<TPrisma = unknown> = {
  prisma: TPrisma;
  logger: QueueLogger;
};

/** Binds a queue to the function the worker runs for each of its jobs. */
export type ProcessorRegistration<TPayload = unknown, TPrisma = unknown> = {
  queue: QueueHandle<TPayload>;
  /** Overrides the runtime config's concurrency for this processor only. */
  concurrency?: number;
  process(job: Job<TPayload>, ctx: ProcessorContext<TPrisma>): Promise<unknown>;
};
