import { MemorySlidingWindowStore } from "@escaperoom/kit/rate-limit";
import {
  ANONYMOUS_ACTOR,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  createRedeemService,
  type Actor,
  type RedeemService,
} from "@escaperoom/shared/services";
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EVENT_ROOM_NAME } from "../src/lib/colyseus";
import {
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  withRateLimit,
  type RateLimitDeps,
} from "../src/server/rate-limit";

/**
 * Rate limiting de las rutas REST sensibles (ticket 6.3, specs/13 §11). El
 * store es la ventana deslizante EN MEMORIA de `@escaperoom/kit` (la de Redis
 * tiene sus tests con un Redis falso en el kit): CI no necesita Redis.
 *
 * El canje se prueba a través del route module real (`app/api/.../route.ts`),
 * con los servicios en memoria inyectados por `vi.mock`: así se comprueba el
 * cableado del límite, no solo el wrapper.
 */

const services = vi.hoisted(() => ({ redeem: null as RedeemService | null }));
vi.mock("@/server/services", () => ({ getRedeemService: () => services.redeem }));
vi.mock("@/server/context", () => ({ resolveActorFromRequest: async () => ANONYMOUS_ACTOR }));

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");

/** Evento activo con claves reales (stores en memoria, sin Postgres). */
async function redeemFixture(playersPlanned = 4) {
  const now = () => new Date();
  const pricing = createPricingTierService({
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
  const accessKeys = createAccessKeyService({
    store,
    events,
    dpa: { requireDpa: async () => {} },
    now,
  });
  const redeem = createRedeemService({
    store,
    accessKeys,
    joinToken: { secret: "secreto-de-test", ttlSeconds: 600 },
    colyseusEndpoint: "wss://colyseus.example",
    roomName: EVENT_ROOM_NAME,
    now,
  });
  const event = await events.createEvent(author, {
    roomVersionId: VERSION,
    title: "Jornada",
    maxSimultaneousSessions: 1,
    groupingMode: "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned,
  });
  const activation = await accessKeys.activateEvent(author, event.id);
  return { redeem, codes: activation.keys.map((k) => k.code) };
}

function redeemRequest(ip: string, code: string): Request {
  return new Request("http://localhost/api/access-keys/redeem", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ code, displayName: "Leo" }),
  });
}

type ErrorJson = { error: { code: string; retryAfter?: number } };

describe("POST /api/access-keys/redeem — fuerza bruta (route module real)", () => {
  let codes: string[] = [];
  let POST: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    const fixture = await redeemFixture();
    services.redeem = fixture.redeem;
    codes = fixture.codes;
    ({ POST } = await import("../src/app/api/access-keys/redeem/route"));
  });

  it("N códigos inventados desde la misma IP → 429 con Retry-After; otra IP no se ve afectada", async () => {
    const attacker = "203.0.113.7";
    const { limit, windowSeconds } = RATE_LIMIT_POLICIES.redeem.failures;
    for (let i = 0; i < limit; i += 1) {
      const res = await POST(redeemRequest(attacker, `ZZZZ-ZZZZ-ZZ${String(i).padStart(2, "2")}`));
      expect(res.status).toBe(404);
    }

    const blocked = await POST(redeemRequest(attacker, "ZZZZ-ZZZZ-ZZZZ"));
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(windowSeconds);
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    expect(((await blocked.json()) as ErrorJson).error).toMatchObject({
      code: "RATE_LIMITED",
      retryAfter,
    });

    // Ni con un código bueno: la IP está bloqueada hasta que caduque la ventana.
    expect((await POST(redeemRequest(attacker, codes[0]!))).status).toBe(429);

    // Un invitado legítimo desde otra IP canjea con normalidad.
    const legit = await POST(redeemRequest("198.51.100.20", codes[0]!));
    expect(legit.status).toBe(200);
  });

  it("los canjes correctos no gastan la cuota de fallos (una clase detrás del mismo NAT)", async () => {
    const school = "192.0.2.50";
    const fixture = await redeemFixture(RATE_LIMIT_POLICIES.redeem.failures.limit + 5);
    services.redeem = fixture.redeem;
    for (const code of fixture.codes) {
      expect((await POST(redeemRequest(school, code))).status).toBe(200);
    }
  });
});

