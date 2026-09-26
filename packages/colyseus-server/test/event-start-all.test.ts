import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  EVENT_START_ALL_INTERNAL_PATH,
  eventProgressBearer,
  type GroupStartResult,
} from "@escaperoom/shared/event-progress";
import { createInMemoryEventRuntimeStore } from "@escaperoom/shared/event-runtime";
import { DEV_JOIN_TOKEN_SECRET } from "@escaperoom/shared/join-token";
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
import { ERROR_MESSAGE, EVENT_ROOM_NAME, GAME_ERRORS, GAME_MESSAGES } from "../src/constants";
import { createEventProgressRouter } from "../src/events/http";
import { configureEventRuntime } from "../src/events/runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import type { GameRoomState } from "../src/schema/game-state";
import { defineEventRoom } from "../src/server";
import { getFreePort } from "./helpers/free-port";

/**
 * "Todos los grupos comienzan juntos" (ticket "inicio conjunto", specs/11
 * §4.1/§4.5, specs/19 §2) sobre Colyseus real: 2-3 grupos (rooms `event`
 * distintas) y la ruta interna `POST /internal/events/:eventId/start-all`
 * (`organizerStartGroup` vía `matchMaker.remoteRoomCall`, el mismo mecanismo
 * que ya usa el progreso del panel).
 */

const config = defineConfig({
  initializeGameServer: (server) => {
    defineEventRoom(server);
  },
  initializeExpress: (app) => {
    app.use(createEventProgressRouter());
  },
});

let colyseus: ColyseusTestServer;
let port: number;

beforeAll(async () => {
  port = await getFreePort();
  colyseus = await boot(config, port);
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
const VERSION = "10000000-0000-4000-8000-000000000001";
const roomPackage = loadReyAldricRoomPackage();

type TestClient = Awaited<ReturnType<ColyseusTestServer["sdk"]["joinOrCreate"]>> & {
  state: GameRoomState;
};

/** Evento con la opción activa, `sessionCount` grupos y una clave individual por grupo. */
async function eventWithAllGroupsStartTogether(sessionCount: number) {
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
  const store = createInMemoryAccessKeyStore({ events: eventStore });
  const accessKeys = createAccessKeyService({ store, events, dpa: DPA_SIGNED });
  const runtime = createInMemoryEventRuntimeStore({
    events: eventStore,
    packages: { [VERSION]: roomPackage },
    keys: store,
  });
  configureEventRuntime(runtime);
  const redeem = createRedeemService({
    store,
    accessKeys,
    joinToken: { secret: DEV_JOIN_TOKEN_SECRET, ttlSeconds: 900 },
    colyseusEndpoint: `ws://localhost:${port}`,
    roomName: EVENT_ROOM_NAME,
  });
  const event = await events.createEvent(organizer, {
    roomVersionId: VERSION,
    title: "Jornada con inicio conjunto",
    maxSimultaneousSessions: sessionCount,
    groupingMode: "specific",
    requireConfirmation: false,
    expiryRules: [],
    // +1 para el plan mínimo de activación (1 clave sin preasignar, que el
    // test no usa): las que de verdad usa, una por sesión con `sessionId`
    // explícito, se generan después (`specific` no las preasigna en el plan).
    playersPlanned: sessionCount + 1,
  });
  await events.setAllGroupsStartTogether(organizer, event.id, true);
  const { sessions } = await accessKeys.activateEvent(organizer, event.id, {
    keyPlan: [{ type: "individual", count: 1 }],
  });
  const keys = await Promise.all(
    sessions.map((session) =>
      accessKeys
        .generateKeys(organizer, event.id, { type: "individual", count: 1, sessionId: session.id })
        .then(([key]) => key!),
    ),
  );
  return { redeem, event, sessions, codes: keys.map((k) => k.code) };
}

async function joinGuest(
  redeem: Awaited<ReturnType<typeof eventWithAllGroupsStartTogether>>["redeem"],
  code: string,
  displayName: string,
): Promise<TestClient> {
  const ticket = await redeem.redeem(ANONYMOUS_ACTOR, { code, displayName });
  const client = (await colyseus.sdk.joinOrCreate<GameRoomState>(EVENT_ROOM_NAME, {
    sessionId: ticket.sessionId,
    joinToken: ticket.joinToken,
  })) as TestClient;
  await client.waitForInitialState();
  return client;
}

function until(client: TestClient, predicate: (state: GameRoomState) => boolean): Promise<void> {
  if (predicate(client.state)) return Promise.resolve();
  return new Promise((resolve) => {
    const check = (): void => {
      if (!predicate(client.state)) return;
      client.onStateChange.remove(check);
      resolve();
    };
    client.onStateChange(check);
  });
}

function next<T = Record<string, unknown>>(client: TestClient, type: string): Promise<T> {
  return new Promise((resolve) => {
    const off = client.onMessage(type, (payload: unknown) => {
      off();
      resolve(payload as T);
    });
  });
}

function setReady(client: TestClient, ready: boolean): Promise<void> {
  client.send(GAME_MESSAGES.setReady, { ready });
  return until(client, (state) => state.players.get(client.sessionId)?.ready === ready);
}

async function startAll(
  eventId: string,
  force: boolean,
): Promise<{ status: number; groups: GroupStartResult[] }> {
  const res = await fetch(
    `http://localhost:${port}${EVENT_START_ALL_INTERNAL_PATH}/${eventId}/start-all`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${eventProgressBearer(DEV_JOIN_TOKEN_SECRET)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ force }),
    },
  );
  const body = (await res.json()) as { groups: GroupStartResult[] };
  return { status: res.status, groups: body.groups };
}

