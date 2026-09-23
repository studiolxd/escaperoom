// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMemoryMailTransport, MailDeliveryError, type InvitationEmailJob } from "../src/mail";
import {
  AccessKeyError,
  ANONYMOUS_ACTOR,
  checkRedeemable,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryInvitationStore,
  createInMemoryPricingTierStore,
  createInvitationService,
  createPricingTierService,
  deliverInvitationEmail,
  type Actor,
  type PricingTierRow,
  type DpaGate,
} from "../src/services";

/** DPA de la organización en regla: la puerta de 5.11 se prueba en `organizations.test.ts`. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");
const HOUR = 3_600_000;
const APP_URL = "https://escaperoom.example.com";
const SECRET = "secreto-de-test-de-al-menos-32-caracteres";

const tier: PricingTierRow = {
  id: "00000000-0000-4000-8000-000000000001",
  minPlayers: 1,
  maxPlayers: null,
  priceCentsPerPlayer: 100,
  currency: "EUR",
  activeFrom: T0,
  activeUntil: null,
  createdBy: "seed-admin",
  createdAt: T0,
};

const emails = (n: number, prefix = "alumno") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}@colegio.example.com`);

function setup(opts: { organizerLocale?: string; queueEnabled?: boolean } = {}) {
  let clock = new Date("2026-06-01T10:00:00Z");
  const now = () => clock;
  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({ adminIds: [], tiers: [tier] }),
    now,
  });
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
    pricing,
    payments: createFakePaymentGateway(),
    now,
  });
  const keyStore = createInMemoryAccessKeyStore({ events: eventStore });
  const accessKeys = createAccessKeyService({ store: keyStore, events, dpa: DPA_SIGNED, now });
  const store = createInMemoryInvitationStore({
    keys: keyStore,
    organizerLocales: opts.organizerLocale ? { [author.userId]: opts.organizerLocale } : {},
  });

  /** Cola falsa: guarda los jobs; `null` si está deshabilitada (como `QUEUES_ENABLED=false`). */
  const jobs: InvitationEmailJob[] = [];
  const queue = {
    async enqueue(job: InvitationEmailJob) {
      if (opts.queueEnabled === false) return null;
      jobs.push(job);
      return `job-${jobs.length}`;
    },
  };
  const confirmation = { secret: SECRET, ttlSeconds: 7 * 24 * 3600 };
  const invitations = createInvitationService({
    store,
    accessKeys,
    queue,
    confirmation,
    now,
  });
  const transport = createMemoryMailTransport();
  const deliveryDeps = { store, transport, confirmation, appUrl: APP_URL, now };

  /** El worker: entrega (y vacía) los jobs encolados. */
  async function drain() {
    const pending = jobs.splice(0);
    return Promise.all(pending.map((job) => deliverInvitationEmail(deliveryDeps, job)));
  }

  async function createEvent(over: Record<string, unknown> = {}) {
    return events.createEvent(author, {
      roomVersionId: VERSION,
      title: "Jornada de 4ºB",
      maxSimultaneousSessions: 3,
      groupingMode: "random",
      requireConfirmation: true,
      expiryRules: [],
      playersPlanned: 30,
      ...over,
    });
  }

  return {
    accessKeys,
    invitations,
    keyStore,
    jobs,
    transport,
    deliveryDeps,
    drain,
    createEvent,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AccessKeyError);
  expect((err as AccessKeyError).code).toBe(code);
}

/** Código y token del enlace de confirmación de un email. */
function linkOf(text: string): { code: string; token: string } {
  const match = /\/invitations\/([A-Z0-9-]+)\/confirm\?token=(\S+)/.exec(text);
  if (!match) throw new Error("el email no lleva enlace de confirmación");
  return { code: decodeURIComponent(match[1]!), token: decodeURIComponent(match[2]!) };
}

