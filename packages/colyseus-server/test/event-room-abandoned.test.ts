import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { DEV_JOIN_TOKEN_SECRET } from "@escaperoom/shared/join-token";
import {
  ANONYMOUS_ACTOR,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryEventRuntimeStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  createRedeemService,
  type Actor,
  type DpaGate,
} from "@escaperoom/shared/services";
import { EVENT_ROOM_NAME, GAME_MESSAGES } from "../src/constants";
import { configureEventRuntime } from "../src/events/runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { EventRoom } from "../src/rooms/event-room";
import type { GameRoomState } from "../src/schema/game-state";
import { getFreePort } from "./helpers/free-port";

/**
 * Partidas abandonadas en `EventRoom` (specs/11 §8.2, ADR-043): el grupo sin
 * nadie conectado 60 min se cierra como abandonado. `EventRoom` no necesita
 * ningún cambio propio — su `onMilestone` ya persistía cualquier `game_ended`
 * tal cual llegara, y `event-runtime.ts` ya distinguía `aborted` de un fin
 * normal (`session.status`, `completesGroup`) desde antes de este ticket.
 * `FastAbandonedEventRoom` acorta el plazo con el mismo punto de extensión
 * que `GameRoom` (`abandonedGameTimeoutSeconds`).
 */

const FAST_SECONDS = 0.15;
const FAST_EVENT_ROOM_NAME = "event_abandoned_test";

class FastAbandonedEventRoom extends EventRoom {
  protected override lobbyReconnectGraceSeconds(): number {
    return FAST_SECONDS;
  }
  protected override hostReassignGraceSeconds(): number {
    return FAST_SECONDS;
  }
  protected override resultsRoomLifetimeSeconds(): number {
    return FAST_SECONDS;
  }
  protected override abandonedGameTimeoutSeconds(): number {
    return FAST_SECONDS;
  }
}

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(FAST_EVENT_ROOM_NAME, FastAbandonedEventRoom).filterBy(["sessionId"]);
  },
});

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(config, await getFreePort());
});

afterEach(async () => {
  await colyseus.cleanup();
  configureEventRuntime(undefined);
});

afterAll(async () => {
  await colyseus.shutdown();
});

const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };
const organizer: Actor = { userId: "profe", organizationId: null, role: "member" };
const VERSION = "60000000-0000-4000-8000-000000000001";

/** Evento activo con 1 sesión y 2 claves individuales (mismo grupo); canje con el secreto de dev. */
async function eventWithOneSession() {
  const T0 = new Date("2026-01-01T00:00:00Z");
  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({
      adminIds: [],
      tiers: [
        {
          id: "00000000-0000-4000-8000-000000000002",
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
        roomId: "70000000-0000-4000-8000-000000000001",
        authorId: organizer.userId,
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
  const keyStore = createInMemoryAccessKeyStore({ events: eventStore });
  const accessKeys = createAccessKeyService({ store: keyStore, events, dpa: DPA_SIGNED });
  const runtime = createInMemoryEventRuntimeStore({
    events: eventStore,
    packages: { [VERSION]: loadReyAldricRoomPackage() },
    keys: keyStore,
  });
  configureEventRuntime(runtime);
  const redeem = createRedeemService({
    store: keyStore,
    accessKeys,
    joinToken: { secret: DEV_JOIN_TOKEN_SECRET, ttlSeconds: 900 },
    colyseusEndpoint: "ws://localhost",
    roomName: EVENT_ROOM_NAME,
  });
  const event = await events.createEvent(organizer, {
    roomVersionId: VERSION,
    title: "Jornada",
    maxSimultaneousSessions: 1,
    groupingMode: "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: 2,
  });
  const activation = await accessKeys.activateEvent(organizer, event.id);
  return {
    redeem,
    event,
    keyStore,
    sessions: activation.sessions,
    codes: activation.keys.map((k) => k.code),
  };
}

describe("EventRoom — partidas abandonadas (specs/11 §8.2, ADR-043)", () => {
  it("el grupo sin nadie conectado se cierra como abandonado (session.status, sin completedAt)", async () => {
    const { redeem, keyStore, codes } = await eventWithOneSession();
    const ana = await redeem.redeem(ANONYMOUS_ACTOR, { code: codes[0]!, displayName: "Ana" });
    const bruno = await redeem.redeem(ANONYMOUS_ACTOR, { code: codes[1]!, displayName: "Bruno" });
    expect(ana.sessionId).toBe(bruno.sessionId); // misma sesión (grupo).

    // `a` crea la room (matchmaking por `sessionId`); `b` se une con
    // `colyseus.connectTo` (join directo por `roomId` + `waitForInitialState`
    // en la misma llamada) — con `sdk.joinOrCreate` para el segundo cliente,
    // el estado inicial puede llegar antes de engancharse a `onStateChange`
    // (la room ya existe, sin el retraso de su propio `onCreate`) y
    // `waitForInitialState()` se queda esperando un evento que ya pasó.
    const a = await colyseus.sdk.joinOrCreate<GameRoomState>(FAST_EVENT_ROOM_NAME, {
      sessionId: ana.sessionId,
      joinToken: ana.joinToken,
    });
    await a.waitForInitialState();
    const room = colyseus.getRoomById<EventRoom>(a.roomId);
    const b = await colyseus.connectTo(room, {
      sessionId: bruno.sessionId,
      joinToken: bruno.joinToken,
    });

    a.send(GAME_MESSAGES.setReady, { ready: true });
    b.send(GAME_MESSAGES.setReady, { ready: true });
    await expect.poll(() => a.state.players.get(b.sessionId)?.ready).toBe(true);
    a.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => a.state.phase).toBe("starting");
    a.send(GAME_MESSAGES.enterMap, {});
    b.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => a.state.phase).toBe("playing");

    await a.leave(false);
    await b.leave(false);

    const session = () => keyStore.sessions.find((s) => s.id === ana.sessionId)!;
    const group = () => keyStore.groups.find((g) => g.sessionId === ana.sessionId)!;
    await expect.poll(() => session().status, { timeout: 3000 }).toBe("aborted");
    // Abandonar no cierra el grupo (`completesGroup`: solo victoria/tiempo, event-runtime.ts).
    expect(group()?.completedAt ?? null).toBeNull();
  });
});
