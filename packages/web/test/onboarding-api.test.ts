import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ANONYMOUS_ACTOR,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createOnboardingHandlers } from "../src/server/rest/onboarding";

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

  it("rechaza una plantilla desconocida con 400", async () => {
    const { post } = setup();
    const res = await post({ template: "otra-cosa" }, "autora");
    expect(res.status).toBe(400);
  });
});
