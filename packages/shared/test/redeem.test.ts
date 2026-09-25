import { describe, expect, it } from "vitest";
import {
  AccessKeyError,
  ANONYMOUS_ACTOR,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  createRedeemService,
  DEFAULT_GUEST_NAME,
  DEV_JOIN_TOKEN_SECRET,
  readJoinTokenConfig,
  sanitizeDisplayName,
  signJoinToken,
  verifyJoinToken,
  type Actor,
  type JoinClaims,
  type PricingTierRow,
  type RedeemResult,
  type DpaGate,
} from "../src/services";

/** DPA de la organización en regla: la puerta de 5.11 se prueba en `organizations.test.ts`. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };

/**
 * Canje + agrupación (ticket 5.8): `redeem` consume el asiento con
 * `consumeSeat` bajo el aforo de la sesión, asigna sesión/grupo según
 * `groupingMode` y firma el `joinToken`. Stores en memoria con la misma
 * semántica atómica que los de Prisma.
 */

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const player: Actor = { userId: "jugadora", organizationId: null, role: "member" };

const T0 = new Date("2026-01-01T00:00:00Z");
const VERSION = "10000000-0000-4000-8000-000000000001";
const SECRET = "secreto-de-test";

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

type KeyPlan = Array<{
  type: "individual" | "group" | "rotating" | "batch";
  count: number;
  seats?: number;
}>;

async function setup(
  opts: {
    groupingMode?: "specific" | "random" | "free";
    sessions?: number;
    players?: number;
    keyPlan?: KeyPlan;
  } = {},
) {
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
  const store = createInMemoryAccessKeyStore({ events: eventStore });
  const keys = createAccessKeyService({ store, events, dpa: DPA_SIGNED, now });
  let guest = 0;
  const redeem = createRedeemService({
    store,
    accessKeys: keys,
    joinToken: { secret: SECRET, ttlSeconds: 900 },
    colyseusEndpoint: "ws://colyseus.test",
    roomName: "event",
    now,
    newGuestId: () => `invitado-${++guest}`,
  });

  const event = await events.createEvent(author, {
    roomVersionId: VERSION,
    title: "Jornada",
    maxSimultaneousSessions: opts.sessions ?? 3,
    groupingMode: opts.groupingMode ?? "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: opts.players ?? 30,
  });
  const activation = await keys.activateEvent(
    author,
    event.id,
    opts.keyPlan ? { keyPlan: opts.keyPlan } : {},
  );

  /** Añade un grupo a una sesión (la API de grupos es de otro ticket). */
  function addGroup(sessionId: string, name: string): string {
    const id = crypto.randomUUID();
    store.groups.push({ id, sessionId, eventId: event.id, name, completedAt: null });
    return id;
  }

  return {
    store,
    eventStore,
    keys,
    redeem,
    event,
    sessions: activation.sessions,
    codes: activation.keys.map((k) => k.code),
    addGroup,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    now,
  };
}

async function rejects(p: Promise<unknown>, code: string): Promise<AccessKeyError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AccessKeyError);
  expect((err as AccessKeyError).code).toBe(code);
  return err as AccessKeyError;
}

function claimsOf(token: string, now: Date): JoinClaims {
  const verified = verifyJoinToken(SECRET, token, now.getTime());
  if (!verified.ok) throw new Error(`token no válido: ${verified.error}`);
  return verified.claims;
}