describe("withRateLimit", () => {
  const ok = async () => Response.json({ ok: true });
  const deps = (over: Partial<RateLimitDeps> = {}): Partial<RateLimitDeps> => ({
    store: new MemorySlidingWindowStore(),
    resolveUserId: async () => null,
    enabled: true,
    ...over,
  });
  const req = (ip: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/x", { method: "POST", headers: { "x-real-ip": ip, ...headers } });

  it("limita por IP y deja el contrato intacto por debajo del límite", async () => {
    const handler = vi.fn(ok);
    const post = withRateLimit("review-write", handler, deps());
    const { limit } = RATE_LIMIT_POLICIES["review-write"].ip;
    for (let i = 0; i < limit; i += 1) {
      const res = await post(req("10.0.0.1"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    const limited = await post(req("10.0.0.1"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("600");
    // El 429 no toca el dominio.
    expect(handler).toHaveBeenCalledTimes(limit);
    expect((await post(req("10.0.0.2"))).status).toBe(200);
  });

  it("con sesión, limita también por usuario aunque cambie de IP", async () => {
    const post = withRateLimit("review-write", ok, deps({ resolveUserId: async () => "ana" }));
    const { limit } = RATE_LIMIT_POLICIES["review-write"].user;
    for (let i = 0; i < limit; i += 1) {
      expect((await post(req(`10.1.0.${i}`))).status).toBe(200);
    }
    expect((await post(req("10.1.0.99"))).status).toBe(429);
  });

  it("RATE_LIMIT_ENABLED=false lo apaga (pruebas de carga)", async () => {
    const post = withRateLimit("invitation-resend-pending", ok, deps({ enabled: false }));
    for (let i = 0; i < 20; i += 1) expect((await post(req("10.2.0.1"))).status).toBe(200);
  });

  it("el tRPC comparte cubo con el REST: consumeRateLimit agota el mismo contador", async () => {
    const shared = deps();
    const post = withRateLimit("review-write", ok, shared);
    const { limit } = RATE_LIMIT_POLICIES["review-write"].ip;
    for (let i = 0; i < limit; i += 1) {
      expect((await consumeRateLimit("review-write", req("10.3.0.1"), shared)).ok).toBe(true);
    }
    expect((await post(req("10.3.0.1"))).status).toBe(429);
  });

  it("free-room-play: solo cuota por IP (punto i, 'CTA Jugar' — funciona sin cuenta)", async () => {
    expect("user" in RATE_LIMIT_POLICIES["free-room-play"]).toBe(false);
    const post = withRateLimit("free-room-play", ok, deps({ resolveUserId: async () => "ana" }));
    const { limit } = RATE_LIMIT_POLICIES["free-room-play"].ip;
    for (let i = 0; i < limit; i += 1) {
      expect((await post(req("10.4.0.1"))).status).toBe(200);
    }
    const limited = await post(req("10.4.0.1"));
    expect(limited.status).toBe(429);
    // Otra IP, misma cuenta: nunca se rechaza por usuario, solo por IP.
    expect((await post(req("10.4.0.2"))).status).toBe(200);
  });
});

describe("tRPC reviews.upsert", () => {
  it("TOO_MANY_REQUESTS si el contexto dice que no cabe (sin tocar el servicio)", async () => {
    const { appRouter } = await import("../src/server/routers/_app");
    const upsertReview = vi.fn();
    const caller = appRouter.createCaller({
      actor: author,
      catalog: {} as never,
      reviews: { upsertReview } as never,
      rateLimit: async () => ({ ok: false, retryAfter: 42 }),
    });
    const error = await caller.reviews
      .upsert({ roomId: "r", rating: 5 })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    expect(upsertReview).not.toHaveBeenCalled();
  });
});
