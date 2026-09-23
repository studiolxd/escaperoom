import {
  ANONYMOUS_ACTOR,
  countKeys,
  createAccessKeyService,
  createEventPanelService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryInvitationStore,
  createInMemoryLiveProgressSource,
  createInMemoryPricingTierStore,
  createPricingTierService,
  verifySpectatorToken,
  type Actor,
  type DpaGate,
  type EventDashboard,
  type SessionLiveProgress,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { dashboardPath, eventApiPath, observePath, readApiError } from "../src/lib/event-panel";
import { createEventPanelHandlers } from "../src/server/rest/event-panel";

/**
 * Panel del organizador por REST (ticket 5.9): dashboard, export CSV y token
 * de observador; solo el organizador accede. Stores y progreso en vivo en
 * memoria (el progreso real contra Colyseus lo cubre `colyseus-server`).
 */

/** DPA firmado (5.11): el panel no depende de él. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };
const organizer: Actor = { userId: "profe", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };
const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");
const SECRET = "secreto-de-test-de-al-menos-32-caracteres";

type ErrorJson = { error: { code: string } };

async function setup(opts: { spectator?: boolean } = {}) {
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
  const live = createInMemoryLiveProgressSource();
  const panel = createEventPanelService({
    keys: store,
    invitations: createInMemoryInvitationStore({ keys: store }),
    keyCounts: async (eventId) => countKeys(store.keys.filter((k) => k.eventId === eventId)),
    live,
    spectator: opts.spectator === false ? null : { secret: SECRET, ttlSeconds: 900 },
    colyseusEndpoint: "ws://colyseus.test",
    roomName: "event",
  });
  const event = await events.createEvent(organizer, {
    roomVersionId: VERSION,
    title: "Jornada de 4.º B",
    maxSimultaneousSessions: 2,
    groupingMode: "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: 6,
  });
  const { sessions } = await accessKeys.activateEvent(organizer, event.id);
  let actor: Actor = organizer;
  const handlers = createEventPanelHandlers({ panel, resolveActor: async () => actor });
  const progress = (sessionId: string, overrides: Partial<SessionLiveProgress> = {}) => ({
    sessionId,
    eventId: event.id,
    roomId: `room-${sessionId}`,
    phase: "playing" as const,
    result: null,
    puzzlesSolved: 0,
    puzzlesTotal: 9,
    hintsUsed: 0,
    players: 3,
    startedAt: T0.getTime(),
    endedAt: null,
    elapsedMs: 120_000,
    updatedAt: T0.getTime() + 120_000,
    ...overrides,
  });
  return {
    handlers,
    live,
    event,
    sessions,
    progress,
    as: (next: Actor) => {
      actor = next;
    },
  };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const sessionCtx = (id: string, sessionId: string) => ({
  params: Promise.resolve({ id, sessionId }),
});
const get = (path: string) => new Request(`https://escape.test${path}`);
const post = (path: string) => new Request(`https://escape.test${path}`, { method: "POST" });

describe("GET /api/events/:id/dashboard", () => {
  it("el organizador ve claves, sesiones y el ranking en vivo", async () => {
    const { handlers, live, event, sessions, progress } = await setup();
    live.rows.push(
      progress(sessions[0]!.id, { puzzlesSolved: 2 }),
      progress(sessions[1]!.id, { puzzlesSolved: 5, hintsUsed: 1 }),
    );
    const res = await handlers.getDashboard(
      get(`/api/events/${event.id}/dashboard`),
      ctx(event.id),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as EventDashboard;
    expect(body.event).toMatchObject({ id: event.id, title: "Jornada de 4.º B", status: "active" });
    expect(body.keys).toMatchObject({ generated: 6, redeemed: 0 });
    expect(body.liveAvailable).toBe(true);
    expect(body.rows.map((row) => [row.sessionId, row.rank, row.puzzlesSolved])).toEqual([
      [sessions[1]!.id, 1, 5],
      [sessions[0]!.id, 2, 2],
    ]);
  });

  it("401 sin sesión, 403 si no es el organizador, 404 si no existe", async () => {
    const { handlers, event, as } = await setup();
    as(ANONYMOUS_ACTOR);
    let res = await handlers.getDashboard(get("/"), ctx(event.id));
    expect(res.status).toBe(401);
    as(other);
    res = await handlers.getDashboard(get("/"), ctx(event.id));
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorJson).error.code).toBe("FORBIDDEN");
    expect((await handlers.getProgressCsv(get("/"), ctx(event.id))).status).toBe(403);
    expect((await handlers.postSpectate(post("/"), sessionCtx(event.id, "x"))).status).toBe(403);
    as(organizer);
    res = await handlers.getDashboard(get("/"), ctx("30000000-0000-4000-8000-000000000404"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/events/:id/progress/export", () => {
  it("CSV adjunto, en el idioma pedido y en orden de ranking", async () => {
    const { handlers, live, event, sessions, progress } = await setup();
    live.rows.push(
      progress(sessions[0]!.id, { phase: "ended", result: "victory", puzzlesSolved: 9 }),
    );
    const res = await handlers.getProgressCsv(
      get(`/api/events/${event.id}/progress/export?locale=en`),
      ctx(event.id),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="evento-[0-9a-f]{8}-progreso-\d{4}-\d{2}-\d{2}\.csv"$/u,
    );
    // `ignoreBOM`: que el decodificador no se coma el BOM que se quiere comprobar.
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe(
      "Rank,Group,Status,Result,Puzzles solved,Total puzzles,Hints used,Time,Players online,Seats redeemed",
    );
    expect(lines[1]).toBe(`1,${sessions[0]!.name},Finished,Escaped,9,9,0,0:02:00,3,0/3`);
    expect(lines[2]).toBe(`,${sessions[1]!.name},Not started,,0,0,0,0:00:00,0,0/3`);
  });
});

describe("POST /api/events/:id/sessions/:sessionId/spectate", () => {
  it("token de observador para una partida en curso; 409 si no la hay", async () => {
    const { handlers, live, event, sessions, progress } = await setup();
    const s1 = sessions[0]!.id;
    let res = await handlers.postSpectate(post("/"), sessionCtx(event.id, s1));
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorJson).error.code).toBe("SESSION_NOT_LIVE");

    live.rows.push(progress(s1));
    res = await handlers.postSpectate(post("/"), sessionCtx(event.id, s1));
    expect(res.status).toBe(200);
    const ticket = (await res.json()) as {
      sessionId: string;
      spectatorToken: string;
      colyseus: { endpoint: string; roomName: string };
    };
    expect(ticket).toMatchObject({
      sessionId: s1,
      colyseus: { endpoint: "ws://colyseus.test", roomName: "event" },
    });
    expect(verifySpectatorToken(SECRET, ticket.spectatorToken)).toMatchObject({
      ok: true,
      claims: { organizerId: organizer.userId, eventId: event.id, sessionId: s1 },
    });

    res = await handlers.postSpectate(
      post("/"),
      sessionCtx(event.id, "30000000-0000-4000-8000-000000000404"),
    );
    expect(res.status).toBe(404);
  });

  it("503 si el modo observador no está configurado", async () => {
    const { handlers, event, sessions } = await setup({ spectator: false });
    const res = await handlers.postSpectate(post("/"), sessionCtx(event.id, sessions[0]!.id));
    expect(res.status).toBe(503);
  });
});

describe("rutas del panel", () => {
  it("escapa ids y lee el código de error", async () => {
    expect(eventApiPath("a/b", "dashboard")).toBe("/api/events/a%2Fb/dashboard");
    expect(dashboardPath("e1")).toBe("/events/e1");
    expect(observePath("e1", "s 1")).toBe("/events/e1/sessions/s%201/observe");
    expect(await readApiError(Response.json({ error: { code: "FORBIDDEN" } }))).toBe("FORBIDDEN");
    expect(await readApiError(new Response("<html>"))).toBe("UNKNOWN");
  });
});
