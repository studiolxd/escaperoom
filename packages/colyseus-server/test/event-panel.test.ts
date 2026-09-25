import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  EVENT_PROGRESS_INTERNAL_PATH,
  createColyseusLiveProgressSource,
  eventProgressBearer,
} from "@escaperoom/shared/event-progress";
import {
  DEV_JOIN_TOKEN_SECRET,
  signSpectatorToken,
  verifySpectatorToken,
} from "@escaperoom/shared/join-token";
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
import {
  CHAT_MESSAGE,
  ERROR_MESSAGE,
  EVENT_ROOM_NAME,
  GAME_ERRORS,
  GAME_MESSAGES,
} from "../src/constants";
import { createEventProgressRouter } from "../src/events/http";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { MEDIA_TOKEN_REQUEST_MESSAGE } from "../src/media/index";
import { JOIN_TOKEN_ERRORS, type EventRoom } from "../src/rooms/event-room";
import type { GameRoomState } from "../src/schema/game-state";
import { defineEventRoom } from "../src/server";
import { getFreePort } from "./helpers/free-port";

/**
 * Panel del organizador (ticket 5.9) sobre Colyseus real (puerto libre del SO):
 * dos grupos juegan en rooms `event` reales con clientes de test; el servicio
 * del panel de `shared` (stores en memoria) lee su progreso por la ruta
 * interna HTTP y lo refleja al resolverse un puzzle. El organizador entra como
 * **observador**: ve el estado pero sus acciones se rechazan y nunca recibe
 * soluciones.
 */

let colyseus: ColyseusTestServer;
let port: number;

const config = defineConfig({
  initializeGameServer: (server) => {
    defineEventRoom(server);
  },
  initializeExpress: (app) => {
    app.use(createEventProgressRouter());
  },
});

beforeAll(async () => {
  port = await getFreePort();
  colyseus = await boot(config, port);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

/** DPA firmado (5.11): el panel no depende de él. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };
const organizer: Actor = { userId: "profe", organizationId: null, role: "member" };
const stranger: Actor = { userId: "otra", organizationId: null, role: "member" };
const VERSION = "10000000-0000-4000-8000-000000000001";
const roomPackage = loadReyAldricRoomPackage();
const LOCK_CODES = roomPackage.puzzles.flatMap((puzzle) =>
  puzzle.type === "code_lock" ? [puzzle.code] : [],
);
const FORBIDDEN_KEYS = new Set(["solution", "seed", "witness", "pairs", "code"]);

type TestClient = Awaited<ReturnType<ColyseusTestServer["sdk"]["joinOrCreate"]>> & {
  state: GameRoomState;
};

/** Evento activo con 2 sesiones y claves individuales; panel leyendo Colyseus por HTTP. */
async function eventWithPanel() {
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
  const redeem = createRedeemService({
    store,
    accessKeys,
    joinToken: { secret: DEV_JOIN_TOKEN_SECRET, ttlSeconds: 900 },
    colyseusEndpoint: `ws://localhost:${port}`,
    roomName: EVENT_ROOM_NAME,
  });
  const panel = createEventPanelService({
    keys: store,
    invitations: createInMemoryInvitationStore({ keys: store }),
    keyCounts: async (eventId) => countKeys(store.keys.filter((k) => k.eventId === eventId)),
    live: createColyseusLiveProgressSource({
      baseUrl: `http://localhost:${port}`,
      secret: DEV_JOIN_TOKEN_SECRET,
    }),
    spectator: { secret: DEV_JOIN_TOKEN_SECRET, ttlSeconds: 900 },
    colyseusEndpoint: `ws://localhost:${port}`,
    roomName: EVENT_ROOM_NAME,
  });
  const event = await events.createEvent(organizer, {
    roomVersionId: VERSION,
    title: "Jornada de 4.º B",
    maxSimultaneousSessions: 2,
    groupingMode: "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: 8,
  });
  const activation = await accessKeys.activateEvent(organizer, event.id);
  return {
    redeem,
    panel,
    event,
    sessions: activation.sessions,
    codes: activation.keys.map((k) => k.code),
  };
}

/** Un invitado canjea y entra en la room de su sesión. */
async function joinGuest(
  redeem: Awaited<ReturnType<typeof eventWithPanel>>["redeem"],
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

async function start(client: TestClient): Promise<void> {
  client.send(GAME_MESSAGES.startGame, {});
  await until(client, (state) => state.phase === "playing");
}

function next<T = Record<string, unknown>>(client: TestClient, type: string): Promise<T> {
  return new Promise((resolve) => {
    const off = client.onMessage(type, (payload: unknown) => {
      off();
      resolve(payload as T);
    });
  });
}

async function joinError(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return (err as Error).message;
}

/** Cualquier clave interna o código de candado en lo recibido. */
function findLeaks(received: unknown[]): string[] {
  const leaks: string[] = [];
  const scan = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (LOCK_CODES.includes(value)) leaks.push(`${path} = "${value}"`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key) && !(key === "code" && path.includes(ERROR_MESSAGE))) {
          leaks.push(`${path}.${key}`);
        }
        scan(child, `${path}.${key}`);
      }
    }
  };
  received.forEach((value, index) => scan(value, `[${index}]`));
  return leaks;
}

