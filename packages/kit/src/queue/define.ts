import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import type Redis from "ioredis";
import { readRedisEnv } from "../env";
import { logger } from "../logger";
import { createProducerRedis, redisPrefix } from "../redis";
import { jobIdProblem, reportJobIdDefect } from "./job-id";
import type { ProcessorRegistration, QueueDefinition, QueueHandle } from "./types";

/**
 * Runtime knobs `defineQueue` itself needs. Pass your app's queues config (or
 * the relevant slice) — app-owned fields (health port, maintenance cadence)
 * stay out of the kit.
 */
export type QueuesRuntimeConfig = {
  enabled: boolean;
  defaultJobOptions?: JobsOptions;
};

/**
 * The same BullMQ defaults for every queue unless it overrides them: three
 * attempts with exponential backoff, and bounded retention so Redis doesn't
 * grow forever.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/**
 * Reads the queue feature flag from @escaperoom/env: `QUEUES_ENABLED=false`
 * (the default) means every `enqueue()` is a no-op and no Redis connection is
 * opened.
 */
export function readQueuesRuntimeConfig(
  source: Record<string, string | undefined> = process.env,
): QueuesRuntimeConfig {
  return { enabled: readRedisEnv(source).QUEUES_ENABLED, defaultJobOptions: DEFAULT_JOB_OPTIONS };
}

// One producer connection shared by every Queue in this process — Queues only
// issue regular commands (no blocking BRPOPLPUSH), so sharing is safe and
// keeps the connection count flat as queues are added. Fail-fast (bounded
// retries, no offline queue) so enqueue can't hang a request when Redis is down.
let sharedConnection: Redis | null = null;

function queueConnection(): Redis {
  sharedConnection ??= createProducerRedis();
  return sharedConnection;
}

/** Closes the shared producer connection (worker shutdown / test cleanup). */
export async function closeSharedQueueConnection(): Promise<void> {
  if (!sharedConnection) return;
  const conn = sharedConnection;
  sharedConnection = null;
  await conn.quit();
}

/** All BullMQ keys live under the app namespace, like every other Redis use. */
export function queuePrefix(): string {
  return `${redisPrefix()}:bull`;
}

/**
 * pnpm gives bullmq its own pinned ioredis (it declares an exact version)
 * while the app resolves a newer one — runtime-compatible, but the two Redis
 * class types are not identical. One cast site instead of `as` at every
 * Queue/Worker construction.
 */
export function asBullConnection(connection: Redis): ConnectionOptions {
  return connection as unknown as ConnectionOptions;
}

// La guarda de `jobId` vive en su propio módulo (`./job-id`) para que se pueda
// importar sin arrastrar bullmq; se reexporta aquí porque este es el punto de
// entrada que envuelve cada app.
export { JOB_ID_SEPARATOR, isValidJobId, jobIdProblem, safeJobId } from "./job-id";

/**
 * Builds the app's `defineQueue`, bound to its own runtime config (feature
 * flag + default job options). With `enabled: false` the handle is inert:
 * `enqueue()` resolves null and Redis is never touched, so feature code can
 * enqueue unconditionally. The BullMQ Queue is created lazily on first use.
 */
