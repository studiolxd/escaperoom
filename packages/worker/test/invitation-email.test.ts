// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Queue, QueueEvents } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asBullConnection, queuePrefix } from "@escaperoom/kit/queue";
import { createQueueRedis } from "@escaperoom/kit/redis";
import {
  createMemoryMailTransport,
  INVITATION_EMAIL_JOB_OPTIONS,
  type InvitationEmailJob,
} from "@escaperoom/shared/mail";
import {
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryInvitationStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  type Actor,
  type DpaGate,
} from "@escaperoom/shared/services";
import {
  createInvitationEmailProcessor,
  createInvitationEmailWorker,
} from "../src/invitation-email";

/** DPA de la organización en regla: la puerta de 5.11 se prueba en `organizations.test.ts`. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");

/** Evento activo con confirmación obligatoria y `n` claves con email, en memoria. */
async function fixture(n: number) {
  const now = () => new Date("2026-06-01T10:00:00Z");
  const eventStore = createInMemoryEventStore({
    roomVersions: [
      {
        roomVersionId: VERSION,
        roomId: "20000000-0000-4000-8000-000000000001",
        authorId: author.userId,
        roomStatus: "published",
        saleEvents: true,
      },
    ],
  });
  const events = createEventService({
    store: eventStore,
    pricing: createPricingTierService({
      store: createInMemoryPricingTierStore({
        adminIds: [],
        tiers: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            minPlayers: 1,
            maxPlayers: null,
            priceCentsPerPlayer: 100,
            currency: "EUR",
            activeFrom: T0,
            activeUntil: null,
            createdBy: "seed-admin",
            createdAt: T0,
          },
        ],
      }),
      now,
    }),
    payments: createFakePaymentGateway(),
    now,
  });
  const keyStore = createInMemoryAccessKeyStore({ events: eventStore });
  const accessKeys = createAccessKeyService({ store: keyStore, events, dpa: DPA_SIGNED, now });
  const event = await events.createEvent(author, {
    roomVersionId: VERSION,
    title: "Jornada",
    maxSimultaneousSessions: 1,
    groupingMode: "random",
    requireConfirmation: true,
    expiryRules: [],
    playersPlanned: n,
    locale: "pt",
  });
  const { keys } = await accessKeys.activateEvent(author, event.id, {
    keyPlan: [
      { type: "individual", emails: Array.from({ length: n }, (_, i) => `p${i}@example.com`) },
    ],
  });
  const transport = createMemoryMailTransport();
  const deps = {
    store: createInMemoryInvitationStore({ keys: keyStore }),
    transport,
    confirmation: { secret: "s".repeat(32), ttlSeconds: 3600 },
    appUrl: "https://app.example.com",
    now,
  };
  return { keys, keyStore, transport, deps };
}

describe("processInvitationEmail", () => {
  it("entrega el email en el idioma del evento y marca la clave como pendiente de confirmar", async () => {
    const { keys, keyStore, transport, deps } = await fixture(1);
    const process = createInvitationEmailProcessor(deps);
    const result = await process({
      id: "1",
      attemptsMade: 0,
      data: { code: keys[0]!.code, kind: "invitation" },
    });
    expect(result.status).toBe("sent");
    expect(transport.sent[0]!.subject).toBe("Convite para Jornada");
    expect(transport.sent[0]!.text).toContain(keys[0]!.code);
    expect(keyStore.keys[0]!.status).toBe("pending_confirmation");
  });

  it("propaga el fallo del transporte para que BullMQ reintente", async () => {
    const { keys, keyStore, transport, deps } = await fixture(1);
    transport.failNext();
    const process = createInvitationEmailProcessor(deps);
    const job = {
      id: "1",
      attemptsMade: 0,
      data: { code: keys[0]!.code, kind: "invitation" as const },
    };
    await expect(process(job)).rejects.toThrow("Fallo simulado del transporte");
    expect(keyStore.keys[0]!.sentAt).toBeNull();
    await expect(process({ ...job, attemptsMade: 1 })).resolves.toMatchObject({ status: "sent" });
    expect(INVITATION_EMAIL_JOB_OPTIONS.attempts).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Integración GATEADA: BullMQ real contra Redis (en CI no hay Redis y se salta).
//   REDIS_URL=redis://localhost:56380 pnpm --filter @escaperoom/worker test
// ---------------------------------------------------------------------------
const hasRedis = Boolean(process.env.REDIS_URL);

describe.skipIf(!hasRedis)("worker de invitaciones (integración: BullMQ + Redis)", () => {
  const queueName = `mail.invitation.test-${randomUUID()}`;
  let producer: ReturnType<typeof createQueueRedis>;
  let consumer: ReturnType<typeof createQueueRedis>;
  let queue: Queue<InvitationEmailJob>;
  let events: QueueEvents;

  beforeAll(async () => {
    producer = createQueueRedis();
    consumer = createQueueRedis();
    queue = new Queue(queueName, { connection: asBullConnection(producer), prefix: queuePrefix() });
    events = new QueueEvents(queueName, {
      connection: asBullConnection(createQueueRedis()),
      prefix: queuePrefix(),
    });
    await events.waitUntilReady();
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    await events?.close();
    await producer?.quit().catch(() => undefined);
    await consumer?.quit().catch(() => undefined);
  });

  it("encola 30 envíos, reintenta los que fallan y acaba entregándolos todos", async () => {
    const { keys, keyStore, transport, deps } = await fixture(30);
    // Los 3 primeros intentos fallan: esos jobs se reintentan.
    transport.failNext(3);
    const worker = createInvitationEmailWorker({
      deps,
      connection: consumer,
      queueName,
      concurrency: 1,
    });
    try {
      const jobs = await queue.addBulk(
        keys.map((k) => ({
          name: queueName,
          data: { code: k.code, kind: "bulk" as const },
          // Mismas opciones que la cola real, con un backoff corto para el test.
          opts: { ...INVITATION_EMAIL_JOB_OPTIONS, backoff: { type: "fixed", delay: 20 } },
        })),
      );
      expect(jobs).toHaveLength(30);
      await Promise.all(jobs.map((j) => j.waitUntilFinished(events, 20_000)));

      expect(transport.sent).toHaveLength(30);
      expect(new Set(transport.sent.map((m) => m.to)).size).toBe(30);
      expect(keyStore.keys.every((k) => k.status === "pending_confirmation")).toBe(true);
      const attempts = await Promise.all(
        jobs.map(async (j) => (await queue.getJob(j.id!))!.attemptsMade),
      );
      expect(attempts.reduce((a, b) => a + b, 0)).toBe(33);
    } finally {
      await worker.close();
    }
  });
});
