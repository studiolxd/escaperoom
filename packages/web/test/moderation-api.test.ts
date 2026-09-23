import {
  ANONYMOUS_ACTOR,
  createInMemoryModerationStore,
  createModerationService,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createModerationHandlers } from "../src/server/rest/moderation";

const ROOM = "11111111-1111-4111-8111-111111111111";
const REVIEW = "44444444-4444-4444-8444-444444444444";

const actor = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });
const ACTORS: Record<string, Actor> = {
  autora: actor("autora"),
  jugadora: actor("jugadora"),
  mod: actor("mod"),
};

/** Handlers REST con el servicio real y un store en memoria; el actor viaja en una cabecera de test. */
function setup() {
  const clock = new Date("2026-01-05T10:00:00Z");
  const store = createInMemoryModerationStore({
    moderatorIds: ["mod"],
    rooms: [{ id: ROOM, authorId: "autora", status: "published", title: "Rey Aldric" }],
    reviews: [{ id: REVIEW, roomId: ROOM, userId: "jugadora", text: "reseña" }],
    now: () => clock,
  });
  const handlers = createModerationHandlers({
    moderation: createModerationService({ store, now: () => clock }),
    resolveActor: async (req) => ACTORS[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });
  const req = (method: string, path: string, user?: string, body?: unknown) =>
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
  return { store, handlers, req, params };
}

type ErrorJson = { error: { code: string } };

describe("POST /api/rooms/:roomId/report", () => {
  it("un reporte crítico responde 201 y la sala queda despublicada", async () => {
    const { handlers, req, params, store } = setup();
    const res = await handlers.postRoomReport(
      req("POST", `/api/rooms/${ROOM}/report`, "jugadora", {
        category: "minor_safety",
        reason: "Contenido inapropiado para menores",
      }),
      params({ roomId: ROOM }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ severity: "critical", status: "pending", targetType: "room" });
    // Quien reporta no ve datos internos (dueño, acción, SLA).
    expect(json).not.toHaveProperty("targetUserId");
    expect(store.rooms.get(ROOM)?.status).toBe("removed");
  });

  it("sin motivo → 422 REPORT_REASON_REQUIRED; sin sesión → 401; JSON roto → 400", async () => {
    const { handlers, req, params } = setup();
    const noReason = await handlers.postRoomReport(
      req("POST", `/api/rooms/${ROOM}/report`, "jugadora", { category: "spam" }),
      params({ roomId: ROOM }),
    );
    expect(noReason.status).toBe(422);
    expect(((await noReason.json()) as ErrorJson).error.code).toBe("REPORT_REASON_REQUIRED");

    const anon = await handlers.postRoomReport(
      req("POST", `/api/rooms/${ROOM}/report`, undefined, { reason: "x" }),
      params({ roomId: ROOM }),
    );
    expect(anon.status).toBe(401);

    const broken = await handlers.postRoomReport(
      new Request(`http://localhost/api/rooms/${ROOM}/report`, {
        method: "POST",
        headers: { "x-test-user": "jugadora" },
        body: "{",
      }),
      params({ roomId: ROOM }),
    );
    expect(broken.status).toBe(400);
  });

  it("POST /api/reports reporta una reseña", async () => {
    const { handlers, req } = setup();
    const res = await handlers.postReport(
      req("POST", "/api/reports", "autora", {
        targetType: "review",
        targetId: REVIEW,
        category: "offensive_language",
        reason: "Insultos",
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ targetType: "review", severity: "normal" });
  });
});

describe("cola de moderación y apelaciones (/api/admin/*)", () => {
  it("no moderador → 403; moderador ve la cola con SLA, resuelve y el autor apela", async () => {
    const { handlers, req, params, store } = setup();
    await handlers.postRoomReport(
      req("POST", `/api/rooms/${ROOM}/report`, "jugadora", {
        category: "harassment",
        reason: "Acoso a una persona real",
      }),
      params({ roomId: ROOM }),
    );

    expect((await handlers.listReports(req("GET", "/api/admin/reports", "jugadora"))).status).toBe(
      403,
    );
    expect((await handlers.listReports(req("GET", "/api/admin/reports"))).status).toBe(401);

    const list = await handlers.listReports(req("GET", "/api/admin/reports?severity=high", "mod"));
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as {
      items: Array<{ id: string; severity: string; slaDueAt: string; overdue: boolean }>;
    };
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      severity: "high",
      slaDueAt: "2026-01-06T10:00:00.000Z",
      overdue: false,
    });

    // PATCH: el no moderador no llega ni a leer el cuerpo.
    const forbidden = await handlers.patchReport(
      req("PATCH", `/api/admin/reports/${items[0]!.id}`, "autora", { status: "dismissed" }),
      params({ id: items[0]!.id }),
    );
    expect(forbidden.status).toBe(403);

    const resolved = await handlers.patchReport(
      req("PATCH", `/api/admin/reports/${items[0]!.id}`, "mod", { status: "actioned" }),
      params({ id: items[0]!.id }),
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      report: { status: "actioned", actionTaken: "unpublish" },
      strike: { severity: "high", consequence: "warning" },
      standing: { status: "warned" },
    });
    expect(store.rooms.get(ROOM)?.status).toBe("removed");

    const again = await handlers.patchReport(
      req("PATCH", `/api/admin/reports/${items[0]!.id}`, "mod", { status: "dismissed" }),
      params({ id: items[0]!.id }),
    );
    expect(again.status).toBe(409);

    const standing = await handlers.getMyStanding(req("GET", "/api/me/moderation", "autora"));
    expect(await standing.json()).toMatchObject({ status: "warned", activeStrikes: 1 });

    const appeal = await handlers.postRoomAppeal(
      req("POST", `/api/rooms/${ROOM}/appeal`, "autora", {
        reason: "El personaje es ficticio, no hay acoso a nadie",
      }),
      params({ roomId: ROOM }),
    );
    expect(appeal.status).toBe(201);
    const { id: appealId } = (await appeal.json()) as { id: string };

    const appeals = await handlers.listAppeals(req("GET", "/api/admin/appeals", "mod"));
    expect(((await appeals.json()) as { items: unknown[] }).items).toHaveLength(1);

    const overturned = await handlers.patchAppeal(
      req("PATCH", `/api/admin/appeals/${appealId}`, "mod", { decision: "overturned" }),
      params({ id: appealId }),
    );
    expect(overturned.status).toBe(200);
    expect(await overturned.json()).toMatchObject({
      appeal: { status: "overturned" },
      standing: { status: "good" },
    });
    expect(store.rooms.get(ROOM)?.status).toBe("published");
  });

  it("apelar sin nada que apelar → 409; la cuenta sin suspensión → 409", async () => {
    const { handlers, req, params } = setup();
    const room = await handlers.postRoomAppeal(
      req("POST", `/api/rooms/${ROOM}/appeal`, "autora", { reason: "Quiero apelar algo" }),
      params({ roomId: ROOM }),
    );
    expect(room.status).toBe(409);
    expect(((await room.json()) as ErrorJson).error.code).toBe("NOTHING_TO_APPEAL");
    const account = await handlers.postAccountAppeal(
      req("POST", "/api/me/appeal", "autora", { reason: "Quiero apelar algo" }),
    );
    expect(account.status).toBe(409);
  });
});
