import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ACCESS_KEY_ALPHABET,
  ACCESS_KEY_CODE_RE,
  AccessKeyError,
  ANONYMOUS_ACTOR,
  applyRedemption,
  checkRedeemable,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  expireAccessKeys,
  generateAccessKeyCode,
  normalizeAccessKeyCode,
  type Actor,
  type PricingTierRow,
  type RandomBytes,
} from "../src/services";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const organizer: Actor = { userId: "profe", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const T0 = new Date("2026-01-01T00:00:00Z");
const VERSION = "10000000-0000-4000-8000-000000000001";
const HOUR = 3_600_000;

/** Bytes deterministas por semilla (SHA-256): semillas iguales → mismo código. */
const bytesFor = (seed: number) => (n: number) =>
  Uint8Array.from(createHash("sha256").update(String(seed)).digest().subarray(0, n));

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

function setup(opts: { random?: RandomBytes } = {}) {
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
  const keys = createAccessKeyService({ store, events, now, random: opts.random });

  /** Evento de la autora (autoventa: activable sin pago). */
  async function createEvent(over: Record<string, unknown> = {}) {
    return events.createEvent(author, {
      roomVersionId: VERSION,
      title: "Jornada",
      maxSimultaneousSessions: 3,
      groupingMode: "random",
      requireConfirmation: false,
      expiryRules: [],
      playersPlanned: 30,
      ...over,
    });
  }

  return {
    keys,
    events,
    store,
    createEvent,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
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

describe("códigos de clave", () => {
  it("formato XXXX-XXXX-XXXX solo con el alfabeto sin ambiguos (sin 0/O/1/I/L)", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateAccessKeyCode();
      expect(code).toMatch(ACCESS_KEY_CODE_RE);
      expect(code).not.toMatch(/[01OIL]/);
    }
    expect(ACCESS_KEY_ALPHABET).toHaveLength(31);
    // ≈ 59 bits de entropía.
    expect(12 * Math.log2(ACCESS_KEY_ALPHABET.length)).toBeGreaterThan(59);
  });

  it("normaliza lo que teclea una persona y rechaza lo que no puede ser una clave", () => {
    expect(normalizeAccessKeyCode(" abcd efgh-jkmn ")).toBe("ABCD-EFGH-JKMN");
    expect(normalizeAccessKeyCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
    expect(normalizeAccessKeyCode("ABCD-EFGH-JKM0")).toBeNull();
    expect(normalizeAccessKeyCode("ABCD-EFGH")).toBeNull();
  });

  it("muestreo sin sesgo: descarta los bytes ≥ 248", () => {
    // 255 se descarta; 0 → '2', 30 → 'Z'.
    const bytes = [255, 0, 30, ...Array.from({ length: 30 }, () => 1)];
    let i = 0;
    const random: RandomBytes = (n) =>
      Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]!);
    expect(generateAccessKeyCode(random).startsWith("2Z33")).toBe(true);
  });
});

