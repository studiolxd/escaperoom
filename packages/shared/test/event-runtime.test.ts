import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage } from "../src/schemas";
import {
  accountUserId,
  aggregateStoredProgress,
  buildSessionRows,
  completesGroup,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventRuntimeStore,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  createProgressRecorder,
  type Actor,
  type DpaGate,
  type ProgressMilestone,
  type SessionLiveProgress,
  type SessionSeats,
  type SessionStoredProgress,
  type StoredProgressRow,
} from "../src/services";

/**
 * Runtime de eventos (ticket 5.12) sin red ni base de datos: reconstrucción
 * del progreso desde `progressEvent`, el grabador asíncrono, el cruce vivo ↔
 * persistido del panel y los efectos del fin de partida en el store en memoria
 * (el mismo contrato que el de Postgres, `event-runtime-prisma.integration`).
 */

const fixture = parseRoomPackage(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as unknown,
);

const EVENT = "e1";
const T = Date.parse("2026-06-01T10:00:00Z");
const row = (
  kind: StoredProgressRow["kind"],
  seconds: number,
  over: Partial<StoredProgressRow> = {},
): StoredProgressRow => ({
  sessionId: "s1",
  kind,
  puzzleId: null,
  durationMs: seconds * 1000,
  hintsUsed: 0,
  result: null,
  createdAt: new Date(T + seconds * 1000),
  ...over,
});

describe("aggregateStoredProgress: el progreso de una sesión desde sus hitos", () => {
  it("sin inicio de partida no hay progreso", () => {
    expect(aggregateStoredProgress(EVENT, "s1", [], 9)).toBeNull();
    expect(aggregateStoredProgress(EVENT, "s1", [row("solved", 5, { puzzleId: "p" })], 9)).toBe(
      null,
    );
  });

  it("partida a medias: puzzles distintos, pistas acumuladas y último tiempo conocido", () => {
    const progress = aggregateStoredProgress(
      EVENT,
      "s1",
      [
        row("game_started", 0),
        row("solved", 60, { puzzleId: "a" }),
        row("hint_used", 90, { puzzleId: "b", hintsUsed: 1 }),
        row("solved", 120, { puzzleId: "b", hintsUsed: 1 }),
        row("door_opened", 125, { hintsUsed: 1 }),
      ],
      9,
    );
    expect(progress).toEqual({
      sessionId: "s1",
      eventId: EVENT,
      phase: "playing",
      result: null,
      puzzlesSolved: 2,
      puzzlesTotal: 9,
      hintsUsed: 1,
      startedAt: T,
      endedAt: null,
      elapsedMs: 125_000,
      updatedAt: T + 125_000,
    });
  });

  it("partida terminada: resultado, fin y tiempo del hito `game_ended`", () => {
    const progress = aggregateStoredProgress(
      EVENT,
      "s1",
      [
        row("game_started", 0),
        row("solved", 60, { puzzleId: "a" }),
        row("game_ended", 61, { result: "victory", durationMs: 60_500, hintsUsed: 2 }),
      ],
      9,
    );
    expect(progress).toMatchObject({
      phase: "ended",
      result: "victory",
      puzzlesSolved: 1,
      hintsUsed: 2,
      endedAt: T + 61_000,
      elapsedMs: 60_500,
    });
  });

  it("solo cuenta la última partida si la room se recreó y se volvió a empezar", () => {
    const progress = aggregateStoredProgress(
      EVENT,
      "s1",
      [
        row("game_started", 0),
        row("solved", 60, { puzzleId: "a" }),
        row("solved", 70, { puzzleId: "b", hintsUsed: 3 }),
        row("game_started", 500, { durationMs: 0 }),
        row("solved", 530, { puzzleId: "a", durationMs: 30_000 }),
      ],
      9,
    );
    expect(progress).toMatchObject({
      puzzlesSolved: 1,
      hintsUsed: 0,
      startedAt: T + 500_000,
      elapsedMs: 30_000,
    });
  });
});