describe("EventRoom: el anfitrión no puede empezar por su cuenta", () => {
  it("state.organizerControlsStart llega al cliente y start_game se rechaza", async () => {
    const { redeem, codes } = await eventWithAllGroupsStartTogether(1);
    const ana = await joinGuest(redeem, codes[0]!, "Ana");
    expect(ana.state.organizerControlsStart).toBe(true);
    expect(ana.state.hostId).toBe(ana.sessionId);

    await setReady(ana, true);
    const rejected = next<{ code: string }>(ana, ERROR_MESSAGE);
    ana.send(GAME_MESSAGES.startGame, {});
    expect(await rejected).toMatchObject({ code: GAME_ERRORS.permissionDenied });
    expect(ana.state.phase).toBe("lobby");
  });
});

describe("\"Comenzar todos\" — sin `force`, todo o nada", () => {
  it("si un grupo no está listo, no arranca ninguno; al completarlo, arrancan todos", async () => {
    const { redeem, event, codes } = await eventWithAllGroupsStartTogether(2);
    const ana = await joinGuest(redeem, codes[0]!, "Ana");
    const bruno = await joinGuest(redeem, codes[1]!, "Bruno");
    await setReady(ana, true);
    // Bruno no marca "Listo" todavía.

    const blocked = await startAll(event.id, false);
    expect(blocked.status).toBe(200);
    expect(blocked.groups.map((g) => g.status).sort()).toEqual(["not_ready", "ready"]);
    expect(ana.state.phase).toBe("lobby");
    expect(bruno.state.phase).toBe("lobby");

    await setReady(bruno, true);
    const started = await startAll(event.id, false);
    expect(started.groups.every((g) => g.status === "started")).toBe(true);
    await until(ana, (state) => state.phase === "playing");
    await until(bruno, (state) => state.phase === "playing");
  });
});

describe("\"Comenzar todos\" — con `force` (\"Comenzar igualmente\")", () => {
  it("arranca todo grupo con algún conectado, salta el mínimo, pero nunca uno vacío", async () => {
    const { redeem, event, sessions, codes } = await eventWithAllGroupsStartTogether(3);
    const ana = await joinGuest(redeem, codes[0]!, "Ana");
    const bruno = await joinGuest(redeem, codes[1]!, "Bruno");
    // La sesión 3 se queda sin nadie conectado.

    const result = await startAll(event.id, true);
    const bySession = Object.fromEntries(result.groups.map((g) => [g.sessionId, g.status]));
    expect(bySession[sessions[0]!.id]).toBe("started");
    expect(bySession[sessions[1]!.id]).toBe("started");
    // Nadie ha entrado nunca a la sesión 3: su room ni existe, así que no
    // sale en el resultado (no hay nada que "empty" pueda describir).
    expect(bySession[sessions[2]!.id]).toBeUndefined();

    await until(ana, (state) => state.phase === "playing");
    await until(bruno, (state) => state.phase === "playing");

    // El grupo vacío, cuando llegue alguien, puede empezar él mismo (no quedó bloqueado).
    const carla = await joinGuest(redeem, codes[2]!, "Carla");
    expect(carla.state.phase).toBe("lobby");
    await setReady(carla, true);
    carla.send(GAME_MESSAGES.startGame, {});
    await until(carla, (state) => state.phase === "playing");
  });
});
