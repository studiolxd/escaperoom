import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { createColyseusLiveProgressSource } from "@escaperoom/shared/event-progress";
import { createInMemoryEventRuntimeStore } from "@escaperoom/shared/event-runtime";
import { DEV_JOIN_TOKEN_SECRET } from "@escaperoom/shared/join-token";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  createAccessKeyService,
  createEventPanelService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryInvitationStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  createRedeemService,
  countKeys,
  type Actor,
  type DpaGate,
} from "@escaperoom/shared/services";
import { EVENT_ROOM_NAME, GAME_MESSAGES } from "../src/constants";
import { createEventProgressRouter } from "../src/events/http";
import { configureEventRuntime } from "../src/events/runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { JOIN_TOKEN_ERRORS, type EventRoom } from "../src/rooms/event-room";
import type { GameRoomState } from "../src/schema/game-state";
import { defineEventRoom } from "../src/server";
import { getFreePort } from "./helpers/free-port";

/**
 * Eventos de extremo a extremo (ticket 5.12) sobre Colyseus real (puerto libre
 * del SO): el evento se crea sobre una versión publicada **distinta del
 * fixture** (el Rey Aldric con otro código en el candado del arca y una regla
 * de victoria al abrirlo), los invitados canjean con los servicios de `shared`
 * y la room `event` juega esa versión exacta, persiste cada hito en el runtime
 * (store en memoria con la semántica del de Postgres), escribe
 * `group.completedAt` al terminar y caduca las claves `on_group_complete`.
 * Tras "reiniciar" Colyseus (otra instancia, otro puerto) el panel sigue
 * mostrando el progreso y el ranking desde lo persistido.
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

async function startColyseus(): Promise<void> {
  port = await getFreePort();
  colyseus = await boot(config, port);
}

beforeAll(startColyseus);

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
const GROUP_ID = "30000000-0000-4000-8000-000000000001";
const EVENT_CODE = "9021";

/**
 * La versión publicada del evento: el Rey Aldric 1.1.0 con otro código en el
 * candado del arca y una regla nueva que, al abrirlo, abre la puerta de la
 * bodega y da la victoria. El fixture (1.0.0) nunca termina ahí.
 */
function publishedVersion(): RoomPackage {
  const pkg = structuredClone(loadReyAldricRoomPackage()) as RoomPackage;
  pkg.meta.version = "1.1.0";
  pkg.meta.title = "La Maldición del Rey Aldric — edición del evento";
  const lock = pkg.puzzles.find((puzzle) => puzzle.id === "p-candado-arca");
  if (lock?.type !== "code_lock") throw new Error("El fixture ya no tiene p-candado-arca");
  lock.code = EVENT_CODE;
  pkg.rules.push({
    id: "r-victoria-evento",
    priority: 0,
    once: true,
    trigger: { type: "on_puzzle_solved", puzzleId: "p-candado-arca" },
    conditions: [],
    actions: [
      { type: "set_object_state", objectId: "puerta-bodega", state: "open" },
      { type: "end_game", result: "victory" },
    ],
  });
  return parseRoomPackage(pkg);
}

type TestClient = Awaited<ReturnType<ColyseusTestServer["sdk"]["joinOrCreate"]>> & {
  state: GameRoomState;
};

/**
 * Evento activo sobre la versión publicada, con 2 sesiones, un grupo en la
 * primera (clave de grupo de 2 asientos) y la regla `on_group_complete`; el
 * runtime de la room `event` es un store en memoria compartido con las claves.
 */
