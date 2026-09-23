import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { DEV_JOIN_TOKEN_SECRET, signJoinToken } from "@escaperoom/shared/join-token";
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
  type DpaGate,
} from "@escaperoom/shared/services";
import { EVENT_ROOM_NAME, GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { EventRoom, JOIN_TOKEN_ERRORS } from "../src/rooms/event-room";
import { GameRoom } from "../src/rooms/game-room";
import type { GameRoomState } from "../src/schema/game-state";
import { defineEventRoom } from "../src/server";
import { getFreePort } from "./helpers/free-port";

/** DPA de la organización en regla: la puerta de 5.11 se prueba en `organizations.test.ts`. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };

/**
 * Room de evento (ticket 5.8) sobre Colyseus real (puerto libre del SO): un
 * invitado canjea con el servicio de `shared` (stores en memoria) y entra con
 * su `joinToken`; sin token válido, caducado, manipulado o de otra sesión, la
 * room lo rechaza. La `GameRoom` del fixture se registra al lado para
 * comprobar que no cambia.
 */

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
    defineEventRoom(server);
  },
});

beforeAll(async () => {
  colyseus = await boot(config, await getFreePort());
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const VERSION = "10000000-0000-4000-8000-000000000001";

/** Evento activo de la autora con 2 sesiones y claves individuales; canje con el secreto de dev. */
async function eventWithKeys() {
  const T0 = new Date("2026-01-01T00:00:00Z");
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
  });
  const store = createInMemoryAccessKeyStore({ events: eventStore });
  const accessKeys = createAccessKeyService({ store, events, dpa: DPA_SIGNED });
  const redeem = createRedeemService({
    store,
    accessKeys,
    joinToken: { secret: DEV_JOIN_TOKEN_SECRET, ttlSeconds: 900 },
    colyseusEndpoint: "ws://localhost",
    roomName: EVENT_ROOM_NAME,
  });
  const event = await events.createEvent(author, {
    roomVersionId: VERSION,
    title: "Jornada",
    maxSimultaneousSessions: 2,
    groupingMode: "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: 8,
  });
  const activation = await accessKeys.activateEvent(author, event.id);
  return {
    redeem,
    event,
    sessions: activation.sessions,
    codes: activation.keys.map((k) => k.code),
  };
}

function joinEvent(options: { sessionId?: string; joinToken?: string }) {
  return colyseus.sdk.joinOrCreate<GameRoomState>(EVENT_ROOM_NAME, options);
}

/** Token firmado a mano (caducidad y sesión a elección del test). */
function tokenFor(sessionId: string, opts: { expiresAt?: number; secret?: string } = {}) {
  const now = Date.now();
  return signJoinToken(
    opts.secret ?? DEV_JOIN_TOKEN_SECRET,
    { playerId: "guest:x", displayName: "Eva", eventId: "e", sessionId, groupId: null },
    { now, expiresAt: opts.expiresAt ?? now + 60_000 },
  );
}

async function joinError(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return (err as Error).message;
}

describe("room de evento con joinToken", () => {
  it("un invitado sin cuenta canjea una clave individual y entra en la sesión asignada", async () => {
    const { redeem, sessions, codes } = await eventWithKeys();
    const ticket = await redeem.redeem(ANONYMOUS_ACTOR, { code: codes[0]!, displayName: "Ana" });
    expect(ticket.sessionId).toBe(sessions[0]!.id);
    expect(ticket.player.guest).toBe(true);

    const client = await joinEvent({ sessionId: ticket.sessionId, joinToken: ticket.joinToken });
    await client.waitForInitialState();
    const room = colyseus.getRoomById<EventRoom>(client.roomId);
    expect(room.roomName).toBe(EVENT_ROOM_NAME);
    expect(room.metadata).toEqual({ sessionId: ticket.sessionId, eventId: ticket.eventId });
    expect(client.state.roomPackageId).toBe("room-rey-aldric");
    await expect.poll(() => client.state.players.get(client.sessionId)?.name).toBe("Ana");

    // Juega con el mismo protocolo que la GameRoom.
    const intro = client.waitForMessage(GAME_MESSAGES.dialogShow);
    client.send(GAME_MESSAGES.startGame, {});
    expect(await intro).toEqual({ dialogId: "d-intro" });

    // La clave ya no sirve.
    await expect(redeem.redeem(ANONYMOUS_ACTOR, { code: codes[0]! })).rejects.toMatchObject({
      code: "ACCESS_KEY_USED",
    });

    // Otro invitado de la misma sesión entra en la MISMA room; uno de otra sesión, en otra.
    const second = await redeem.redeem(ANONYMOUS_ACTOR, { code: codes[1]! });
    const third = await redeem.redeem(ANONYMOUS_ACTOR, { code: codes[2]! });
    expect(second.sessionId).toBe(sessions[1]!.id);
    expect(third.sessionId).toBe(sessions[0]!.id);
    const mate = await joinEvent({ sessionId: third.sessionId, joinToken: third.joinToken });
    expect(mate.roomId).toBe(client.roomId);
    const apart = await joinEvent({ sessionId: second.sessionId, joinToken: second.joinToken });
    expect(apart.roomId).not.toBe(client.roomId);
  });

  it("rechaza unirse sin token, con token caducado, manipulado, de otro secreto o de otra sesión", async () => {
    const sessionId = "30000000-0000-4000-8000-000000000001";
    const other = "30000000-0000-4000-8000-000000000002";

    expect(await joinError(joinEvent({ sessionId }))).toContain(JOIN_TOKEN_ERRORS.missing);
    expect(
      await joinError(
        joinEvent({ sessionId, joinToken: tokenFor(sessionId, { expiresAt: Date.now() - 1 }) }),
      ),
    ).toContain(JOIN_TOKEN_ERRORS.expired);
    expect(
      await joinError(joinEvent({ sessionId, joinToken: tokenFor(sessionId, { secret: "otro" }) })),
    ).toContain(JOIN_TOKEN_ERRORS.invalid);

    const [header, body, signature] = tokenFor(sessionId).split(".") as [string, string, string];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...payload, name: "Admin" })).toString("base64url");
    expect(
      await joinError(joinEvent({ sessionId, joinToken: `${header}.${forged}.${signature}` })),
    ).toContain(JOIN_TOKEN_ERRORS.invalid);

    // Token válido, pero para otra sesión.
    expect(await joinError(joinEvent({ sessionId, joinToken: tokenFor(other) }))).toContain(
      JOIN_TOKEN_ERRORS.wrongSession,
    );

    // Con la room ya creada, un token de otra sesión tampoco entra por id.
    const host = await joinEvent({ sessionId, joinToken: tokenFor(sessionId) });
    expect(
      await joinError(
        colyseus.sdk.joinById(host.roomId, { sessionId: other, joinToken: tokenFor(other) }),
      ),
    ).toContain(JOIN_TOKEN_ERRORS.wrongSession);
    expect(
      await joinError(colyseus.sdk.joinById(host.roomId, { sessionId, joinToken: "a.b.c" })),
    ).toContain(JOIN_TOKEN_ERRORS.invalid);
  });

  it("la GameRoom del fixture sigue entrando sin joinToken", async () => {
    const client = await colyseus.sdk.joinOrCreate<GameRoomState>(GAME_ROOM_NAME, { name: "Rey" });
    await client.waitForInitialState();
    expect(client.state.roomPackageId).toBe("room-rey-aldric");
  });
});