describe("generación al activar (specs/02 §4, specs/13 §6.1)", () => {
  it("sin plan: crea las sesiones y playersPurchased claves individuales activas", async () => {
    const { keys, createEvent, store } = setup();
    const event = await createEvent();
    const result = await keys.activateEvent(author, event.id);

    expect(result.event.status).toBe("active");
    expect(result.sessions.map((s) => [s.name, s.capacity])).toEqual([
      ["Sesión 1", 10],
      ["Sesión 2", 10],
      ["Sesión 3", 10],
    ]);
    expect(result.keys).toHaveLength(30);
    expect(result.keys.every((k) => k.keyType === "individual" && k.status === "active")).toBe(
      true,
    );
    expect(result.keys.every((k) => k.singleUse && k.seats === 1 && k.activatedAt)).toBe(true);
    expect(new Set(store.keys.map((k) => k.code)).size).toBe(30);
  });

  it("con plan: mezcla tipos dentro de lo comprado", async () => {
    const { keys, createEvent } = setup();
    const event = await createEvent();
    const { keys: generated } = await keys.activateEvent(author, event.id, {
      keyPlan: [
        { type: "individual", count: 10 },
        { type: "group", count: 2, seats: 5 },
        { type: "rotating", count: 1, seats: 6 },
      ],
    });
    expect(generated.map((k) => [k.keyType, k.seats, k.singleUse])).toEqual([
      ...Array.from({ length: 10 }, () => ["individual", 1, true]),
      ["group", 5, false],
      ["group", 5, false],
      ["rotating", 6, false],
    ]);
    const page = await keys.listKeys(author, event.id);
    expect(page.seats).toEqual({ purchased: 30, committed: 26, available: 4 });
  });

  it("un plan que excede lo comprado se rechaza ANTES de activar", async () => {
    const { keys, createEvent, events } = setup();
    const event = await createEvent();
    await rejects(
      keys.activateEvent(author, event.id, { keyPlan: [{ type: "group", count: 4, seats: 8 }] }),
      "SEAT_LIMIT_EXCEEDED",
    );
    const after = await events.getEvent(author, event.id);
    expect(after.status).toBe("draft");
  });

  it("con confirmación obligatoria las claves nacen `generated` (5.6 las confirma)", async () => {
    const { keys, createEvent } = setup();
    const event = await createEvent({ requireConfirmation: true });
    const { keys: generated } = await keys.activateEvent(author, event.id);
    expect(generated.every((k) => k.status === "generated" && k.requireConfirmation)).toBe(true);
    expect(checkRedeemable(generated[0]!, new Date())).toEqual({
      ok: false,
      code: "ACCESS_KEY_NOT_CONFIRMED",
    });
  });

  it("hours_after_start se sella en expiresAt al generar", async () => {
    const { keys, createEvent } = setup();
    const event = await createEvent({
      expiryRules: [{ type: "hours_after_start", startsAt: "2026-06-02T09:00:00Z", hours: 4 }],
    });
    const { keys: generated } = await keys.activateEvent(author, event.id);
    expect(generated[0]!.expiresAt?.toISOString()).toBe("2026-06-02T13:00:00.000Z");
  });

  it("no se activa un evento cuya jornada ya caducó", async () => {
    const { keys, createEvent } = setup();
    const event = await createEvent({
      expiryRules: [{ type: "hours_after_start", startsAt: "2026-05-01T09:00:00Z", hours: 4 }],
    });
    await rejects(keys.activateEvent(author, event.id), "EVENT_EXPIRED");
  });

  it("un evento ajeno sin pagar no se activa (PAYMENT_REQUIRED de 5.4) ni genera claves", async () => {
    const { keys, events, store } = setup();
    const event = await events.createEvent(organizer, {
      roomVersionId: VERSION,
      title: "Ajeno",
      maxSimultaneousSessions: 1,
      groupingMode: "free",
      requireConfirmation: false,
      expiryRules: [],
      playersPlanned: 5,
    });
    const err = await keys.activateEvent(organizer, event.id).then(
      () => null,
      (e: unknown) => e as { code: string },
    );
    expect(err?.code).toBe("PAYMENT_REQUIRED");
    expect(store.keys).toHaveLength(0);
    expect(store.sessions).toHaveLength(0);
  });
});

