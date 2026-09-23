import { createMemoryMailTransport, type InvitationEmailJob } from "@escaperoom/shared/mail";
import {
  ANONYMOUS_ACTOR,
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
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createAccessKeyHandlers, createInvitationHandlers } from "../src/server/rest/access-keys";

/** DPA de la organización en regla: la puerta de 5.11 se prueba en `organizations.test.ts`. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");

type ErrorJson = { error: { code: string } };

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

/** Handlers REST con stores en memoria, cola falsa y el worker simulado (`drain`). */
function setup() {
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
    roomTitles: {},
  });
  const jobs: InvitationEmailJob[] = [];
  const confirmation = { secret: "secreto-de-test-de-al-menos-32-caracteres", ttlSeconds: 3600 };
  const invitations = createInvitationService({
    store,
    accessKeys,
    queue: {
      enqueue: async (job) => {
        jobs.push(job);
        return String(jobs.length);
      },
    },
    confirmation,
    now,
  });
  const transport = createMemoryMailTransport();
  const actors: Record<string, Actor> = { autora: author, otra: other };
  const resolveActor = async (req: Request) =>
    actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR;
  const keyHandlers = createAccessKeyHandlers({ accessKeys, resolveActor, invitations });
  const handlers = createInvitationHandlers({ invitations, resolveActor });

  const req = (path: string, init: { method?: string; user?: string; body?: unknown } = {}) =>
    new Request(`http://localhost/api/${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(init.user ? { "x-test-user": init.user } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
  const codeCtx = (code: string) => ({
    params: Promise.resolve({ code: encodeURIComponent(code) }),
  });

  return {
    jobs,
    transport,
    keyStore,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    drain: async () => {
      const deps = { store, transport, confirmation, appUrl: "https://app.example.com", now };
      for (const job of jobs.splice(0)) await deliverInvitationEmail(deps, job);
    },
    createEvent: (over: Record<string, unknown> = {}) =>
      events.createEvent(author, {
        roomVersionId: VERSION,
        title: "Jornada",
        maxSimultaneousSessions: 2,
        groupingMode: "random",
        requireConfirmation: true,
        expiryRules: [],
        playersPlanned: 30,
        locale: "en",
        ...over,
      }),
    activate: (id: string, body: unknown) =>
      keyHandlers.postActivate(
        req(`events/${id}/activate`, { method: "POST", user: "autora", body }),
        idCtx(id),
      ),
    generate: (id: string, body: unknown) =>
      keyHandlers.postAccessKeys(
        req(`events/${id}/access-keys`, { method: "POST", user: "autora", body }),
        idCtx(id),
      ),
    summary: (id: string, user?: string) =>
      handlers.getSummary(req(`events/${id}/invitations`, { user }), idCtx(id)),
    resendPending: (id: string, user?: string) =>
      handlers.postResendPending(
        req(`events/${id}/invitations/resend`, { method: "POST", user }),
        idCtx(id),
      ),
    resend: (code: string, user?: string) =>
      handlers.postResend(
        req(`access-keys/${encodeURIComponent(code)}/resend`, { method: "POST", user }),
        codeCtx(code),
      ),
    confirm: (code: string, body: unknown) =>
      handlers.postConfirm(
        req(`access-keys/${encodeURIComponent(code)}/confirm`, { method: "POST", body }),
        codeCtx(code),
      ),
  };
}

function linkOf(text: string): { code: string; token: string } {
  const match = /\/invitations\/([A-Z0-9-]+)\/confirm\?token=(\S+)/.exec(text);
  if (!match) throw new Error("sin enlace de confirmación");
  return { code: decodeURIComponent(match[1]!), token: decodeURIComponent(match[2]!) };
}

describe("invitaciones por email (REST, ticket 5.6)", () => {
  it("activar con 30 emails encola 30 envíos; confirmar y resumir N/30", async () => {
    const t = setup();
    const event = await t.createEvent();
    const emails = Array.from({ length: 30 }, (_, i) => `p${i}@example.com`);
    const res = await t.activate(event.id, { keyPlan: [{ type: "batch", emails }] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { emails: unknown }).emails).toEqual({
      requested: 30,
      queued: 30,
    });
    expect(t.jobs).toHaveLength(30);
    await t.drain();
    expect(t.transport.sent).toHaveLength(30);
    expect(t.transport.sent[0]!.subject).toBe("Your key for Jornada");

    for (const mail of t.transport.sent.slice(0, 28)) {
      const { code, token } = linkOf(mail.text);
      const confirmed = await t.confirm(code, { token });
      expect(confirmed.status).toBe(200);
      expect(await confirmed.json()).toEqual({
        status: "confirmed",
        alreadyConfirmed: false,
        eventTitle: "Jornada",
      });
    }
    const summary = await t.summary(event.id, "autora");
    expect(summary.status).toBe(200);
    expect(summary.headers.get("cache-control")).toBe("no-store");
    expect(await summary.json()).toEqual({
      requireConfirmation: true,
      invited: 30,
      sent: 30,
      confirmed: 28,
      pending: 2,
      expired: 0,
    });

    const reminder = await t.resendPending(event.id, "autora");
    expect(reminder.status).toBe(202);
    expect(await reminder.json()).toEqual({ requested: 2, queued: 2 });
  });

  it("enlace manipulado → 403, caducado → 410, sin token → 422", async () => {
    const t = setup();
    const event = await t.createEvent();
    await t.activate(event.id, { keyPlan: [{ type: "individual", emails: ["a@example.com"] }] });
    await t.drain();
    const { code, token } = linkOf(t.transport.sent[0]!.text);

    const tampered = await t.confirm(code, { token: `${token.slice(0, -2)}xx` });
    expect(tampered.status).toBe(403);
    expect(((await tampered.json()) as ErrorJson).error.code).toBe("CONFIRMATION_INVALID");
    const missing = await t.confirm(code, {});
    expect(missing.status).toBe(422);

    t.advance(2 * 3_600_000);
    const expired = await t.confirm(code, { token });
    expect(expired.status).toBe(410);
    expect(((await expired.json()) as ErrorJson).error.code).toBe("CONFIRMATION_EXPIRED");
    expect(t.keyStore.keys[0]!.status).toBe("pending_confirmation");
  });

  it("generar con emails encola; reenvío 202; errores de permisos", async () => {
    const t = setup();
    const event = await t.createEvent({ requireConfirmation: false, playersPlanned: 5 });
    await t.activate(event.id, { keyPlan: [{ type: "group", count: 1, seats: 3 }] });
    const res = await t.generate(event.id, { type: "individual", emails: ["b@example.com"] });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      items: Array<{ code: string; sentAt: string | null }>;
      emails: unknown;
    };
    expect(json.emails).toEqual({ requested: 1, queued: 1 });
    expect(json.items[0]!.sentAt).toBeNull();
    const code = json.items[0]!.code;

    const resent = await t.resend(code, "autora");
    expect(resent.status).toBe(202);
    expect(await resent.json()).toEqual({ code, kind: "invitation", queued: true });
    expect((await t.resend(code, "otra")).status).toBe(403);
    expect((await t.resend(code)).status).toBe(401);
    expect((await t.summary(event.id)).status).toBe(401);
    expect((await t.summary(event.id, "otra")).status).toBe(403);
    expect((await t.resendPending(event.id, "otra")).status).toBe(403);
  });
});