describe("createProgressRecorder: escritura asíncrona y ordenada", () => {
  const solved = (puzzleId: string): ProgressMilestone => ({
    kind: "solved",
    puzzleId,
    groupId: null,
    userId: null,
    at: T,
    elapsedMs: 0,
    hintsUsed: 0,
  });

  it("no bloquea a quien graba y escribe en orden", async () => {
    const written: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const recorder = createProgressRecorder(
      {
        async recordMilestone(_sessionId, milestone) {
          await gate;
          written.push(milestone.kind === "solved" ? milestone.puzzleId : milestone.kind);
        },
      },
      "s1",
    );
    recorder.record(solved("a"));
    recorder.record(solved("b"));
    expect(written).toEqual([]); // `record` volvió sin esperar a la base de datos.
    release();
    await recorder.flush();
    expect(written).toEqual(["a", "b"]);
  });

  it("reintenta una vez y, si vuelve a fallar, sigue con el siguiente hito", async () => {
    const calls: string[] = [];
    const recorder = createProgressRecorder(
      {
        async recordMilestone(_sessionId, milestone) {
          const id = milestone.kind === "solved" ? milestone.puzzleId : milestone.kind;
          calls.push(id);
          if (id === "a" && calls.filter((c) => c === "a").length === 1) throw new Error("red");
          if (id === "b") throw new Error("caída");
        },
      },
      "s1",
    );
    recorder.record(solved("a"));
    recorder.record(solved("b"));
    recorder.record(solved("c"));
    await expect(recorder.flush()).resolves.toBeUndefined();
    expect(calls).toEqual(["a", "a", "b", "b", "c"]);
  });
});