describe("generación a demanda y límite de playersPurchased", () => {
  async function activeEvent(over: Record<string, unknown> = {}) {
    const ctx = setup();
    const event = await ctx.createEvent(over);
    const activation = await ctx.keys.activateEvent(author, event.id, {
      keyPlan: [{ type: "individual", count: 10 }],
    });
    return { ...ctx, event, activation };
  }

  it("batch genera N claves únicas, una por email", async () => {
    const { keys, event } = await activeEvent();
    const emails = Array.from({ length: 20 }, (_, i) => `alumno${i}@ies.test`);
    const batch = await keys.generateKeys(author, event.id, { type: "batch", emails });
    expect(batch).toHaveLength(20);
    expect(new Set(batch.map((k) => k.code)).size).toBe(20);
    expect(batch.map((k) => k.email)).toEqual(emails);
    expect(batch.every((k) => k.keyType === "batch" && k.singleUse)).toBe(true);
  });

  it("batch sin colisiones aunque el generador repita códigos", async () => {
    // Generador degenerado: los primeros códigos se repiten → el servicio los descarta.
    let calls = 0;
    const random: RandomBytes = (n) => bytesFor(++calls <= 6 ? 7 : calls)(n);
    const ctx = setup({ random });
    const event = await ctx.createEvent({ playersPlanned: 50 });
    const { keys: generated } = await ctx.keys.activateEvent(author, event.id, {
      keyPlan: [{ type: "batch", count: 50 }],
    });
    expect(new Set(generated.map((k) => k.code)).size).toBe(50);
  });

  it("no reutiliza un código que ya existe en otro evento", async () => {
    const taken = generateAccessKeyCode(bytesFor(7));
    let calls = 0;
    const ctx = setup({ random: (n) => bytesFor(++calls === 1 ? 7 : calls)(n) });
    const event = await ctx.createEvent();
    ctx.store.keys.push({ ...structuredClone(ctx.store.keys[0] ?? ({} as never)), code: taken });
    const { keys: generated } = await ctx.keys.activateEvent(author, event.id, {
      keyPlan: [{ type: "individual", count: 1 }],
    });
    expect(generated[0]!.code).not.toBe(taken);
    expect(calls).toBeGreaterThan(1);
  });

  it("no se pueden generar más asientos que playersPurchased", async () => {
    const { keys, event } = await activeEvent();
    await keys.generateKeys(author, event.id, { type: "individual", count: 15 });
    const err = await rejects(
      keys.generateKeys(author, event.id, { type: "group", count: 1, seats: 6 }),
      "SEAT_LIMIT_EXCEEDED",
    );
    expect(err.message).toContain("quedan 5 de 30");
    await keys.generateKeys(author, event.id, { type: "group", count: 1, seats: 5 });
    await rejects(
      keys.generateKeys(author, event.id, { type: "individual", count: 1 }),
      "SEAT_LIMIT_EXCEEDED",
    );
  });

  it("validación del cuerpo: seats obligatorio en group/rotating, 1 en individual/batch", async () => {
    const { keys, event } = await activeEvent();
    await rejects(
      keys.generateKeys(author, event.id, { type: "group", count: 1 }),
      "VALIDATION_ERROR",
    );
    await rejects(
      keys.generateKeys(author, event.id, { type: "individual", count: 1, seats: 3 }),
      "VALIDATION_ERROR",
    );
    await rejects(
      keys.generateKeys(author, event.id, { type: "batch", count: 2, emails: ["a@b.test"] }),
      "VALIDATION_ERROR",
    );
    await rejects(keys.generateKeys(author, event.id, { type: "individual" }), "VALIDATION_ERROR");
  });

  it("preasignar sesión solo en agrupación específica y con sesiones del evento", async () => {
    const random = await activeEvent();
    const sessionId = random.activation.sessions[0]!.id;
    await rejects(
      random.keys.generateKeys(author, random.event.id, {
        type: "individual",
        count: 1,
        sessionId,
      }),
      "VALIDATION_ERROR",
    );

    const specific = await activeEvent({ groupingMode: "specific" });
    const sid = specific.activation.sessions[1]!.id;
    const [key] = await specific.keys.generateKeys(author, specific.event.id, {
      type: "individual",
      count: 1,
      sessionId: sid,
    });
    expect(key!.sessionId).toBe(sid);
    await rejects(
      specific.keys.generateKeys(author, specific.event.id, {
        type: "individual",
        count: 1,
        sessionId,
      }),
      "VALIDATION_ERROR",
    );
  });

  it("un evento en borrador no genera claves a demanda", async () => {
    const { keys, createEvent } = setup();
    const event = await createEvent();
    await rejects(
      keys.generateKeys(author, event.id, { type: "individual", count: 1 }),
      "EVENT_NOT_ACTIVE",
    );
  });
});