describe("joinToken", () => {
  const claims: JoinClaims = {
    playerId: "guest:1",
    displayName: "Ana",
    eventId: "e-1",
    sessionId: "s-1",
    groupId: null,
  };
  const now = 1_700_000_000_000;

  it("es un JWT HS256 que firma y verifica sesión, identidad y caducidad", () => {
    const token = signJoinToken(SECRET, claims, { now, expiresAt: now + 60_000 });
    expect(token.split(".")).toHaveLength(3);
    const header = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(verifyJoinToken(SECRET, token, now)).toEqual({
      ok: true,
      claims,
      expiresAt: now + 60_000,
    });
  });

  it("rechaza caducado, manipulado, otro secreto, alg none y basura", () => {
    const token = signJoinToken(SECRET, claims, { now, expiresAt: now + 60_000 });
    expect(verifyJoinToken(SECRET, token, now + 60_000)).toEqual({ ok: false, error: "EXPIRED" });
    expect(verifyJoinToken("otro", token, now)).toEqual({ ok: false, error: "BAD_SIGNATURE" });

    const [header, body, signature] = token.split(".") as [string, string, string];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...payload, sid: "s-2" })).toString("base64url");
    expect(verifyJoinToken(SECRET, `${header}.${forged}.${signature}`, now)).toEqual({
      ok: false,
      error: "BAD_SIGNATURE",
    });
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    expect(verifyJoinToken(SECRET, `${none}.${body}.`, now)).toEqual({
      ok: false,
      error: "MALFORMED",
    });
    expect(verifyJoinToken(SECRET, `${none}.${body}.${signature}`, now)).toEqual({
      ok: false,
      error: "MALFORMED",
    });
    expect(verifyJoinToken(SECRET, "a.b", now)).toEqual({ ok: false, error: "MALFORMED" });
    expect(verifyJoinToken(SECRET, 42, now)).toEqual({ ok: false, error: "MALFORMED" });
  });

  it("sin JOIN_TOKEN_SECRET en producción el canje queda desactivado", () => {
    expect(readJoinTokenConfig({ NODE_ENV: "production" })).toBeNull();
    expect(readJoinTokenConfig({ NODE_ENV: "production", JOIN_TOKEN_SECRET: "x" })).toEqual({
      secret: "x",
      // C-1/C-2: por defecto sube al tope configurable (el mismo token sirve
      // para reconectar durante toda la partida, specs/11 §8).
      ttlSeconds: 7200,
    });
    expect(readJoinTokenConfig({ NODE_ENV: "development" })?.secret).toBe(DEV_JOIN_TOKEN_SECRET);
    expect(readJoinTokenConfig({ NODE_ENV: "test" })?.secret).toBe(DEV_JOIN_TOKEN_SECRET);
    // E-4: sin NODE_ENV=development|test tampoco hereda el secreto de dev.
    expect(readJoinTokenConfig({})).toBeNull();
    expect(readJoinTokenConfig({ NODE_ENV: "staging" })).toBeNull();
    expect(
      readJoinTokenConfig({ NODE_ENV: "development", JOIN_TOKEN_TTL_SECONDS: "999999" })
        ?.ttlSeconds,
    ).toBe(7200);
  });
});

describe("redeem — invitado sin cuenta", () => {
  it("canjea una clave individual: joinToken de la sesión asignada y la clave muere", async () => {
    const ctx = await setup();
    const code = ctx.codes[0]!;
    const result = await ctx.redeem.redeem(ANONYMOUS_ACTOR, {
      code: code.toLowerCase().replaceAll("-", ""),
      displayName: "  Ana\u0007 <b>  ",
    });

    expect(result).toMatchObject({
      eventId: ctx.event.id,
      sessionId: ctx.sessions[0]!.id,
      groupId: null,
      colyseusEndpoint: "ws://colyseus.test",
      roomName: "event",
      player: { id: "guest:invitado-1", displayName: "Ana b", guest: true },
    });
    expect(result.expiresAt.getTime()).toBe(ctx.now().getTime() + 900_000);
    // El token no lleva la clave en claro.
    expect(result.joinToken).not.toContain(code);
    expect(Buffer.from(result.joinToken.split(".")[1]!, "base64url").toString()).not.toContain(
      code,
    );
    expect(claimsOf(result.joinToken, ctx.now())).toEqual({
      playerId: "guest:invitado-1",
      displayName: "Ana b",
      eventId: ctx.event.id,
      sessionId: result.sessionId,
      groupId: null,
    });

    const key = ctx.store.keys.find((k) => k.code === code)!;
    expect(key).toMatchObject({ status: "used", redeemedCount: 1, sessionId: result.sessionId });
    await rejects(ctx.redeem.redeem(ANONYMOUS_ACTOR, { code }), "ACCESS_KEY_USED");
  });

  it("con cuenta la identidad es la del usuario; sin nombre, «Invitado»", async () => {
    const ctx = await setup();
    const result = await ctx.redeem.redeem(player, { code: ctx.codes[0]! });
    expect(result.player).toEqual({
      id: "user:jugadora",
      displayName: DEFAULT_GUEST_NAME,
      guest: false,
    });
    expect(sanitizeDisplayName("x".repeat(100))).toHaveLength(32);
  });

  it("errores de clave con los códigos de specs/13 §6.2", async () => {
    const ctx = await setup();
    await rejects(
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: "ZZZZ-ZZZZ-ZZZZ" }),
      "ACCESS_KEY_INVALID",
    );
    await rejects(ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: "nope" }), "ACCESS_KEY_INVALID");
    await rejects(ctx.redeem.redeem(ANONYMOUS_ACTOR, {}), "VALIDATION_ERROR");
    await rejects(
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[0]!, extra: 1 }),
      "VALIDATION_ERROR",
    );
    const expired = ctx.store.keys.find((k) => k.code === ctx.codes[1])!;
    expired.status = "expired";
    await rejects(ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: expired.code }), "ACCESS_KEY_EXPIRED");
    const pending = ctx.store.keys.find((k) => k.code === ctx.codes[2])!;
    pending.status = "pending_confirmation";
    await rejects(
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: pending.code }),
      "ACCESS_KEY_NOT_CONFIRMED",
    );
  });
});