describe("invitaciones por email (ticket 5.6)", () => {
  it("invitar a 30 emails encola 30 envíos y cada email lleva su clave en el idioma del evento", async () => {
    const t = setup();
    const event = await t.createEvent({ locale: "fr" });
    const list = emails(30);
    const activation = await t.invitations.activateAndInvite(author, event.id, {
      keyPlan: [{ type: "batch", emails: list }],
    });

    expect(activation.keys).toHaveLength(30);
    expect(activation.emails).toEqual({ requested: 30, queued: 30 });
    expect(t.jobs).toHaveLength(30);
    expect(new Set(t.jobs.map((j) => j.code)).size).toBe(30);
    // El job solo lleva código y tipo: ni la dirección ni datos personales.
    expect(t.jobs.every((j) => Object.keys(j).sort().join() === "code,kind")).toBe(true);
    expect(t.jobs.every((j) => j.kind === "bulk")).toBe(true);

    const results = await t.drain();
    expect(results.every((r) => r.status === "sent")).toBe(true);
    expect(t.transport.sent).toHaveLength(30);
    for (const key of activation.keys) {
      const mail = t.transport.sent.find((m) => m.to === key.email)!;
      expect(mail.text).toContain(key.code);
      expect(mail.html).toContain(key.code);
      // Francés: asunto y cuerpo de la plantilla masiva.
      expect(mail.subject).toBe("Votre clé pour Jornada de 4ºB");
      expect(mail.text).toContain("Voici votre clé personnelle");
      expect(mail.html).toContain('lang="fr"');
      expect(linkOf(mail.text).code).toBe(key.code);
      expect(mail.text).toContain(`${APP_URL}/fr/invitations/`);
    }
    // Enviado → pendiente de confirmar, con `sentAt`.
    expect(t.keyStore.keys.every((k) => k.status === "pending_confirmation")).toBe(true);
    expect(t.keyStore.keys.every((k) => k.sentAt !== null)).toBe(true);
  });

  it("confirmar con el enlace cambia el estado de la clave y el resumen refleja N/30 confirmados", async () => {
    const t = setup();
    const event = await t.createEvent();
    await t.invitations.activateAndInvite(author, event.id, {
      keyPlan: [{ type: "individual", emails: emails(30) }],
    });
    expect(await t.invitations.summary(author, event.id)).toEqual({
      requireConfirmation: true,
      invited: 30,
      sent: 0,
      confirmed: 0,
      pending: 30,
      expired: 0,
    });
    await t.drain();

    const mails = t.transport.sent;
    for (const mail of mails.slice(0, 28)) {
      const { code, token } = linkOf(mail.text);
      const result = await t.invitations.confirm(code, { token });
      expect(result).toEqual({
        status: "confirmed",
        alreadyConfirmed: false,
        eventTitle: "Jornada de 4ºB",
      });
    }
    expect(await t.invitations.summary(author, event.id)).toEqual({
      requireConfirmation: true,
      invited: 30,
      sent: 30,
      confirmed: 28,
      pending: 2,
      expired: 0,
    });

    // Confirmada = canjeable; pendiente = ACCESS_KEY_NOT_CONFIRMED (specs/13 §6.2).
    const confirmed = t.keyStore.keys.find((k) => k.status === "confirmed")!;
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(checkRedeemable(confirmed, new Date("2026-06-01T11:00:00Z"))).toEqual({ ok: true });
    const pending = t.keyStore.keys.find((k) => k.status === "pending_confirmation")!;
    expect(checkRedeemable(pending, new Date("2026-06-01T11:00:00Z"))).toEqual({
      ok: false,
      code: "ACCESS_KEY_NOT_CONFIRMED",
    });

    // Volver a pulsar el enlace es idempotente.
    const again = linkOf(mails[0]!.text);
    expect(await t.invitations.confirm(again.code, { token: again.token })).toMatchObject({
      status: "confirmed",
      alreadyConfirmed: true,
    });

    // Recordatorio a los 2 pendientes.
    expect(await t.invitations.resendPending(author, event.id)).toEqual({
      requested: 2,
      queued: 2,
    });
    expect(t.jobs.map((j) => j.kind)).toEqual(["reminder", "reminder"]);
    await t.drain();
    const reminders = t.transport.sent.slice(30);
    expect(reminders).toHaveLength(2);
    expect(reminders[0]!.subject).toBe("Recordatorio: tu invitación a Jornada de 4ºB");
    expect(reminders.every((m) => linkOf(m.text).code.length > 0)).toBe(true);
  });

  it("enlace manipulado, de otra clave o caducado → rechazo sin tocar la clave", async () => {
    const t = setup();
    const event = await t.createEvent({
      expiryRules: [{ type: "hours_after_start", startsAt: "2026-06-10T09:00:00Z", hours: 8 }],
    });
    await t.invitations.activateAndInvite(author, event.id, {
      keyPlan: [{ type: "individual", emails: emails(2) }],
    });
    await t.drain();
    const [a, b] = t.transport.sent.map((m) => linkOf(m.text)) as [
      { code: string; token: string },
      { code: string; token: string },
    ];

    const [payload, sig] = a.token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ c: a.code, e: 4_102_444_800 })).toString(
      "base64url",
    );
    await rejects(
      t.invitations.confirm(a.code, { token: `${forged}.${sig}` }),
      "CONFIRMATION_INVALID",
    );
    await rejects(
      t.invitations.confirm(a.code, { token: `${payload}.x${sig.slice(1)}` }),
      "CONFIRMATION_INVALID",
    );
    // El token de B no confirma A.
    await rejects(t.invitations.confirm(a.code, { token: b.token }), "CONFIRMATION_INVALID");
    await rejects(t.invitations.confirm(a.code, { token: "" }), "VALIDATION_ERROR");
    await rejects(t.invitations.confirm("no-es-clave", { token: a.token }), "CONFIRMATION_INVALID");
    expect(t.keyStore.keys.every((k) => k.status === "pending_confirmation")).toBe(true);

    // El enlace caduca con la clave (fin de la jornada, antes que el TTL de 7 días).
    t.advance(10 * 24 * HOUR);
    await rejects(t.invitations.confirm(a.code, { token: a.token }), "CONFIRMATION_EXPIRED");
    expect(t.keyStore.keys.every((k) => k.status === "pending_confirmation")).toBe(true);
  });

  it("el enlace caduca a los N días aunque la clave no caduque", async () => {
    const t = setup();
    const event = await t.createEvent();
    await t.invitations.activateAndInvite(author, event.id, {
      keyPlan: [{ type: "individual", emails: emails(1) }],
    });
    await t.drain();
    const link = linkOf(t.transport.sent[0]!.text);
    t.advance(7 * 24 * HOUR);
    await rejects(t.invitations.confirm(link.code, { token: link.token }), "CONFIRMATION_EXPIRED");
    // Un reenvío firma un enlace nuevo que sí vale.
    await t.invitations.resend(author, link.code);
    await t.drain();
    const fresh = linkOf(t.transport.sent[1]!.text);
    await expect(t.invitations.confirm(fresh.code, { token: fresh.token })).resolves.toMatchObject({
      status: "confirmed",
    });
  });

  it("una clave rotada no se confirma con el enlace viejo", async () => {
    const t = setup();
    const event = await t.createEvent();
    await t.invitations.activateAndInvite(author, event.id, {
      keyPlan: [{ type: "rotating", seats: 5, emails: ["tutor@colegio.example.com"] }],
    });
    await t.drain();
    const link = linkOf(t.transport.sent[0]!.text);
    const rotated = await t.accessKeys.regenerateKey(author, link.code);
    expect(rotated.status).toBe("generated");
    expect(rotated.sentAt).toBeNull();
    await rejects(t.invitations.confirm(link.code, { token: link.token }), "ACCESS_KEY_EXPIRED");
    // El job pendiente de la vieja ya no envía nada; la nueva se reenvía.
    expect(
      await deliverInvitationEmail(t.deliveryDeps, { code: link.code, kind: "reminder" }),
    ).toEqual({ status: "skipped", reason: "KEY_NOT_LIVE" });
    expect(await t.invitations.resend(author, rotated.code)).toEqual({
      code: rotated.code,
      kind: "invitation",
      queued: true,
    });
    // La rotada no cuenta dos veces en el resumen.
    expect((await t.invitations.summary(author, event.id)).invited).toBe(1);
  });

  it("reenvío: individual, recordatorio si falta confirmar, y errores", async () => {
    const t = setup();
    const event = await t.createEvent({ requireConfirmation: false, playersPlanned: 3 });
    const activation = await t.invitations.activateAndInvite(author, event.id, {
      keyPlan: [
        { type: "individual", emails: ["ana@example.com"] },
        { type: "individual", count: 1 },
      ],
    });
    expect(activation.emails).toEqual({ requested: 1, queued: 1 });
    expect(t.jobs).toEqual([{ code: expect.any(String), kind: "invitation" }]);
    await t.drain();
    const [withEmail, withoutEmail] = activation.keys;

    // Sin confirmación: la clave sigue `active` y el email no lleva enlace.
    const sentKey = t.keyStore.keys.find((k) => k.code === withEmail!.code)!;
    expect(sentKey.status).toBe("active");
    expect(sentKey.sentAt).not.toBeNull();
    expect(t.transport.sent[0]!.text).not.toContain("/confirm?token=");
    expect(t.transport.sent[0]!.subject).toBe("Invitación a Jornada de 4ºB");

    expect(await t.invitations.resend(author, withEmail!.code.toLowerCase())).toEqual({
      code: withEmail!.code,
      kind: "invitation",
      queued: true,
    });
    await t.drain();
    expect(t.transport.sent).toHaveLength(2);
    expect(t.transport.sent[1]!.to).toBe("ana@example.com");

    await rejects(t.invitations.resend(author, withoutEmail!.code), "ACCESS_KEY_NO_EMAIL");
    await rejects(t.invitations.resend(other, withEmail!.code), "FORBIDDEN");
    await rejects(t.invitations.resend(ANONYMOUS_ACTOR, withEmail!.code), "UNAUTHORIZED");
    await rejects(t.invitations.resend(author, "ZZZZ-ZZZZ-ZZZZ"), "NOT_FOUND");
    await rejects(t.invitations.resendPending(other, event.id), "FORBIDDEN");
    await rejects(t.invitations.summary(other, event.id), "FORBIDDEN");

    await t.accessKeys.consumeSeat(withEmail!.code);
    await rejects(t.invitations.resend(author, withEmail!.code), "ACCESS_KEY_USED");
  });

  it("generar a demanda con un email → invitación individual; con varios → masiva", async () => {
    const t = setup();
    const event = await t.createEvent({ requireConfirmation: false });
    await t.accessKeys.activateEvent(author, event.id, {
      keyPlan: [{ type: "group", count: 1, seats: 10 }],
    });
    const one = await t.invitations.generateAndInvite(author, event.id, {
      type: "individual",
      emails: ["uno@example.com"],
    });
    expect(one.emails).toEqual({ requested: 1, queued: 1 });
    const many = await t.invitations.generateAndInvite(author, event.id, {
      type: "batch",
      emails: emails(3),
    });
    expect(many.emails).toEqual({ requested: 3, queued: 3 });
    const none = await t.invitations.generateAndInvite(author, event.id, {
      type: "individual",
      count: 2,
    });
    expect(none.emails).toEqual({ requested: 0, queued: 0 });
    expect(t.jobs.map((j) => j.kind)).toEqual(["invitation", "bulk", "bulk", "bulk"]);
  });

  it("fallo del transporte → el job falla (BullMQ reintenta) sin marcar la clave; el reintento entrega", async () => {
    const t = setup();
    const event = await t.createEvent();
    await t.invitations.activateAndInvite(author, event.id, {
      keyPlan: [{ type: "individual", emails: emails(1) }],
    });
    const [job] = t.jobs;
    t.transport.failNext(2);
    await expect(deliverInvitationEmail(t.deliveryDeps, job!)).rejects.toBeInstanceOf(
      MailDeliveryError,
    );
    await expect(deliverInvitationEmail(t.deliveryDeps, job!)).rejects.toBeInstanceOf(
      MailDeliveryError,
    );
    expect(t.keyStore.keys[0]).toMatchObject({ status: "generated", sentAt: null });
    await expect(deliverInvitationEmail(t.deliveryDeps, job!)).resolves.toMatchObject({
      status: "sent",
    });
    expect(t.keyStore.keys[0]!.status).toBe("pending_confirmation");
    expect(t.transport.sent).toHaveLength(1);
  });

  it("sin idioma en el evento usa el del organizador; con la cola deshabilitada no encola", async () => {
    const t = setup({ organizerLocale: "de", queueEnabled: false });
    const event = await t.createEvent();
    const res = await t.invitations.activateAndInvite(author, event.id, {
      keyPlan: [{ type: "individual", emails: emails(2) }],
    });
    expect(res.emails).toEqual({ requested: 2, queued: 0 });
    const result = await deliverInvitationEmail(t.deliveryDeps, {
      code: res.keys[0]!.code,
      kind: "invitation",
    });
    expect(result.status).toBe("sent");
    expect(t.transport.sent[0]!.subject).toBe("Einladung zu Jornada de 4ºB");
    expect(t.transport.sent[0]!.text).toContain("/de/invitations/");
  });

  it("no envía a claves sin email, canjeadas o de eventos inexistentes", async () => {
    const t = setup();
    const event = await t.createEvent({ requireConfirmation: false });
    const { keys } = await t.accessKeys.activateEvent(author, event.id, {
      keyPlan: [
        { type: "individual", count: 1 },
        { type: "individual", emails: ["b@example.com"] },
      ],
    });
    expect(
      await deliverInvitationEmail(t.deliveryDeps, { code: keys[0]!.code, kind: "invitation" }),
    ).toEqual({ status: "skipped", reason: "NO_EMAIL" });
    await t.accessKeys.consumeSeat(keys[1]!.code);
    expect(
      await deliverInvitationEmail(t.deliveryDeps, { code: keys[1]!.code, kind: "invitation" }),
    ).toEqual({ status: "skipped", reason: "KEY_NOT_LIVE" });
    expect(
      await deliverInvitationEmail(t.deliveryDeps, { code: "ZZZZ-ZZZZ-ZZZZ", kind: "invitation" }),
    ).toEqual({ status: "skipped", reason: "NOT_FOUND" });
    expect(t.transport.sent).toHaveLength(0);
  });

  it("sin secreto de confirmación el endpoint responde CONFIRMATION_UNAVAILABLE", async () => {
    const t = setup();
    const svc = createInvitationService({
      store: createInMemoryInvitationStore({ keys: t.keyStore }),
      accessKeys: t.accessKeys,
      queue: { enqueue: async () => null },
      confirmation: null,
    });
    await rejects(svc.confirm("ABCD-EFGH-JKMN", { token: "a.b" }), "CONFIRMATION_UNAVAILABLE");
  });
});