async function publishedEvent(opts: { packages?: Record<string, RoomPackage> } = {}) {
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
    packages: opts.packages ?? { [VERSION]: publishedVersion() },
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
  /** Panel leyendo el Colyseus que esté en marcha en cada momento (puerto actual). */
  const panelFor = (colyseusPort: number) =>
    createEventPanelService({
      keys: store,
      invitations: createInMemoryInvitationStore({ keys: store }),
      keyCounts: async (eventId) => countKeys(store.keys.filter((k) => k.eventId === eventId)),
      live: createColyseusLiveProgressSource({
        baseUrl: `http://localhost:${colyseusPort}`,
        secret: DEV_JOIN_TOKEN_SECRET,
      }),
      stored: runtime,
      spectator: { secret: DEV_JOIN_TOKEN_SECRET, ttlSeconds: 900 },
      colyseusEndpoint: `ws://localhost:${colyseusPort}`,
      roomName: EVENT_ROOM_NAME,
    });
  const event = await events.createEvent(organizer, {
    roomVersionId: VERSION,
    title: "Jornada de 4.º B",
    maxSimultaneousSessions: 2,
    groupingMode: "specific",
    requireConfirmation: false,
    expiryRules: [{ type: "on_group_complete" }],
    playersPlanned: 8,
  });
  const { sessions } = await accessKeys.activateEvent(organizer, event.id, {
    keyPlan: [{ type: "individual", count: 1 }],
  });
  store.groups.push({
    id: GROUP_ID,
    sessionId: sessions[0]!.id,
    eventId: event.id,
    name: "Grupo Azul",
    completedAt: null,
  });
  const [groupKey] = await accessKeys.generateKeys(organizer, event.id, {
    type: "group",
    count: 1,
    seats: 2,
    groupId: GROUP_ID,
  });
  const [soloKey] = await accessKeys.generateKeys(organizer, event.id, {
    type: "individual",
    count: 1,
    sessionId: sessions[1]!.id,
  });
  return {
    store,
    runtime,
    redeem,
    panelFor,
    event,
    sessions,
    groupKey: groupKey!,
    soloKey: soloKey!,
  };
}

type Scenario = Awaited<ReturnType<typeof publishedEvent>>;

