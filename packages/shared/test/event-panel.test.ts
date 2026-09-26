// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LOCALES } from "@escaperoom/config/locales";
import {
  ANONYMOUS_ACTOR,
  EVENT_CSV_COPY,
  EVENT_PROGRESS_INTERNAL_PATH,
  buildSessionRows,
  compareRanking,
  countKeys,
  createAccessKeyService,
  createColyseusLiveProgressSource,
  createEventPanelService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryInvitationStore,
  createInMemoryLiveProgressSource,
  createInMemoryPricingTierStore,
  createPricingTierService,
  csvCell,
  eventProgressBearer,
  eventProgressCsv,
  formatElapsed,
  isEventProgressAuthorized,
  rankEventGroups,
  verifyJoinToken,
  verifySpectatorToken,
  type Actor,
  type DpaGate,
  type RankableProgress,
  type SessionLiveProgress,
  type SessionSeats,
} from "../src/services";

/** DPA firmado (5.11): el panel no depende de él. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };
const organizer: Actor = { userId: "profe", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };
const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");
const SECRET = "secreto-de-test-de-al-menos-32-caracteres";

function group(overrides: Partial<RankableProgress> & { id: string }) {
  return {
    started: true,
    result: null,
    puzzlesSolved: 0,
    hintsUsed: 0,
    elapsedMs: 0,
    players: 4,
    ...overrides,
  };
}

function live(
  sessionId: string,
  overrides: Partial<SessionLiveProgress> = {},
): SessionLiveProgress {
  return {
    sessionId,
    eventId: "e",
    roomId: `room-${sessionId}`,
    phase: "playing",
    result: null,
    puzzlesSolved: 0,
    puzzlesTotal: 9,
    hintsUsed: 0,
    players: 3,
    minPlayers: 2,
    readyCount: 3,
    startedAt: T0.getTime(),
    endedAt: null,
    elapsedMs: 60_000,
    updatedAt: T0.getTime() + 60_000,
    ...overrides,
  };
}

describe("ranking del evento (specs/21 §1 y §4)", () => {
  it("escapados primero por tiempo; desempates: pistas y luego nº de jugadores", () => {
    const ranked = rankEventGroups([
      group({ id: "lento", result: "victory", elapsedMs: 50 * 60_000 }),
      group({ id: "jugando", puzzlesSolved: 8 }),
      group({ id: "rapido-con-pistas", result: "victory", elapsedMs: 30 * 60_000, hintsUsed: 2 }),
      group({ id: "rapido", result: "victory", elapsedMs: 30 * 60_000, hintsUsed: 0 }),
      group({
        id: "rapido-3p",
        result: "victory",
        elapsedMs: 30 * 60_000,
        hintsUsed: 2,
        players: 3,
      }),
    ]);
    expect(ranked.map((g) => [g.id, g.rank])).toEqual([
      ["rapido", 1],
      ["rapido-3p", 2],
      ["rapido-con-pistas", 3],
      ["lento", 4],
      ["jugando", 5],
    ]);
  });

  it("sin victoria: más puzzles, menos pistas, menos tiempo; empates comparten puesto; sin empezar, sin puesto", () => {
    const ranked = rankEventGroups([
      group({ id: "sin-empezar", started: false }),
      group({
        id: "timeout",
        result: "timeout",
        puzzlesSolved: 6,
        hintsUsed: 2,
        elapsedMs: 3_600_000,
      }),
      group({ id: "a", puzzlesSolved: 6, hintsUsed: 1, elapsedMs: 1000 }),
      group({ id: "b", puzzlesSolved: 6, hintsUsed: 1, elapsedMs: 1000 }),
      group({ id: "c", puzzlesSolved: 7, hintsUsed: 5 }),
    ]);
    expect(ranked.map((g) => [g.id, g.rank])).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 2],
      ["timeout", 4],
      ["sin-empezar", null],
    ]);
    expect(compareRanking(ranked[1]!, ranked[2]!)).toBe(0);
  });

  it("cruza sesiones persistidas con el progreso en vivo (estados y observabilidad)", () => {
    const seat = (id: string, status: SessionSeats["status"]): SessionSeats => ({
      id,
      eventId: "e",
      name: `Sesión ${id}`,
      capacity: 4,
      status,
      occupied: 2,
    });
    const rows = buildSessionRows(
      [
        seat("s1", "pending"),
        seat("s2", "pending"),
        seat("s3", "in_progress"),
        seat("s4", "ended"),
      ],
      [
        live("s1", { phase: "lobby", startedAt: null, elapsedMs: 0 }),
        live("s2", { puzzlesSolved: 3, hintsUsed: 1 }),
      ],
    );
    expect(rows.map((r) => [r.sessionId, r.state, r.rank, r.observable])).toEqual([
      ["s2", "playing", 1, true],
      ["s3", "offline", 2, false],
      ["s4", "ended", 2, false],
      ["s1", "lobby", null, true],
    ]);
    expect(rows[0]).toMatchObject({ puzzlesSolved: 3, hintsUsed: 1, occupied: 2, capacity: 4 });
    expect(rows[0]!.startedAt).toBe(T0.toISOString());
    expect(rows[0]).not.toHaveProperty("started");
  });
});

describe("export CSV", () => {
  it("cabecera, filas en orden de ranking, BOM y celdas escapadas", () => {
    const rows = buildSessionRows(
      [
        {
          id: "s1",
          eventId: "e",
          name: '=HYPERLINK("x")',
          capacity: 4,
          status: "pending",
          occupied: 4,
        },
        { id: "s2", eventId: "e", name: "Grupo, 2", capacity: 4, status: "pending", occupied: 3 },
      ],
      [
        live("s1", { puzzlesSolved: 2, elapsedMs: 61_000 }),
        live("s2", { phase: "ended", result: "victory", puzzlesSolved: 9, elapsedMs: 3_723_000 }),
      ],
    );
    const csv = eventProgressCsv(rows, "es");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Puesto,Grupo,Estado,Resultado,Puzzles resueltos,Puzzles totales,Pistas usadas,Tiempo,Jugadores conectados,Plazas canjeadas",
      '1,"Grupo, 2",Terminada,Escapó,9,9,0,1:02:03,3,3/4',
      `2,"'=HYPERLINK(""x"")",Jugando,,2,9,0,0:01:01,3,4/4`,
      "",
    ]);
    expect(eventProgressCsv(rows, "en")).toContain("Rank,Group,Status");
  });

  it("textos en los 6 locales y utilidades", () => {
    expect(Object.keys(EVENT_CSV_COPY).sort()).toEqual([...LOCALES].sort());
    for (const locale of LOCALES) {
      expect(EVENT_CSV_COPY[locale].headers).toHaveLength(10);
    }
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell(-1)).toBe("-1");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(formatElapsed(0)).toBe("0:00:00");
    expect(
      countKeys([
        { status: "active", redeemedCount: 1 },
        { status: "active", redeemedCount: 0 },
      ]),
    ).toEqual({
      byStatus: { active: 2 },
      redeemed: 1,
    });
  });
});

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
  const source = createInMemoryLiveProgressSource();
  const now = new Date("2026-03-01T10:00:00Z");
  const panel = createEventPanelService({
    keys: store,
    invitations: createInMemoryInvitationStore({ keys: store }),
    keyCounts: async (eventId) => countKeys(store.keys.filter((k) => k.eventId === eventId)),
    live: source,
    spectator: opts.spectator === false ? null : { secret: SECRET, ttlSeconds: 900 },
    colyseusEndpoint: "ws://colyseus.test",
    roomName: "event",
    now: () => now,
  });
  const event = await events.createEvent(organizer, {
    roomVersionId: VERSION,
    title: "Jornada",
    maxSimultaneousSessions: 2,
    groupingMode: "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: 6,
  });
  const { sessions } = await accessKeys.activateEvent(organizer, event.id);
  return { panel, source, event, sessions, now };
}

describe("servicio del panel", () => {
  it("solo el organizador: 401 anónimo, 403 otro usuario, 404 evento inexistente", async () => {
    const { panel, event } = await setup();
    await expect(panel.getDashboard(ANONYMOUS_ACTOR, event.id)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(panel.getDashboard(other, event.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(panel.exportProgressCsv(other, event.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(panel.issueSpectatorTicket(other, event.id, "x")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(panel.getDashboard(organizer, "no-es-uuid")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("sin Colyseus el panel sigue con lo persistido y avisa", async () => {
    const { panel, source, event } = await setup();
    source.down = true;
    const dashboard = await panel.getDashboard(organizer, event.id);
    expect(dashboard.liveAvailable).toBe(false);
    expect(dashboard.keys).toMatchObject({ generated: 6, redeemed: 0 });
    expect(dashboard.sessions).toMatchObject({ total: 2, notStarted: 2, active: 0 });
    expect(dashboard.rows.every((row) => row.state === "not_started" && row.rank === null)).toBe(
      true,
    );
  });

  it("métricas: tiempo medio de los que escaparon y pistas medias", async () => {
    const { panel, source, event, sessions } = await setup();
    source.rows.push(
      live(sessions[0]!.id, {
        eventId: event.id,
        phase: "ended",
        result: "victory",
        elapsedMs: 40_000,
        hintsUsed: 2,
      }),
      live(sessions[1]!.id, { eventId: event.id, hintsUsed: 1 }),
      live("de-otro-evento", { eventId: "otro" }),
    );
    const dashboard = await panel.getDashboard(organizer, event.id);
    expect(dashboard.rows).toHaveLength(2);
    expect(dashboard.metrics).toEqual({ averageEscapeMs: 40_000, averageHints: 2 });
    expect(dashboard.sessions).toMatchObject({ active: 1, ended: 1 });
    const { csv, filename, locale } = await panel.exportProgressCsv(organizer, event.id, {
      locale: "fr",
    });
    expect(locale).toBe("fr");
    expect(filename).toMatch(/^evento-[0-9a-f]{8}-progreso-2026-03-01\.csv$/u);
    expect(csv).toContain("Rang,Groupe");
    expect((await panel.exportProgressCsv(organizer, event.id, { locale: "xx" })).locale).toBe(
      "es",
    );
  });

  it("token de observador: solo para una sesión del evento con partida viva", async () => {
    const { panel, source, event, sessions, now } = await setup();
    const s1 = sessions[0]!.id;
    await expect(
      panel.issueSpectatorTicket(organizer, event.id, "30000000-0000-4000-8000-000000000009"),
    ).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
    await expect(panel.issueSpectatorTicket(organizer, event.id, s1)).rejects.toMatchObject({
      code: "SESSION_NOT_LIVE",
    });
    source.rows.push(live(s1, { eventId: event.id }));
    const ticket = await panel.issueSpectatorTicket(organizer, event.id, s1);
    expect(ticket.colyseus).toEqual({ endpoint: "ws://colyseus.test", roomName: "event" });
    const verified = verifySpectatorToken(SECRET, ticket.spectatorToken, now.getTime());
    expect(verified).toMatchObject({
      ok: true,
      claims: { organizerId: organizer.userId, eventId: event.id, sessionId: s1 },
    });
    expect(verifySpectatorToken(SECRET, ticket.spectatorToken, now.getTime() + 6 * 60_000)).toEqual(
      {
        ok: false,
        error: "EXPIRED",
      },
    );
    // Un token de observador no vale como joinToken de jugador.
    expect(verifyJoinToken(SECRET, ticket.spectatorToken, now.getTime()).ok).toBe(false);

    source.rows[0] = live(s1, { eventId: event.id, phase: "ended", result: "victory" });
    await expect(panel.issueSpectatorTicket(organizer, event.id, s1)).rejects.toMatchObject({
      code: "SESSION_NOT_LIVE",
    });

    const disabled = await setup({ spectator: false });
    await expect(
      disabled.panel.issueSpectatorTicket(organizer, disabled.event.id, disabled.sessions[0]!.id),
    ).rejects.toMatchObject({ code: "SPECTATOR_UNAVAILABLE" });
  });
});

describe("fuente HTTP del progreso (ruta interna de Colyseus)", () => {
  it("manda la credencial derivada, filtra por evento y devuelve null si falla", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const body = { sessions: [live("s1"), live("s2", { eventId: "otro" })] };
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      calls.push({ url, auth });
      return Response.json(body);
    }) as typeof fetch;
    const source = createColyseusLiveProgressSource({
      baseUrl: "http://colyseus.test/",
      secret: SECRET,
      fetch: fakeFetch,
    });
    expect((await source.forEvent("e"))?.map((row) => row.sessionId)).toEqual(["s1"]);
    expect(calls[0]!.url).toBe(`http://colyseus.test${EVENT_PROGRESS_INTERNAL_PATH}/e/progress`);
    expect(isEventProgressAuthorized(SECRET, calls[0]!.auth ?? undefined)).toBe(true);
    expect(calls[0]!.auth).not.toContain(SECRET);
    expect(isEventProgressAuthorized(SECRET, `Bearer ${SECRET}`)).toBe(false);
    expect(isEventProgressAuthorized(SECRET, `Bearer ${eventProgressBearer("otro")}`)).toBe(false);

    const broken = createColyseusLiveProgressSource({
      baseUrl: "http://colyseus.test",
      secret: SECRET,
      fetch: (async () => Response.json({ sessions: [{ nope: 1 }] })) as typeof fetch,
    });
    expect(await broken.forEvent("e")).toBeNull();
    const down = createColyseusLiveProgressSource({
      baseUrl: "http://colyseus.test",
      secret: SECRET,
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    expect(await down.forEvent("e")).toBeNull();
  });
});