describe("redeem — aforo y carreras", () => {
  it("dos canjes simultáneos de la última plaza: uno entra y el otro SESSION_FULL", async () => {
    const ctx = await setup({ sessions: 1, players: 3 });
    ctx.store.sessions[0]!.capacity = 2;
    await ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[0]! });

    const results = await Promise.allSettled([
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[1]! }),
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[2]! }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({ code: "SESSION_FULL" });
    // La clave perdedora sigue viva: no se consumió.
    expect(ctx.store.keys.filter((k) => k.status === "used")).toHaveLength(2);
  });

  it("dos canjes simultáneos de la misma clave individual: uno gana y el otro ACCESS_KEY_USED", async () => {
    const ctx = await setup();
    const code = ctx.codes[0]!;
    const results = await Promise.allSettled([
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code }),
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "ACCESS_KEY_USED" });
    expect(ctx.store.keys.find((k) => k.code === code)).toMatchObject({ redeemedCount: 1 });
  });

  it("en carrera, un reparto aleatorio que pierde la última plaza prueba otra sesión", async () => {
    const ctx = await setup({ sessions: 2, players: 4 });
    ctx.store.sessions[0]!.capacity = 1;
    ctx.store.sessions[1]!.capacity = 1;
    const results = await Promise.all(
      ctx.codes.slice(0, 2).map((code) => ctx.redeem.redeem(ANONYMOUS_ACTOR, { code })),
    );
    expect(new Set(results.map((r) => r.sessionId)).size).toBe(2);
    await rejects(ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[2]! }), "SESSION_FULL");
  });

  it("las sesiones terminadas no admiten más jugadores", async () => {
    const ctx = await setup({ sessions: 1, players: 2 });
    ctx.store.sessions[0]!.status = "ended";
    await rejects(ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[0]! }), "SESSION_FULL");
    expect(ctx.store.keys[0]).toMatchObject({ status: "active", redeemedCount: 0 });
  });

  it("un evento cerrado ya no canjea", async () => {
    const ctx = await setup();
    ctx.eventStore.rows.find((e) => e.id === ctx.event.id)!.status = "closed";
    await rejects(
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[0]! }),
      "ACCESS_KEY_EXPIRED",
    );
  });
});