describe("estados y canje (función de estado para 5.8)", () => {
  async function withKeys(keyPlan: unknown[], over: Record<string, unknown> = {}) {
    const ctx = setup();
    const event = await ctx.createEvent(over);
    const { keys: generated } = await ctx.keys.activateEvent(author, event.id, { keyPlan });
    return { ...ctx, event, generated };
  }

  it("una clave individual muere al canjearse", async () => {
    const { keys, generated } = await withKeys([{ type: "individual", count: 1 }]);
    const code = generated[0]!.code;
    const used = await keys.consumeSeat(code.toLowerCase().replaceAll("-", " "));
    expect(used).toMatchObject({ status: "used", redeemedCount: 1 });
    expect(used.usedAt).not.toBeNull();
    await rejects(keys.consumeSeat(code), "ACCESS_KEY_USED");
  });

  it("una clave de grupo admite N canjes y muere al agotarlos", async () => {
    const { keys, generated } = await withKeys([{ type: "group", count: 1, seats: 3 }]);
    const code = generated[0]!.code;
    expect((await keys.consumeSeat(code)).status).toBe("active");
    expect((await keys.consumeSeat(code)).status).toBe("active");
    expect(await keys.consumeSeat(code)).toMatchObject({ status: "used", redeemedCount: 3 });
    await rejects(keys.consumeSeat(code), "ACCESS_KEY_USED");
  });

  it("códigos inexistentes o caducados por fecha no se canjean", async () => {
    const { keys, generated, advance } = await withKeys([{ type: "individual", count: 1 }], {
      expiryRules: [{ type: "hours_after_start", startsAt: "2026-06-01T12:00:00Z", hours: 2 }],
    });
    await rejects(keys.consumeSeat("ZZZZ-ZZZZ-ZZZZ"), "ACCESS_KEY_INVALID");
    await rejects(keys.consumeSeat("no-es-clave"), "ACCESS_KEY_INVALID");
    advance(5 * HOUR);
    await rejects(keys.consumeSeat(generated[0]!.code), "ACCESS_KEY_EXPIRED");
  });

  it("applyRedemption es pura: la clave de un asiento pasa a used, la compartida sigue active", () => {
    const at = new Date("2026-06-01T10:00:00Z");
    const base = {
      code: "ABCD-EFGH-JKMN",
      eventId: "e",
      sessionId: null,
      groupId: null,
      email: null,
      keyType: "individual" as const,
      status: "confirmed" as const,
      singleUse: true,
      requireConfirmation: true,
      regeneratedFrom: null,
      seats: 1,
      redeemedCount: 0,
      sentAt: null,
      confirmedAt: at,
      activatedAt: null,
      usedAt: null,
      expiresAt: null,
      createdAt: at,
    };
    expect(checkRedeemable(base, at)).toEqual({ ok: true });
    expect(applyRedemption(base, at)).toMatchObject({
      status: "used",
      usedAt: at,
      activatedAt: at,
    });
    const shared = { ...base, keyType: "group" as const, singleUse: false, seats: 4 };
    expect(applyRedemption(shared, at)).toMatchObject({ status: "active", redeemedCount: 1 });
  });
});

