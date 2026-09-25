import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ANONYMOUS_ACTOR,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_POLICIES } from "../src/server/rate-limit";
import { createOnboardingHandlers } from "../src/server/rest/onboarding";

const quotaServices = vi.hoisted(() => ({ drafts: null as RoomDraftService | null }));
vi.mock("@/server/services", () => ({ getRoomDraftService: () => quotaServices.drafts }));
vi.mock("@/server/context", () => ({
  resolveActorFromRequest: async () => ({
    userId: "autora",
    organizationId: null,
    role: "member",
  }),
}));

const author: Actor = { userId: "autora", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function setup() {
  const drafts = createRoomDraftService({ store: createInMemoryRoomDraftStore([]) });
  const actors: Record<string, Actor> = { autora: author };
  const handlers = createOnboardingHandlers({
    drafts,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
    readReyAldricRoomPackageJson: () => readFileSync(fixturePath, "utf8"),
  });
  const post = (body: unknown, user?: string) =>
    handlers.postCreateRoom(
      new Request("http://localhost/api/onboarding/rooms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(user ? { "x-test-user": user } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  return { post, drafts };
}

describe("POST /api/onboarding/rooms (ticket 6.7, specs/20 §2 §3)", () => {
  it("sin sesión responde 401 UNAUTHORIZED", async () => {
    const { post } = setup();
    const res = await post({ template: "blank" });
    expect(res.status).toBe(401);
  });

  it("crea una sala en blanco con metadata por defecto", async () => {
    const { post } = setup();
    const res = await post({ template: "blank" }, "autora");
    expect(res.status).toBe(201);
    const json = (await res.json()) as { roomId: string; template: string };
    expect(json.template).toBe("blank");
    expect(json.roomId).toBeTruthy();
  });

  it("crea una copia editable del Rey Aldric con nueva id y autor (specs/20 §3)", async () => {
    const { post, drafts } = setup();
    const res = await post({ template: "rey-aldric" }, "autora");
    expect(res.status).toBe(201);
    const { roomId } = (await res.json()) as { roomId: string };

    const draft = await drafts.loadDraft(author, roomId);
    expect(draft.updates.length).toBeGreaterThan(0);
  });

  it("rechaza una plantilla desconocida con 422 VALIDATION_ERROR (A-22: fijado en specs/13 §1)", async () => {
    const { post } = setup();
    const res = await post({ template: "otra-cosa" }, "autora");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("rechaza un título vacío con 422 (validación Zod, A-9/A-22)", async () => {
    const { post } = setup();
    const res = await post({ template: "blank", title: "   " }, "autora");
    expect(res.status).toBe(422);
  });

  it("las respuestas, incluidas las de error, llevan Cache-Control: no-store", async () => {
    const { post } = setup();
    const ok = await post({ template: "blank" }, "autora");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const err = await post({ template: "otra-cosa" }, "autora");
    expect(err.headers.get("cache-control")).toBe("no-store");
  });
});

// A-9: sin cuota, cada llamada persistía un doc Yjs completo sin límite.
describe("POST /api/onboarding/rooms — cuota (route module real)", () => {
  let POST: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    quotaServices.drafts = createRoomDraftService({ store: createInMemoryRoomDraftStore([]) });
    ({ POST } = await import("../src/app/api/onboarding/rooms/route"));
  });

  function req(ip: string): Request {
    return new Request("http://localhost/api/onboarding/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ template: "blank" }),
    });
  }

  it(`agota la cuota "onboarding-room-create" y responde 429`, async () => {
    const ip = "203.0.113.99";
    const { limit } = RATE_LIMIT_POLICIES["onboarding-room-create"].ip;
    for (let i = 0; i < limit; i += 1) {
      expect((await POST(req(ip))).status).toBe(201);
    }
    const blocked = await POST(req(ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});