describe("redeem — agrupación según groupingMode", () => {
  it("random: equilibra por tamaño entre sesiones y, dentro, entre grupos", async () => {
    const ctx = await setup({ groupingMode: "random", sessions: 3, players: 30 });
    const groupA = ctx.addGroup(ctx.sessions[0]!.id, "A");
    const groupB = ctx.addGroup(ctx.sessions[0]!.id, "B");

    const results: RedeemResult[] = [];
    for (const code of ctx.codes.slice(0, 9)) {
      results.push(await ctx.redeem.redeem(ANONYMOUS_ACTOR, { code }));
    }
    const perSession = ctx.sessions.map((s) => results.filter((r) => r.sessionId === s.id).length);
    expect(perSession).toEqual([3, 3, 3]);
    const inFirst = results.filter((r) => r.sessionId === ctx.sessions[0]!.id);
    expect(inFirst.map((r) => r.groupId).sort()).toEqual([groupA, groupA, groupB].sort());
    // El grupo viaja en el token.
    expect(claimsOf(inFirst[0]!.joinToken, ctx.now()).groupId).toBe(inFirst[0]!.groupId);
    expect(
      results.filter((r) => r.sessionId !== ctx.sessions[0]!.id).every((r) => r.groupId === null),
    ).toBe(true);
  });

  it("specific: respeta la sesión y el grupo preasignados en la clave", async () => {
    const ctx = await setup({
      groupingMode: "specific",
      sessions: 3,
      players: 30,
      keyPlan: [{ type: "individual", count: 20 }],
    });
    const target = ctx.sessions[2]!.id;
    const group = ctx.addGroup(target, "Grupo A");
    const [bySession, byGroup] = await Promise.all([
      ctx.keys.generateKeys(author, ctx.event.id, {
        type: "individual",
        count: 1,
        sessionId: target,
      }),
      ctx.keys.generateKeys(author, ctx.event.id, { type: "individual", count: 1, groupId: group }),
    ]);
    const one = await ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: bySession![0]!.code });
    expect(one.sessionId).toBe(target);
    const two = await ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: byGroup![0]!.code });
    expect(two).toMatchObject({ sessionId: target, groupId: group });
    // Lo que pida el asistente no cambia una clave preasignada.
    const three = await ctx.keys.generateKeys(author, ctx.event.id, {
      type: "individual",
      count: 1,
      sessionId: target,
    });
    const chosen = await ctx.redeem.redeem(ANONYMOUS_ACTOR, {
      code: three[0]!.code,
      sessionId: ctx.sessions[0]!.id,
    });
    expect(chosen.sessionId).toBe(target);
    // Sin preasignar, se reparte como `random` (la sesión más vacía).
    const free = await ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[0]! });
    expect(free.sessionId).toBe(ctx.sessions[0]!.id);
  });

  it("specific: si la sesión preasignada está llena, SESSION_FULL", async () => {
    const ctx = await setup({
      groupingMode: "specific",
      sessions: 2,
      players: 4,
      keyPlan: [{ type: "individual", count: 2 }],
    });
    const target = ctx.sessions[1]!.id;
    ctx.store.sessions[1]!.capacity = 1;
    const keys = await ctx.keys.generateKeys(author, ctx.event.id, {
      type: "individual",
      count: 2,
      sessionId: target,
    });
    await ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: keys[0]!.code });
    await rejects(ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: keys[1]!.code }), "SESSION_FULL");
  });

  it("free: sin sesión pide elegir (con las elegibles); con sesión entra en ella", async () => {
    const ctx = await setup({ groupingMode: "free", sessions: 2, players: 4 });
    ctx.store.sessions[0]!.capacity = 1;
    const first = await ctx.redeem.redeem(ANONYMOUS_ACTOR, {
      code: ctx.codes[0]!,
      sessionId: ctx.sessions[0]!.id,
    });
    expect(first.sessionId).toBe(ctx.sessions[0]!.id);

    const err = await rejects(
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[1]! }),
      "SESSION_REQUIRED",
    );
    // La sesión llena no se ofrece.
    expect(err.details).toEqual({
      sessions: [{ id: ctx.sessions[1]!.id, name: "Sesión 2", capacity: 2, available: 2 }],
    });
    await rejects(
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[1]!, sessionId: ctx.sessions[0]!.id }),
      "SESSION_FULL",
    );
    await rejects(
      ctx.redeem.redeem(ANONYMOUS_ACTOR, {
        code: ctx.codes[1]!,
        sessionId: "30000000-0000-4000-8000-000000000009",
      }),
      "VALIDATION_ERROR",
    );
    // Nada de lo anterior consumió la clave.
    const second = await ctx.redeem.redeem(ANONYMOUS_ACTOR, {
      code: ctx.codes[1]!,
      sessionId: ctx.sessions[1]!.id,
    });
    expect(second.sessionId).toBe(ctx.sessions[1]!.id);
  });

  it("free: el grupo elegido debe ser de la sesión; sin elegir, se equilibra", async () => {
    const ctx = await setup({ groupingMode: "free", sessions: 2, players: 10 });
    const s1 = ctx.sessions[0]!.id;
    const g1 = ctx.addGroup(s1, "Rojo");
    const g2 = ctx.addGroup(s1, "Azul");
    const foreign = ctx.addGroup(ctx.sessions[1]!.id, "Otro");
    await rejects(
      ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: ctx.codes[0]!, sessionId: s1, groupId: foreign }),
      "VALIDATION_ERROR",
    );
    const chosen = await ctx.redeem.redeem(ANONYMOUS_ACTOR, {
      code: ctx.codes[0]!,
      sessionId: s1,
      groupId: g1,
    });
    expect(chosen.groupId).toBe(g1);
    const balanced = await ctx.redeem.redeem(ANONYMOUS_ACTOR, {
      code: ctx.codes[1]!,
      sessionId: s1,
    });
    expect(balanced.groupId).toBe(g2);
  });

  it("una clave de grupo mete sus N asientos en la misma sesión y muere al agotarlos", async () => {
    const ctx = await setup({
      groupingMode: "random",
      sessions: 3,
      players: 9,
      keyPlan: [
        { type: "group", count: 1, seats: 3 },
        { type: "individual", count: 3 },
      ],
    });
    const shared = ctx.store.keys.find((k) => k.keyType === "group")!.code;
    const sessions = [];
    for (let i = 0; i < 3; i++) {
      const r = await ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: shared, displayName: `J${i}` });
      sessions.push(r.sessionId);
      expect(r.player.id).toBe(`guest:invitado-${i + 1}`);
    }
    expect(new Set(sessions).size).toBe(1);
    await rejects(ctx.redeem.redeem(ANONYMOUS_ACTOR, { code: shared }), "ACCESS_KEY_USED");
  });
});