describe("rotación con regeneratedFrom", () => {
  async function rotatingEvent() {
    const ctx = setup();
    const event = await ctx.createEvent({ groupingMode: "specific" });
    const { keys: generated, sessions } = await ctx.keys.activateEvent(author, event.id, {
      keyPlan: [
        { type: "rotating", count: 1, seats: 6 },
        { type: "individual", count: 1 },
      ],
    });
    return { ...ctx, event, sessions, rotating: generated[0]!, individual: generated[1]! };
  }

  it("una rotativa se usa según su regla y al rotar la vieja muere y la nueva hereda", async () => {
    const { keys, rotating, event } = await rotatingEvent();
    await keys.consumeSeat(rotating.code);
    await keys.consumeSeat(rotating.code);

    const fresh = await keys.regenerateKey(author, rotating.code);
    expect(fresh.code).not.toBe(rotating.code);
    expect(fresh).toMatchObject({
      regeneratedFrom: rotating.code,
      keyType: "rotating",
      eventId: event.id,
      status: "active",
      seats: 4,
      redeemedCount: 0,
    });
    // La vieja queda inválida y se queda con los asientos consumidos.
    await rejects(keys.consumeSeat(rotating.code), "ACCESS_KEY_EXPIRED");
    const page = await keys.listKeys(author, event.id);
    const old = page.items.find((k) => k.code === rotating.code)!;
    expect(old).toMatchObject({ status: "expired", seats: 2, redeemedCount: 2 });
    // Rotar no crea ni destruye asientos: 6 (rotativa) + 1 (individual).
    expect(page.seats.committed).toBe(7);
    // La nueva se canjea con normalidad y se puede volver a rotar.
    expect((await keys.consumeSeat(fresh.code)).status).toBe("active");
    const third = await keys.regenerateKey(author, fresh.code);
    expect(third).toMatchObject({ regeneratedFrom: fresh.code, seats: 3 });
  });

  it("la nueva hereda la asignación (sesión, grupo, email, caducidad)", async () => {
    const { keys, store, event, sessions } = await rotatingEvent();
    const [key] = await keys.generateKeys(author, event.id, {
      type: "rotating",
      emails: ["tutor@ies.test"],
      seats: 3,
      sessionId: sessions[2]!.id,
    });
    const fresh = await keys.regenerateKey(author, key!.code);
    expect(fresh).toMatchObject({
      sessionId: sessions[2]!.id,
      email: "tutor@ies.test",
      expiresAt: key!.expiresAt,
      seats: 3,
    });
    expect(store.keys.find((k) => k.code === key!.code)?.status).toBe("expired");
  });

  it("solo se regeneran rotativas vivas, y solo el organizador", async () => {
    const { keys, rotating, individual } = await rotatingEvent();
    await rejects(keys.regenerateKey(author, individual.code), "ACCESS_KEY_NOT_ROTATING");
    await rejects(keys.regenerateKey(other, rotating.code), "FORBIDDEN");
    await rejects(keys.regenerateKey(ANONYMOUS_ACTOR, rotating.code), "UNAUTHORIZED");
    await keys.regenerateKey(author, rotating.code);
    await rejects(keys.regenerateKey(author, rotating.code), "ACCESS_KEY_EXPIRED");
    await rejects(keys.regenerateKey(author, "ZZZZ-ZZZZ-ZZZZ"), "NOT_FOUND");
  });

  it("un código ya enviado por email vuelve a `generated` al rotar", async () => {
    const { keys, store, rotating } = await rotatingEvent();
    store.keys.find((k) => k.code === rotating.code)!.status = "sent";
    const fresh = await keys.regenerateKey(author, rotating.code);
    expect(fresh.status).toBe("generated");
  });
});

