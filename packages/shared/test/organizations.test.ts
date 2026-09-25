// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { InvitationEmailJob } from "../src/mail";
import {
  AccessKeyError,
  ANONYMOUS_ACTOR,
  CURRENT_DPA_VERSION,
  OrganizationError,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryInvitationStore,
  createInMemoryOrganizationStore,
  createInMemoryPricingTierStore,
  createInvitationService,
  createOrganizationService,
  createPricingTierService,
  type Actor,
  type PricingTierRow,
} from "../src/services";

const ORG = "org-colegio";
const OTHER_ORG = "org-otra";
/** Organizadora del evento y propietaria de la organización. */
const owner: Actor = { userId: "autora", organizationId: ORG, role: "member" };
const admin: Actor = { userId: "jefa", organizationId: ORG, role: "member" };
const plainMember: Actor = { userId: "profe", organizationId: ORG, role: "member" };
const outsider: Actor = { userId: "ajena", organizationId: null, role: "member" };

const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");
const SIGNED_AT = new Date("2026-06-01T10:00:00Z");

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

async function rejects(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `se esperaba ${code}`).toBeInstanceOf(Error);
  expect((err as { code?: string }).code).toBe(code);
  return err as Error;
}

function setup(opts: { dpaVersion?: string } = {}) {
  const now = () => SIGNED_AT;
  const orgStore = createInMemoryOrganizationStore({
    organizations: [{ id: ORG }, { id: OTHER_ORG }],
    members: [
      { organizationId: ORG, userId: owner.userId, role: "owner" },
      { organizationId: ORG, userId: admin.userId, role: "admin" },
      { organizationId: ORG, userId: plainMember.userId, role: "member" },
    ],
  });
  const organizations = createOrganizationService({
    store: orgStore,
    now,
    ...(opts.dpaVersion ? { currentDpaVersion: opts.dpaVersion } : {}),
  });

  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({ adminIds: [], tiers: [tier] }),
    now,
  });
  const eventStore = createInMemoryEventStore({
    roomVersions: [
      {
        roomVersionId: VERSION,
        roomId: "20000000-0000-4000-8000-000000000001",
        authorId: owner.userId,
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
  const accessKeys = createAccessKeyService({
    store: keyStore,
    events,
    dpa: organizations.dpaGate((message) => new AccessKeyError("DPA_REQUIRED", message)),
    now,
  });
  const jobs: InvitationEmailJob[] = [];
  const invitations = createInvitationService({
    store: createInMemoryInvitationStore({ keys: keyStore }),
    accessKeys,
    queue: {
      async enqueue(job) {
        jobs.push(job);
        return `job-${jobs.length}`;
      },
      async enqueueBulk(items) {
        return items.map((job) => {
          jobs.push(job);
          return `job-${jobs.length}`;
        });
      },
    },
    confirmation: { secret: "secreto-de-test-de-al-menos-32-caracteres", ttlSeconds: 3600 },
    now,
  });

  /** Evento de la organizadora (autoventa: activable sin pago). */
  async function createEvent() {
    return events.createEvent(owner, {
      roomVersionId: VERSION,
      title: "Jornada de 4ºB",
      maxSimultaneousSessions: 2,
      groupingMode: "random",
      requireConfirmation: true,
      expiryRules: [],
      playersPlanned: 30,
    });
  }

  async function activeEvent() {
    const event = await createEvent();
    await accessKeys.activateEvent(owner, event.id, {
      keyPlan: [{ type: "group", count: 1, seats: 5 }],
    });
    return event;
  }

  return {
    orgStore,
    organizations,
    accessKeys,
    invitations,
    keyStore,
    jobs,
    createEvent,
    activeEvent,
  };
}

describe("firma del DPA (POST /api/organizations/:id/dpa/sign)", () => {
  it("el propietario firma la versión vigente y se registran versión, firmante y fecha", async () => {
    const t = setup();
    const result = await t.organizations.signDpa(owner, ORG, { version: CURRENT_DPA_VERSION });
    expect(result).toMatchObject({
      organizationId: ORG,
      signed: true,
      alreadySigned: false,
      version: CURRENT_DPA_VERSION,
      signedBy: owner.userId,
      signedAt: SIGNED_AT,
    });
    expect(t.orgStore.organizations.find((o) => o.id === ORG)).toMatchObject({
      dpaVersion: CURRENT_DPA_VERSION,
      dpaSignedBy: owner.userId,
      dpaSignedAt: SIGNED_AT,
    });
  });

  it("un admin también puede firmar; volver a firmar conserva la firma original", async () => {
    const t = setup();
    await t.organizations.signDpa(admin, ORG, { version: CURRENT_DPA_VERSION });
    const again = await t.organizations.signDpa(owner, ORG, { version: CURRENT_DPA_VERSION });
    expect(again).toMatchObject({ alreadySigned: true, signedBy: admin.userId });
  });

  it("acepta roles múltiples de Better Auth (`member,admin`)", async () => {
    const t = setup();
    t.orgStore.members.find((m) => m.userId === plainMember.userId)!.role = "member,admin";
    const result = await t.organizations.signDpa(plainMember, ORG, {
      version: CURRENT_DPA_VERSION,
    });
    expect(result.signedBy).toBe(plainMember.userId);
  });

  it("un miembro sin rol de owner/admin → FORBIDDEN y no se firma nada", async () => {
    const t = setup();
    await rejects(
      t.organizations.signDpa(plainMember, ORG, { version: CURRENT_DPA_VERSION }),
      "FORBIDDEN",
    );
    expect(t.orgStore.organizations.find((o) => o.id === ORG)?.dpaSignedAt).toBeNull();
  });

  it("anónimo → UNAUTHORIZED; no miembro u organización inexistente → NOT_FOUND", async () => {
    const t = setup();
    const body = { version: CURRENT_DPA_VERSION };
    await rejects(t.organizations.signDpa(ANONYMOUS_ACTOR, ORG, body), "UNAUTHORIZED");
    await rejects(t.organizations.signDpa(outsider, ORG, body), "NOT_FOUND");
    await rejects(t.organizations.signDpa(owner, OTHER_ORG, body), "NOT_FOUND");
    await rejects(t.organizations.signDpa(owner, "no-existe", body), "NOT_FOUND");
  });

  it("versión distinta de la vigente → DPA_VERSION_MISMATCH; cuerpo inválido → VALIDATION_ERROR", async () => {
    const t = setup();
    await rejects(
      t.organizations.signDpa(owner, ORG, { version: "2020-01-01" }),
      "DPA_VERSION_MISMATCH",
    );
    const err = await rejects(t.organizations.signDpa(owner, ORG, {}), "VALIDATION_ERROR");
    expect((err as OrganizationError).issues.map((i) => i.path)).toContain("version");
  });

  it("dpaStatus lo ve cualquier miembro", async () => {
    const t = setup();
    expect(await t.organizations.dpaStatus(plainMember, ORG)).toMatchObject({
      signed: false,
      currentVersion: CURRENT_DPA_VERSION,
    });
  });
});

describe("bloqueo de claves e invitaciones por email sin DPA", () => {
  it("sin DPA: generar claves individuales con email → DPA_REQUIRED y no se crea ninguna", async () => {
    const t = setup();
    const event = await t.activeEvent();
    const before = t.keyStore.keys.length;
    await rejects(
      t.invitations.generateAndInvite(owner, event.id, {
        type: "individual",
        emails: ["alumno1@colegio.example.com", "alumno2@colegio.example.com"],
      }),
      "DPA_REQUIRED",
    );
    expect(t.keyStore.keys.length).toBe(before);
    expect(t.jobs).toHaveLength(0);
  });

  it("sin DPA: activar con un plan con emails → DPA_REQUIRED y el evento sigue en draft", async () => {
    const t = setup();
    const event = await t.createEvent();
    await rejects(
      t.invitations.activateAndInvite(owner, event.id, {
        keyPlan: [{ type: "individual", emails: ["alumno1@colegio.example.com"] }],
      }),
      "DPA_REQUIRED",
    );
    expect(t.keyStore.keys).toHaveLength(0);
    await rejects(
      t.accessKeys.generateKeys(owner, event.id, { type: "batch", count: 1 }),
      "EVENT_NOT_ACTIVE",
    );
  });

  it("sin DPA: group, batch e individual sin email siguen permitidas", async () => {
    const t = setup();
    const event = await t.activeEvent();
    const group = await t.accessKeys.generateKeys(owner, event.id, {
      type: "group",
      count: 1,
      seats: 5,
    });
    const batch = await t.accessKeys.generateKeys(owner, event.id, { type: "batch", count: 10 });
    const printed = await t.accessKeys.generateKeys(owner, event.id, {
      type: "individual",
      count: 3,
    });
    expect([group.length, batch.length, printed.length]).toEqual([1, 10, 3]);
  });

  it("sin DPA: reenviar o recordar invitaciones → DPA_REQUIRED", async () => {
    const t = setup();
    const event = await t.activeEvent();
    await t.organizations.signDpa(owner, ORG, { version: CURRENT_DPA_VERSION });
    const { keys } = await t.invitations.generateAndInvite(owner, event.id, {
      type: "individual",
      emails: ["alumno1@colegio.example.com"],
    });
    // El DPA deja de estar vigente (p. ej. cambió el texto): la firma ya no habilita.
    t.orgStore.organizations.find((o) => o.id === ORG)!.dpaVersion = "2020-01-01";
    t.jobs.length = 0;
    await rejects(t.invitations.resend(owner, keys[0]!.code), "DPA_REQUIRED");
    await rejects(t.invitations.resendPending(owner, event.id), "DPA_REQUIRED");
    expect(t.jobs).toHaveLength(0);
  });

  it("tras firmar el DPA se habilitan las claves individuales con email y su envío", async () => {
    const t = setup();
    const event = await t.activeEvent();
    await t.organizations.signDpa(admin, ORG, { version: CURRENT_DPA_VERSION });
    const { keys, emails } = await t.invitations.generateAndInvite(owner, event.id, {
      type: "individual",
      emails: ["alumno1@colegio.example.com", "alumno2@colegio.example.com"],
    });
    expect(keys.map((k) => k.email)).toEqual([
      "alumno1@colegio.example.com",
      "alumno2@colegio.example.com",
    ]);
    expect(emails).toEqual({ requested: 2, queued: 2 });
    const resent = await t.invitations.resend(owner, keys[0]!.code);
    expect(resent.queued).toBe(true);
  });

  it("activar con plan con emails funciona tras firmar", async () => {
    const t = setup();
    await t.organizations.signDpa(owner, ORG, { version: CURRENT_DPA_VERSION });
    const event = await t.createEvent();
    const result = await t.invitations.activateAndInvite(owner, event.id, {
      keyPlan: [{ type: "individual", emails: ["alumno1@colegio.example.com"] }],
    });
    expect(result.emails).toEqual({ requested: 1, queued: 1 });
  });

  it("la firma es de la organización activa del actor: sin organización o en otra → DPA_REQUIRED", async () => {
    const t = setup();
    await t.organizations.signDpa(owner, ORG, { version: CURRENT_DPA_VERSION });
    const event = await t.activeEvent();
    const input = { type: "individual", emails: ["alumno1@colegio.example.com"] };
    await rejects(
      t.accessKeys.generateKeys({ ...owner, organizationId: null }, event.id, input),
      "DPA_REQUIRED",
    );
    // Organización activa de la que no es miembro (sesión manipulada o baja): no cuenta.
    t.orgStore.organizations.find((o) => o.id === OTHER_ORG)!.dpaSignedAt = SIGNED_AT;
    t.orgStore.organizations.find((o) => o.id === OTHER_ORG)!.dpaVersion = CURRENT_DPA_VERSION;
    await rejects(
      t.accessKeys.generateKeys({ ...owner, organizationId: OTHER_ORG }, event.id, input),
      "DPA_REQUIRED",
    );
  });

  it("si cambia la versión del DPA se exige re-firma antes de volver a usar emails", async () => {
    const t = setup({ dpaVersion: "2027-01-01" });
    const org = t.orgStore.organizations.find((o) => o.id === ORG)!;
    Object.assign(org, {
      dpaSignedAt: T0,
      dpaVersion: CURRENT_DPA_VERSION,
      dpaSignedBy: owner.userId,
    });
    const event = await t.activeEvent();
    const input = { type: "individual", emails: ["alumno1@colegio.example.com"] };
    const err = await rejects(t.accessKeys.generateKeys(owner, event.id, input), "DPA_REQUIRED");
    expect(err.message).toContain("2027-01-01");
    expect(await t.organizations.dpaStatus(owner, ORG)).toMatchObject({ signed: false });

    const resigned = await t.organizations.signDpa(owner, ORG, { version: "2027-01-01" });
    expect(resigned).toMatchObject({ alreadySigned: false, version: "2027-01-01", signed: true });
    expect(await t.accessKeys.generateKeys(owner, event.id, input)).toHaveLength(1);
  });

  it("los errores de permisos del evento van antes que el DPA", async () => {
    const t = setup();
    const event = await t.activeEvent();
    await rejects(
      t.accessKeys.generateKeys(admin, event.id, {
        type: "individual",
        emails: ["alumno1@colegio.example.com"],
      }),
      "FORBIDDEN",
    );
  });
});
