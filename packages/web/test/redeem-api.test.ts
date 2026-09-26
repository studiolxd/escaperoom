import { EVENT_ROOM_NAME as SERVER_EVENT_ROOM_NAME } from "@escaperoom/colyseus-server";
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
  verifyJoinToken,
  type Actor,
  type DpaGate,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { EVENT_ROOM_NAME } from "../src/lib/colyseus";
import { createRedeemHandler } from "../src/server/rest/access-keys";

/** DPA de la organización en regla: la puerta de 5.11 se prueba en `organizations.test.ts`. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-06-01T10:00:00Z");
const SECRET = "secreto-de-test";

type RedeemJson = {
  eventId: string;
  sessionId: string;
  groupId: string | null;
  colyseusEndpoint: string;
  roomName: string;
  joinToken: string;
  expiresAt: string;
  player: { id: string; displayName: string; guest: boolean };
};
type ErrorJson = {
  error: { code: string; issues?: Array<{ path: string }>; sessions?: unknown[] };
};

/** Handler REST del canje con stores en memoria (sin Postgres ni Colyseus). */
async function setup(groupingMode: "random" | "free" = "random") {
  const now = () => NOW;
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
  const accessKeys = createAccessKeyService({ store, events, dpa: DPA_SIGNED, now });
  const redeem = createRedeemService({
    store,
    accessKeys,
    joinToken: { secret: SECRET, ttlSeconds: 600 },
    colyseusEndpoint: "wss://colyseus.example",
    roomName: EVENT_ROOM_NAME,
    now,
  });
  const event = await events.createEvent(author, {
    roomVersionId: VERSION,
    title: "Jornada",
    maxSimultaneousSessions: 2,
    groupingMode,
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: 4,
  });
  const activation = await accessKeys.activateEvent(author, event.id);
  const post = createRedeemHandler({ redeem, resolveActor: async () => ANONYMOUS_ACTOR });
  const call = (body: unknown, raw?: string) =>
    post(
      new Request("http://localhost/api/access-keys/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw ?? JSON.stringify(body),
      }),
    );
  return { call, store, sessions: activation.sessions, codes: activation.keys.map((k) => k.code) };
}

describe("POST /api/access-keys/redeem", () => {
  it("200 para un invitado sin cuenta: sesión, endpoint, room y joinToken (sin la clave)", async () => {
    const t = await setup();
    const code = t.codes[0]!;
    const res = await t.call({ code, displayName: "Leo" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as RedeemJson;
    expect(body).toMatchObject({
      sessionId: t.sessions[0]!.id,
      groupId: null,
      colyseusEndpoint: "wss://colyseus.example",
      roomName: "event",
      // Ticket duración-salas (PR #169): sin override de evento ni duración
      // propia de la sala, el TTL sale del default retrocompatible (60 min +
      // 30 min de margen = 90 min), no del `ttlSeconds` de 600 s de `setup()`.
      expiresAt: "2026-06-01T11:30:00.000Z",
      player: { displayName: "Leo", guest: true },
    });
    expect(body.player.id).toMatch(/^guest:/u);
    expect(JSON.stringify(body)).not.toContain(code);
    const verified = verifyJoinToken(SECRET, body.joinToken, NOW.getTime());
    expect(verified).toMatchObject({ ok: true, claims: { sessionId: body.sessionId } });

    const again = await t.call({ code });
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe("ACCESS_KEY_USED");
  });

  it("409 SESSION_FULL cuando ninguna sesión admite más jugadores", async () => {
    const t = await setup();
    for (const s of t.store.sessions) s.capacity = 1;
    expect((await t.call({ code: t.codes[0]! })).status).toBe(200);
    expect((await t.call({ code: t.codes[1]! })).status).toBe(200);
    const res = await t.call({ code: t.codes[2]! });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorJson).error.code).toBe("SESSION_FULL");
  });

  it("422 SESSION_REQUIRED en agrupación libre, con las sesiones elegibles", async () => {
    const t = await setup("free");
    const res = await t.call({ code: t.codes[0]! });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe("SESSION_REQUIRED");
    expect(body.error.sessions).toEqual([
      { id: t.sessions[0]!.id, name: "Sesión 1", capacity: 2, available: 2 },
      { id: t.sessions[1]!.id, name: "Sesión 2", capacity: 2, available: 2 },
    ]);
    const chosen = await t.call({ code: t.codes[0]!, sessionId: t.sessions[1]!.id });
    expect(((await chosen.json()) as RedeemJson).sessionId).toBe(t.sessions[1]!.id);
  });

  it("404 clave inválida, 422 cuerpo no válido y 400 JSON roto", async () => {
    const t = await setup();
    const invalid = await t.call({ code: "ZZZZ-ZZZZ-ZZZZ" });
    expect(invalid.status).toBe(404);
    expect(((await invalid.json()) as ErrorJson).error.code).toBe("ACCESS_KEY_INVALID");
    expect((await t.call({})).status).toBe(422);
    expect((await t.call(undefined, "{no")).status).toBe(400);
  });

  it("503 si el canje está desactivado (sin JOIN_TOKEN_SECRET en producción)", async () => {
    const post = createRedeemHandler({ redeem: null, resolveActor: async () => ANONYMOUS_ACTOR });
    const res = await post(
      new Request("http://localhost/api/access-keys/redeem", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorJson).error.code).toBe("REDEEM_UNAVAILABLE");
  });

  it("el nombre de la room de evento coincide con el del servidor Colyseus", () => {
    expect(EVENT_ROOM_NAME).toBe(SERVER_EVENT_ROOM_NAME);
  });
});