describe("job de caducidad según expiryRules (specs/02 §4.3)", () => {
  async function scenario(expiryRules: unknown[]) {
    const ctx = setup();
    const event = await ctx.createEvent({ groupingMode: "specific", expiryRules });
    const { sessions } = await ctx.keys.activateEvent(author, event.id, {
      keyPlan: [{ type: "individual", count: 1 }],
    });
    const groupId = "30000000-0000-4000-8000-000000000001";
    ctx.store.groups.push({
      id: groupId,
      sessionId: sessions[0]!.id,
      eventId: event.id,
      name: "Grupo A",
      completedAt: null,
    });
    const [inGroup] = await ctx.keys.generateKeys(author, event.id, {
      type: "group",
      count: 1,
      seats: 4,
      groupId,
    });
    const [inSession] = await ctx.keys.generateKeys(author, event.id, {
      type: "individual",
      count: 1,
      sessionId: sessions[0]!.id,
    });
    const [elsewhere] = await ctx.keys.generateKeys(author, event.id, {
      type: "individual",
      count: 1,
      sessionId: sessions[1]!.id,
    });
    const status = (code: string) => ctx.store.keys.find((k) => k.code === code)!.status;
    return {
      ...ctx,
      sessions,
      groupId,
      inGroup: inGroup!,
      inSession: inSession!,
      elsewhere: elsewhere!,
      status,
    };
  }

  it("hours_after_start: caduca todas las claves vivas al pasar la hora", async () => {
    const ctx = await scenario([
      { type: "hours_after_start", startsAt: "2026-06-01T12:00:00Z", hours: 3 },
    ]);
    await ctx.keys.consumeSeat(ctx.inSession.code);

    expect(await ctx.keys.expireKeys()).toEqual({
      hoursAfterStart: 0,
      onSessionEnd: 0,
      onGroupComplete: 0,
    });
    ctx.advance(5 * 3_600_000);
    const sweep = await ctx.keys.expireKeys();
    // 4 claves vivas (la canjeada ya está muerta como `used`).
    expect(sweep.hoursAfterStart).toBe(3);
    expect(ctx.status(ctx.inSession.code)).toBe("used");
    expect(ctx.status(ctx.elsewhere.code)).toBe("expired");
  });

  it("on_session_end: solo mueren las claves de la sesión terminada", async () => {
    const ctx = await scenario([{ type: "on_session_end" }]);
    ctx.store.sessions.find((s) => s.id === ctx.sessions[0]!.id)!.status = "ended";

    const sweep = await expireAccessKeys(ctx.store, new Date());
    expect(sweep.onSessionEnd).toBe(2); // la de grupo y la individual de la sesión 1
    expect(ctx.status(ctx.inSession.code)).toBe("expired");
    expect(ctx.status(ctx.inGroup.code)).toBe("expired");
    expect(ctx.status(ctx.elsewhere.code)).toBe("active");
    // Idempotente.
    expect((await expireAccessKeys(ctx.store, new Date())).onSessionEnd).toBe(0);
  });

  it("on_group_complete: mueren las claves no usadas del grupo que superó la sala", async () => {
    const ctx = await scenario([{ type: "on_group_complete" }]);
    await ctx.keys.consumeSeat(ctx.inGroup.code);
    ctx.store.groups[0]!.completedAt = new Date();

    const sweep = await ctx.keys.expireKeys();
    expect(sweep.onGroupComplete).toBe(1);
    expect(ctx.status(ctx.inGroup.code)).toBe("expired");
    expect(ctx.status(ctx.inSession.code)).toBe("active");
  });

  it("sin la regla en el evento, terminar la sesión o el grupo no caduca nada", async () => {
    const ctx = await scenario([]);
    ctx.store.sessions.forEach((s) => (s.status = "ended"));
    ctx.store.groups[0]!.completedAt = new Date();
    expect(await ctx.keys.expireKeys()).toEqual({
      hoursAfterStart: 0,
      onSessionEnd: 0,
      onGroupComplete: 0,
    });
  });
});

describe("permisos: solo el organizador", () => {
  it("activar, generar, listar y regenerar exigen sesión y ser el organizador", async () => {
    const { keys, createEvent } = setup();
    const event = await createEvent();
    await rejects(keys.activateEvent(ANONYMOUS_ACTOR, event.id), "UNAUTHORIZED");
    await rejects(keys.activateEvent(other, event.id), "FORBIDDEN");
    await keys.activateEvent(author, event.id, { keyPlan: [{ type: "individual", count: 1 }] });

    const gen = { type: "individual", count: 1 };
    await rejects(keys.generateKeys(ANONYMOUS_ACTOR, event.id, gen), "UNAUTHORIZED");
    await rejects(keys.generateKeys(other, event.id, gen), "FORBIDDEN");
    await rejects(keys.listKeys(other, event.id), "FORBIDDEN");
    await rejects(keys.listKeys(author, "no-es-uuid"), "NOT_FOUND");
  });
});

describe("listado paginado", () => {
  it("pagina por cursor (createdAt, code) y filtra por estado", async () => {
    const { keys, createEvent } = setup();
    const event = await createEvent();
    await keys.activateEvent(author, event.id, { keyPlan: [{ type: "individual", count: 25 }] });
    const first = await keys.listKeys(author, event.id, { limit: "10" });
    expect(first.items).toHaveLength(10);
    const second = await keys.listKeys(author, event.id, { limit: 10, cursor: first.nextCursor });
    const third = await keys.listKeys(author, event.id, { limit: 10, cursor: second.nextCursor });
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items].map((k) => k.code);
    expect(new Set(all).size).toBe(25);

    await keys.consumeSeat(all[0]!);
    const used = await keys.listKeys(author, event.id, { status: "used" });
    expect(used.items.map((k) => k.code)).toEqual([all[0]]);
    await rejects(keys.listKeys(author, event.id, { cursor: "basura" }), "VALIDATION_ERROR");
  });
});