/** Un invitado canjea y entra en la room de su sesión (las opciones extra no deben contar). */
async function joinGuest(
  redeem: Scenario["redeem"],
  code: string,
  displayName: string,
  extra: Record<string, unknown> = {},
): Promise<TestClient> {
  const ticket = await redeem.redeem(ANONYMOUS_ACTOR, { code, displayName });
  const client = (await colyseus.sdk.joinOrCreate<GameRoomState>(EVENT_ROOM_NAME, {
    ...extra,
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

async function start(client: TestClient): Promise<void> {
  client.send(GAME_MESSAGES.setReady, { ready: true });
  await until(client, (state) => state.players.get(client.sessionId)?.ready === true);
  client.send(GAME_MESSAGES.startGame, {});
  await until(client, (state) => state.phase === "starting");
  client.send(GAME_MESSAGES.enterMap, {});
  await until(client, (state) => state.phase === "playing");
}

const hasItem = (client: TestClient, item: string) =>
  Boolean(client.state.inventories.get(client.sessionId)?.items.includes(item));

/** Del cuadro al candado del arca: deja el candado listo para intentar el código. */
async function reachArcaLock(client: TestClient): Promise<void> {
  client.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
  client.send(GAME_MESSAGES.useItem, { itemId: "llave-bronce", objectId: "armario" });
  await until(client, () => hasItem(client, "yesquero") && hasItem(client, "vela"));
  client.send(GAME_MESSAGES.combine, { puzzleId: "p-combina", inputs: ["yesquero", "vela"] });
  await until(client, () => hasItem(client, "antorcha"));
  client.send(GAME_MESSAGES.interact, { objectId: "brasero" });
  await until(client, (state) => state.flags.get("digito3") === "3");
}

async function attemptCode(client: TestClient, code: string) {
  const result = next<{ ok: boolean; outcome: string }>(client, GAME_MESSAGES.attemptResult);
  client.send(GAME_MESSAGES.puzzleAttempt, { puzzleId: "p-candado-arca", attempt: { code } });
  return result;
}

async function joinError(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return (err as Error).message;
}

describe("la room `event` juega el paquete publicado del evento", () => {
  it("carga en servidor la versión del evento (no el fixture) e ignora lo que pida el cliente", async () => {
    const { redeem, groupKey } = await publishedEvent();
    const ana = await joinGuest(redeem, groupKey.code, "Ana", { packageId: "room-rey-aldric" });

    expect(ana.state.roomPackageId).toBe("room-rey-aldric");
    expect(ana.state.roomPackageVersion).toBe("1.1.0");
    const room = colyseus.getRoomById<EventRoom>(ana.roomId);
    expect(room.playingRoomVersionId).toBe(VERSION);

    // El código del fixture ya no abre el arca; el de la versión publicada sí.
    await start(ana);
    await reachArcaLock(ana);
    expect(await attemptCode(ana, "4732")).toMatchObject({ ok: false });
    expect(await attemptCode(ana, EVENT_CODE)).toMatchObject({ ok: true });
    await until(ana, (state) => state.phase === "ended");
    expect(ana.state.result).toBe("victory");
  });

  it("sin paquete publicado para el evento, la room no se crea", async () => {
    const { redeem, groupKey } = await publishedEvent({ packages: {} });
    expect(await joinError(joinGuest(redeem, groupKey.code, "Ana"))).toContain(
      JOIN_TOKEN_ERRORS.eventUnavailable,
    );
  });

  it("sin runtime de eventos (producción sin base de datos), tampoco", async () => {
    const { redeem, groupKey } = await publishedEvent();
    configureEventRuntime(null);
    expect(await joinError(joinGuest(redeem, groupKey.code, "Ana"))).toContain(
      JOIN_TOKEN_ERRORS.eventUnavailable,
    );
  });
});

describe("persistencia del progreso en `progressEvent`", () => {
  it("resolver un puzzle y pedir una pista persiste sus hitos con grupo y tiempos", async () => {
    const { redeem, runtime, store, sessions, groupKey } = await publishedEvent();
    const ana = await joinGuest(redeem, groupKey.code, "Ana");
    await start(ana);
    const room = colyseus.getRoomById<EventRoom>(ana.roomId);

    ana.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    await until(ana, (state) => state.puzzles.get("p-llave-cuadro")?.state === "solved");
    const hint = next(ana, GAME_MESSAGES.hintDelivered);
    ana.send(GAME_MESSAGES.hintRequest, { puzzleId: "p-candado-arca" });
    await hint;
    await room.flushProgress();

    const s1 = sessions[0]!.id;
    expect(runtime.rows.map((row) => [row.sessionId, row.kind, row.puzzleId])).toEqual([
      [s1, "game_started", null],
      [s1, "solved", "p-llave-cuadro"],
      [s1, "hint_used", "p-candado-arca"],
    ]);
    const solved = runtime.rows[1]!;
    expect(solved).toMatchObject({ groupId: GROUP_ID, playerId: null, hintsUsed: 0 });
    expect(solved.durationMs).toBeGreaterThanOrEqual(0);
    expect(runtime.rows[2]!.hintsUsed).toBeGreaterThan(0);
    // El inicio pasa la sesión a `in_progress` con su room.
    expect(store.sessions.find((s) => s.id === s1)?.status).toBe("in_progress");
    expect(runtime.sessionTimes.get(s1)).toMatchObject({ roomId: ana.roomId, endedAt: null });
  });

  it("si la base de datos falla, la partida sigue sin romperse", async () => {
    const { redeem, runtime, groupKey } = await publishedEvent();
    runtime.down = true;
    const ana = await joinGuest(redeem, groupKey.code, "Ana");
    await start(ana);
    ana.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    await until(ana, (state) => state.puzzles.get("p-llave-cuadro")?.state === "solved");
    await colyseus.getRoomById<EventRoom>(ana.roomId).flushProgress();
    expect(runtime.rows).toEqual([]);
    expect(ana.state.phase).toBe("playing");
  });
});

describe("fin de grupo y reinicio del servidor", () => {
  it("escribe group.completedAt, caduca sus claves y el panel sobrevive a un reinicio", async () => {
    const scenario = await publishedEvent();
    const { redeem, runtime, store, event, sessions, groupKey, soloKey } = scenario;
    const ana = await joinGuest(redeem, groupKey.code, "Ana");
    const bruno = await joinGuest(redeem, soloKey.code, "Bruno");
    expect(ana.roomId).not.toBe(bruno.roomId);
    await start(ana);
    await start(bruno);

    // Bruno (sesión 2) solo resuelve el cuadro; Ana (grupo de la sesión 1) escapa.
    bruno.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    await until(bruno, (state) => state.puzzles.get("p-llave-cuadro")?.state === "solved");
    await reachArcaLock(ana);
    expect(await attemptCode(ana, EVENT_CODE)).toMatchObject({ ok: true });
    await until(ana, (state) => state.phase === "ended");
    await colyseus.getRoomById<EventRoom>(ana.roomId).flushProgress();
    await colyseus.getRoomById<EventRoom>(bruno.roomId).flushProgress();

    // Hitos de la sesión 1: puerta abierta y fin con resultado y tiempo.
    const s1Rows = runtime.rows.filter((row) => row.sessionId === sessions[0]!.id);
    expect(s1Rows.find((row) => row.kind === "door_opened")).toMatchObject({
      objectId: "puerta-bodega",
    });
    const ended = s1Rows.find((row) => row.kind === "game_ended");
    expect(ended).toMatchObject({ result: "victory" });
    expect(ended!.durationMs).toBeGreaterThanOrEqual(0);

    // El grupo queda completado y su clave (con un asiento libre) caduca.
    const group = store.groups.find((g) => g.id === GROUP_ID)!;
    expect(group.completedAt).toBeInstanceOf(Date);
    expect(store.keys.find((k) => k.code === groupKey.code)?.status).toBe("expired");
    expect(store.sessions.find((s) => s.id === sessions[0]!.id)?.status).toBe("ended");
    await expect(
      redeem.redeem(ANONYMOUS_ACTOR, { code: groupKey.code, displayName: "Eva" }),
    ).rejects.toMatchObject({ code: "ACCESS_KEY_EXPIRED" });

    const before = await scenario.panelFor(port).getDashboard(organizer, event.id);
    expect(before.rows.map((row) => [row.sessionId, row.state, row.rank])).toEqual([
      [sessions[0]!.id, "ended", 1],
      [sessions[1]!.id, "playing", 2],
    ]);

    // "Reinicio": se apaga este Colyseus (vacía las colas) y arranca otra instancia.
    ana.connection.close();
    bruno.connection.close();
    await colyseus.shutdown();
    await startColyseus();

    const after = await scenario.panelFor(port).getDashboard(organizer, event.id);
    expect(after.liveAvailable).toBe(true);
    expect(after.rows).toEqual([
      expect.objectContaining({
        sessionId: sessions[0]!.id,
        state: "ended",
        result: "victory",
        rank: 1,
        puzzlesTotal: publishedVersion().puzzles.length,
        observable: false,
      }),
      expect.objectContaining({
        sessionId: sessions[1]!.id,
        state: "offline",
        result: null,
        puzzlesSolved: 1,
        rank: 2,
        players: 0,
        observable: false,
      }),
    ]);
    // Lo persistido coincide con lo que mostraba la room viva antes del reinicio.
    for (const key of [
      "puzzlesSolved",
      "hintsUsed",
      "elapsedMs",
      "startedAt",
      "endedAt",
    ] as const) {
      expect(after.rows[0]![key], key).toBe(before.rows[0]![key]);
    }
    expect(after.rows[0]!.elapsedMs).toBe(ended!.durationMs);
    expect(after.sessions).toMatchObject({ total: 2, ended: 1, active: 0 });
    expect(after.metrics.averageEscapeMs).toBe(ended!.durationMs);

    const { csv } = await scenario.panelFor(port).exportProgressCsv(organizer, event.id, {
      locale: "es",
    });
    const lines = csv
      .replace(/^\uFEFF/u, "")
      .trim()
      .split("\r\n");
    expect(lines[1]).toMatch(new RegExp(`^1,${sessions[0]!.name},Terminada,Escapó,`, "u"));
    expect(lines[2]).toMatch(new RegExp(`^2,${sessions[1]!.name},Sin conexión,,1,`, "u"));
  });
});