export function createDefineQueue(config: QueuesRuntimeConfig) {
  return function defineQueue<TPayload = Record<string, never>>(
    def: QueueDefinition<TPayload>,
  ): QueueHandle<TPayload> {
    // Untyped internally (Queue's 4-param generics don't reduce over an open
    // TPayload); the handle's signatures are the typed boundary.
    let queue: Queue | null = null;

    const ensureQueue = (): Queue | null => {
      if (!config.enabled) return null;
      queue ??= new Queue(def.name, {
        connection: asBullConnection(queueConnection()),
        prefix: queuePrefix(),
        defaultJobOptions: {
          ...config.defaultJobOptions,
          ...def.defaultJobOptions,
        },
      });
      return queue;
    };

    return {
      ...def,
      getQueue: () => ensureQueue() as Queue<TPayload> | null,
      async enqueue(payload: TPayload, opts?: JobsOptions) {
        const q = ensureQueue();
        if (!q) {
          logger.debug({ queue: def.name }, "queue: disabled, enqueue skipped");
          return null;
        }
        // Un `jobId` propio inválido lo rechaza BullMQ dentro de `add()`, así
        // que sin esta comprobación el defecto llega disfrazado de «fallo al
        // encolar» y se confunde con un corte de Redis. Se comprueba antes: en
        // desarrollo y en los tests lanza, en producción queda registrado y
        // `enqueue` devuelve null — que es la verdad.
        if (typeof opts?.jobId === "string") {
          const problem = jobIdProblem(opts.jobId);
          if (problem) {
            reportJobIdDefect(problem, { queue: def.name, jobId: opts.jobId });
            return null;
          }
        }
        try {
          const job = await q.add(def.name, payload, opts);
          return job.id ?? null;
        } catch (err) {
          if (isQueueInfraError(err)) {
            // Fail-fast producer connection rejects when Redis is down —
            // enqueue is best-effort, so degrade to a no-op instead of
            // throwing into the caller (a web request must never hang or 500
            // on a Redis blip).
            logger.warn({ err, queue: def.name }, "queue: enqueue failed");
            return null;
          }
          // Lo que no es infraestructura es un defecto (payload que no pasa el
          // esquema, opciones incompatibles): tiene que verse. Ruidoso donde
          // hay alguien mirando; en producción, un null honrado en vez de un
          // encolado fantasma.
          logger.error({ err, queue: def.name }, "queue: enqueue rejected");
          if (process.env.NODE_ENV !== "production") throw err;
          return null;
        }
      },
      async enqueueBulk(items: Array<{ payload: TPayload; opts?: JobsOptions }>) {
        const results: Array<string | null> = new Array(items.length).fill(null);
        if (items.length === 0) return results;
        const q = ensureQueue();
        if (!q) {
          logger.debug(
            { queue: def.name, count: items.length },
            "queue: disabled, enqueueBulk skipped",
          );
          return results;
        }
        // Misma comprobación de `jobId` que `enqueue`, por elemento: el resto
        // del lote se encola igual (deja `null` solo en su posición).
        const toAdd: Array<{ name: string; data: TPayload; opts?: JobsOptions; at: number }> = [];
        items.forEach((item, i) => {
          if (typeof item.opts?.jobId === "string") {
            const problem = jobIdProblem(item.opts.jobId);
            if (problem) {
              reportJobIdDefect(problem, { queue: def.name, jobId: item.opts.jobId });
              return;
            }
          }
          toAdd.push({ name: def.name, data: item.payload, opts: item.opts, at: i });
        });
        if (toAdd.length === 0) return results;
        try {
          const jobs = await q.addBulk(toAdd);
          jobs.forEach((job, k) => {
            results[toAdd[k]!.at] = job.id ?? null;
          });
        } catch (err) {
          if (isQueueInfraError(err)) {
            logger.warn(
              { err, queue: def.name, count: toAdd.length },
              "queue: enqueueBulk failed",
            );
          } else {
            logger.error(
              { err, queue: def.name, count: toAdd.length },
              "queue: enqueueBulk rejected",
            );
            if (process.env.NODE_ENV !== "production") throw err;
          }
        }
        return results;
      },
    };
  };
}

/**
 * Señales de «no he podido hablar con Redis», que es lo único que `enqueue`
 * puede tragarse: el resto de rechazos de `add()` son defectos y salen a la
 * luz. La lista cubre lo que emiten ioredis y el socket por debajo.
 */
const INFRA_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

const INFRA_MESSAGES = [
  "econnrefused",
  "connection is closed",
  "connection is already closed",
  "stream isn't writeable",
  "max retries per request",
  "connection timeout",
  "command timed out",
  "failed to refresh slots cache",
  "redis is loading",
  "clusterallfailederror",
];

/** ¿Este rechazo de `add()` es un corte de Redis y no un defecto nuestro? */
export function isQueueInfraError(err: unknown): boolean {
  if (typeof err === "string") {
    const lower = err.toLowerCase();
    return INFRA_MESSAGES.some((needle) => lower.includes(needle));
  }
  if (!err || typeof err !== "object") return false;

  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && INFRA_CODES.has(code)) return true;

  const message = (err as { message?: unknown }).message;
  if (typeof message === "string") {
    const lower = message.toLowerCase();
    if (INFRA_MESSAGES.some((needle) => lower.includes(needle))) return true;
  }

  const cause = (err as { cause?: unknown }).cause;
  return cause ? isQueueInfraError(cause) : false;
}

/** Identity with types — keeps processor registrations honest at the callsite. */
export function defineProcessor<TPayload, TPrisma = unknown>(
  reg: ProcessorRegistration<TPayload, TPrisma>,
): ProcessorRegistration<TPayload, TPrisma> {
  return reg;
}

/**
 * Default `defineQueue` bound to `QUEUES_ENABLED` from @escaperoom/env. An app
 * that wants its own config should call `createDefineQueue`.
 */
export const defineQueue = createDefineQueue(readQueuesRuntimeConfig());