describe("buildSessionRows: lo vivo manda, lo persistido cubre las sesiones sin room", () => {
  const session = (id: string, status: SessionSeats["status"]): SessionSeats => ({
    id,
    eventId: EVENT,
    name: id,
    capacity: 4,
    status,
    occupied: 2,
  });
  const stored = (sessionId: string, over: Partial<SessionStoredProgress> = {}) =>
    ({
      sessionId,
      eventId: EVENT,
      phase: "playing",
      result: null,
      puzzlesSolved: 1,
      puzzlesTotal: 9,
      hintsUsed: 0,
      startedAt: T,
      endedAt: null,
      elapsedMs: 60_000,
      updatedAt: T + 60_000,
      ...over,
    }) satisfies SessionStoredProgress;
  const live = (sessionId: string, over: Partial<SessionLiveProgress> = {}) =>
    ({ ...stored(sessionId), roomId: `room-${sessionId}`, players: 2, ...over }) as const;

  it("terminada y a medias sin room: `ended` y `offline`, con su ranking", () => {
    const rows = buildSessionRows(
      [session("a", "in_progress"), session("b", "ended"), session("c", "pending")],
      [],
      [
        stored("a", { puzzlesSolved: 3 }),
        stored("b", { phase: "ended", result: "victory", endedAt: T + 1, elapsedMs: 900 }),
      ],
    );
    expect(rows.map((r) => [r.sessionId, r.state, r.result, r.rank, r.observable])).toEqual([
      ["b", "ended", "victory", 1, false],
      ["a", "offline", null, 2, false],
      ["c", "not_started", null, null, false],
    ]);
    expect(rows[1]).toMatchObject({ puzzlesSolved: 3, players: 0 });
  });

  it("con room viva jugando, manda la room; en su sala de espera, lo persistido", () => {
    const rows = buildSessionRows(
      [session("a", "in_progress"), session("b", "in_progress")],
      [live("a", { puzzlesSolved: 5, phase: "playing" }), live("b", { phase: "lobby" })],
      [stored("a", { puzzlesSolved: 1 }), stored("b", { puzzlesSolved: 2 })],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
    expect(byId.a).toMatchObject({ state: "playing", puzzlesSolved: 5, observable: true });
    // Room recreada tras un reinicio: se ve lo que ya constaba y se puede observar.
    expect(byId.b).toMatchObject({
      state: "offline",
      puzzlesSolved: 2,
      players: 2,
      observable: true,
    });
  });
});

describe("store en memoria: efectos del fin de partida", () => {
  const organizer: Actor = { userId: "profe", organizationId: null, role: "member" };
  const VERSION = "10000000-0000-4000-8000-000000000001";
  const DPA: DpaGate = { requireDpa: async () => {} };

  async function scenario(expiryRules: unknown[]) {
    const T0 = new Date("2026-01-01T00:00:00Z");
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
      pricing: createPricingTierService({
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
      }),
      payments: createFakePaymentGateway(),
    });
    const store = createInMemoryAccessKeyStore({ events: eventStore });
    const keys = createAccessKeyService({ store, events, dpa: DPA });
    const runtime = createInMemoryEventRuntimeStore({
      events: eventStore,
      packages: { [VERSION]: fixture },
      keys: store,
    });
    const event = await events.createEvent(organizer, {
      roomVersionId: VERSION,
      title: "Jornada",
      maxSimultaneousSessions: 2,
      groupingMode: "specific",
      requireConfirmation: false,
      expiryRules,
      playersPlanned: 8,
    });
    const { sessions } = await keys.activateEvent(organizer, event.id, {
      keyPlan: [{ type: "individual", count: 1 }],
    });
    const groups = ["30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002"];
    for (const [index, id] of groups.entries()) {
      store.groups.push({
        id,
        sessionId: sessions[0]!.id,
        eventId: event.id,
        name: `Grupo ${index + 1}`,
        completedAt: null,
      });
    }
    const groupKeys = await Promise.all(
      groups.map(async (groupId) => {
        const [key] = await keys.generateKeys(organizer, event.id, {
          type: "group",
          count: 1,
          seats: 2,
          groupId,
        });
        return key!.code;
      }),
    );
    const status = (code: string) => store.keys.find((k) => k.code === code)!.status;
    return { runtime, store, event, sessions, groups, groupKeys, status };
  }

  const end = (result: "victory" | "timeout" | "aborted", groupIds: string[]) =>
    ({ kind: "game_ended", result, groupIds, at: T, elapsedMs: 1000, hintsUsed: 0 }) as const;

  it("solo el paquete de un evento activo y conocido", async () => {
    const { runtime, event } = await scenario([]);
    await expect(runtime.loadEventPackage(event.id)).resolves.toMatchObject({
      roomVersionId: VERSION,
      roomPackage: { meta: { id: fixture.meta.id } },
    });
    await expect(runtime.loadEventPackage("otro")).resolves.toBeNull();
  });

  it("victoria: cierra la sesión, completa solo los grupos que jugaron y caduca sus claves", async () => {
    const { runtime, store, sessions, groups, groupKeys, status } = await scenario([
      { type: "on_group_complete" },
    ]);
    const s1 = sessions[0]!.id;
    await runtime.recordMilestone(s1, { kind: "game_started", at: T, roomId: "r1" });
    expect(store.sessions.find((s) => s.id === s1)?.status).toBe("in_progress");
    await runtime.recordMilestone(s1, end("victory", [groups[0]!]));

    expect(store.sessions.find((s) => s.id === s1)?.status).toBe("ended");
    expect(store.groups.map((g) => g.completedAt?.getTime() ?? null)).toEqual([T, null]);
    expect(groupKeys.map(status)).toEqual(["expired", "active"]);
  });

  it("sin la regla `on_group_complete` el grupo se completa pero sus claves siguen vivas", async () => {
    const { runtime, store, sessions, groups, groupKeys, status } = await scenario([]);
    await runtime.recordMilestone(sessions[0]!.id, end("timeout", groups));
    expect(store.groups.every((g) => g.completedAt !== null)).toBe(true);
    expect(groupKeys.map(status)).toEqual(["active", "active"]);
  });

  it("una partida abandonada no completa el grupo", async () => {
    const { runtime, store, sessions, groups, groupKeys, status } = await scenario([
      { type: "on_group_complete" },
    ]);
    await runtime.recordMilestone(sessions[0]!.id, end("aborted", groups));
    expect(store.sessions[0]!.status).toBe("aborted");
    expect(store.groups.every((g) => g.completedAt === null)).toBe(true);
    expect(groupKeys.map(status)).toEqual(["active", "active"]);
  });
});

describe("utilidades", () => {
  it("accountUserId: solo los jugadores con cuenta tienen fila en `user`", () => {
    expect(accountUserId("user:abc")).toBe("abc");
    expect(accountUserId("guest:0000")).toBeNull();
    expect(accountUserId("user:")).toBeNull();
  });

  it("completesGroup: victoria y sin tiempo cierran el grupo; abandonar, no", () => {
    expect(["victory", "timeout", "aborted"].map((r) => completesGroup(r as never))).toEqual([
      true,
      true,
      false,
    ]);
  });
});