describe("panel del organizador con 2 grupos jugando", () => {
  it("refleja el progreso de ambos grupos y lo actualiza al resolver un puzzle", async () => {
    const { redeem, panel, event, sessions, codes } = await eventWithPanel();
    const ana = await joinGuest(redeem, codes[0]!, "Ana");
    const bruno = await joinGuest(redeem, codes[1]!, "Bruno");
    expect(ana.roomId).not.toBe(bruno.roomId);

    // Antes de empezar: las dos sesiones en la sala de espera, sin ranking.
    const lobby = await panel.getDashboard(organizer, event.id);
    expect(lobby.liveAvailable).toBe(true);
    expect(lobby.keys).toMatchObject({ generated: 8, redeemed: 2 });
    expect(lobby.sessions).toMatchObject({ total: 2, active: 2, notStarted: 0 });
    expect(lobby.rows.map((row) => [row.name, row.state, row.rank])).toEqual([
      [sessions[0]!.name, "lobby", null],
      [sessions[1]!.name, "lobby", null],
    ]);

    await start(ana);
    await start(bruno);
    const playing = await panel.getDashboard(organizer, event.id);
    for (const row of playing.rows) {
      expect(row).toMatchObject({
        state: "playing",
        puzzlesSolved: 0,
        puzzlesTotal: roomPackage.puzzles.length,
        players: 1,
        observable: true,
      });
      expect(row.startedAt).not.toBeNull();
    }

    // Bruno (sesión 2) resuelve el cuadro → su grupo pasa a encabezar el ranking.
    bruno.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    await until(bruno, (state) => state.puzzles.get("p-llave-cuadro")?.state === "solved");
    const after = await panel.getDashboard(organizer, event.id);
    expect(after.rows.map((row) => [row.sessionId, row.puzzlesSolved, row.rank])).toEqual([
      [sessions[1]!.id, 1, 1],
      [sessions[0]!.id, 0, 2],
    ]);

    // Ana alcanza a Bruno y además resuelve el candado: vuelve a cambiar el orden.
    ana.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    ana.send(GAME_MESSAGES.useItem, { itemId: "llave-bronce", objectId: "armario" });
    await until(ana, () =>
      ["yesquero", "vela"].every((item) =>
        ana.state.inventories.get(ana.sessionId)?.items.includes(item),
      ),
    );
    ana.send(GAME_MESSAGES.combine, { puzzleId: "p-combina", inputs: ["yesquero", "vela"] });
    await until(ana, () =>
      Boolean(ana.state.inventories.get(ana.sessionId)?.items.includes("antorcha")),
    );
    ana.send(GAME_MESSAGES.interact, { objectId: "brasero" });
    await until(ana, (state) => state.flags.get("digito3") === "3");
    ana.send(GAME_MESSAGES.puzzleAttempt, {
      puzzleId: "p-candado-arca",
      attempt: { code: "4732" },
    });
    await until(ana, (state) => state.puzzles.get("p-candado-arca")?.state === "solved");

    const overtaken = await panel.getDashboard(organizer, event.id);
    expect(overtaken.rows[0]).toMatchObject({ sessionId: sessions[0]!.id, rank: 1 });
    expect(overtaken.rows[0]!.puzzlesSolved).toBeGreaterThanOrEqual(2);
    expect(overtaken.rows[1]).toMatchObject({ sessionId: sessions[1]!.id, rank: 2 });

    // Export CSV con las dos filas en el orden del ranking.
    const { csv } = await panel.exportProgressCsv(organizer, event.id, { locale: "es" });
    const lines = csv.replace(/^\uFEFF/u, "").trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(new RegExp(`^1,${sessions[0]!.name},Jugando,,`, "u"));
    expect(lines[2]).toMatch(new RegExp(`^2,${sessions[1]!.name},Jugando,,1,`, "u"));
  });

  it("solo el organizador lee el panel; la ruta interna exige la credencial", async () => {
    const { panel, event } = await eventWithPanel();
    await expect(panel.getDashboard(stranger, event.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(panel.getDashboard(ANONYMOUS_ACTOR, event.id)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    const url = `http://localhost:${port}${EVENT_PROGRESS_INTERNAL_PATH}/${event.id}/progress`;
    expect((await fetch(url)).status).toBe(401);
    expect(
      (await fetch(url, { headers: { authorization: `Bearer ${DEV_JOIN_TOKEN_SECRET}` } })).status,
    ).toBe(401);
    const ok = await fetch(url, {
      headers: { authorization: `Bearer ${eventProgressBearer(DEV_JOIN_TOKEN_SECRET)}` },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sessions: [] });
  });
});

describe("modo observador", () => {
  it("el observador ve el estado, sus acciones se rechazan y nunca recibe soluciones", async () => {
    const { redeem, panel, event, sessions, codes } = await eventWithPanel();
    const ana = await joinGuest(redeem, codes[0]!, "Ana");
    await start(ana);

    // Sin partida viva en la sesión 2 no hay nada que observar.
    await expect(
      panel.issueSpectatorTicket(organizer, event.id, sessions[1]!.id),
    ).rejects.toMatchObject({ code: "SESSION_NOT_LIVE" });
    await expect(
      panel.issueSpectatorTicket(stranger, event.id, sessions[0]!.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const ticket = await panel.issueSpectatorTicket(organizer, event.id, sessions[0]!.id);
    expect(ticket.colyseus.roomName).toBe(EVENT_ROOM_NAME);
    const spectator = (await colyseus.sdk.join<GameRoomState>(EVENT_ROOM_NAME, {
      sessionId: ticket.sessionId,
      spectatorToken: ticket.spectatorToken,
    })) as TestClient;
    await spectator.waitForInitialState();
    expect(spectator.roomId).toBe(ana.roomId);

    const received: unknown[] = [];
    const types: string[] = [];
    spectator.onMessage("*", (type, payload) => {
      types.push(String(type));
      received.push({ [String(type)]: payload });
    });
    spectator.onStateChange((state) => received.push((state as GameRoomState).toJSON()));

    // Ve la partida: fase, jugadores y puzzles; él no es un jugador.
    expect(spectator.state.phase).toBe("playing");
    expect([...spectator.state.players.keys()]).toEqual([ana.sessionId]);
    const room = colyseus.getRoomById<EventRoom>(ana.roomId);
    expect(room.spectatorCount).toBe(1);
    expect(room.progressSnapshot().players).toBe(1);

    // Cada intención del observador se rechaza con PERMISSION_DENIED y no cambia nada.
    const intents: Array<[string, object]> = [
      [GAME_MESSAGES.startGame, {}],
      [GAME_MESSAGES.move, { x: 5, y: 5 }],
      [GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" }],
      [GAME_MESSAGES.puzzleOpen, { puzzleId: "p-candado-arca" }],
      [GAME_MESSAGES.puzzleAttempt, { puzzleId: "p-candado-arca", attempt: { code: "0000" } }],
      [GAME_MESSAGES.hintRequest, { puzzleId: "p-candado-arca" }],
      [GAME_MESSAGES.splitView, {}],
      [CHAT_MESSAGE, { text: "hola" }],
      [MEDIA_TOKEN_REQUEST_MESSAGE, { role: "player" }],
    ];
    for (const [type, payload] of intents) {
      const rejected = next<{ code: string }>(spectator, ERROR_MESSAGE);
      spectator.send(type, payload);
      expect(await rejected, type).toMatchObject({ code: GAME_ERRORS.permissionDenied });
    }
    expect(spectator.state.puzzles.get("p-llave-cuadro")?.state).not.toBe("solved");
    expect(spectator.state.chat.length).toBe(0);

    // Ana juega hasta abrir el arca (código incluido); el observador ve el progreso…
    ana.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    ana.send(GAME_MESSAGES.useItem, { itemId: "llave-bronce", objectId: "armario" });
    await until(ana, () =>
      Boolean(ana.state.inventories.get(ana.sessionId)?.items.includes("vela")),
    );
    ana.send(GAME_MESSAGES.combine, { puzzleId: "p-combina", inputs: ["yesquero", "vela"] });
    await until(ana, () =>
      Boolean(ana.state.inventories.get(ana.sessionId)?.items.includes("antorcha")),
    );
    ana.send(GAME_MESSAGES.interact, { objectId: "brasero" });
    await until(ana, (state) => state.flags.get("digito3") === "3");
    const view = next(ana, GAME_MESSAGES.puzzleView);
    ana.send(GAME_MESSAGES.puzzleOpen, { puzzleId: "p-candado-arca" });
    await view;
    ana.send(GAME_MESSAGES.hintRequest, { puzzleId: "p-candado-arca" });
    ana.send(GAME_MESSAGES.puzzleAttempt, {
      puzzleId: "p-candado-arca",
      attempt: { code: "4732" },
    });
    await until(spectator, (state) => state.puzzles.get("p-candado-arca")?.state === "solved");

    // …pero ni vistas de panel, ni desenlaces, ni pistas, ni el código.
    expect(types).toContain(GAME_MESSAGES.puzzleSolved);
    for (const directed of [
      GAME_MESSAGES.puzzleView,
      GAME_MESSAGES.attemptResult,
      GAME_MESSAGES.hintDelivered,
      GAME_MESSAGES.splitFragments,
    ]) {
      expect(types).not.toContain(directed);
    }
    expect(findLeaks(received)).toEqual([]);
    expect(JSON.stringify(received)).not.toContain("4732");
    expect([...spectator.state.players.keys()]).toEqual([ana.sessionId]);
  });

  it("rechaza observar sin room, con token de otra sesión, manipulado o con un joinToken", async () => {
    const { redeem, event, sessions, codes } = await eventWithPanel();
    const tokenFor = (sessionId: string, eventId = event.id, secret = DEV_JOIN_TOKEN_SECRET) => {
      const now = Date.now();
      return signSpectatorToken(
        secret,
        { organizerId: organizer.userId, eventId, sessionId },
        { now, expiresAt: now + 60_000 },
      );
    };
    const s1 = sessions[0]!.id;

    // Un observador no crea la room: sin partida, no hay a qué unirse.
    expect(
      await joinError(
        colyseus.sdk.joinOrCreate(EVENT_ROOM_NAME, { sessionId: s1, spectatorToken: tokenFor(s1) }),
      ),
    ).toContain(JOIN_TOKEN_ERRORS.missing);

    const ana = await joinGuest(redeem, codes[0]!, "Ana");
    const byId = (options: object) => colyseus.sdk.joinById(ana.roomId, options);
    expect(
      await joinError(byId({ sessionId: s1, spectatorToken: tokenFor(sessions[1]!.id) })),
    ).toContain(JOIN_TOKEN_ERRORS.wrongSession);
    expect(
      await joinError(
        byId({
          sessionId: s1,
          spectatorToken: tokenFor(s1, "40000000-0000-4000-8000-000000000009"),
        }),
      ),
    ).toContain(JOIN_TOKEN_ERRORS.wrongSession);
    expect(
      await joinError(byId({ sessionId: s1, spectatorToken: tokenFor(s1, event.id, "otro") })),
    ).toContain(JOIN_TOKEN_ERRORS.spectatorInvalid);

    // El joinToken de un jugador no sirve como token de observador (otra audiencia y clave).
    const ticket = await redeem.redeem(ANONYMOUS_ACTOR, { code: codes[2]!, displayName: "Eva" });
    expect(verifySpectatorToken(DEV_JOIN_TOKEN_SECRET, ticket.joinToken).ok).toBe(false);
    expect(await joinError(byId({ sessionId: s1, spectatorToken: ticket.joinToken }))).toContain(
      JOIN_TOKEN_ERRORS.spectatorInvalid,
    );
    // …ni al revés: un token de observador no es un joinToken.
    expect(await joinError(byId({ sessionId: s1, joinToken: tokenFor(s1) }))).toContain(
      JOIN_TOKEN_ERRORS.invalid,
    );
  });
});
