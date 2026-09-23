import { createRulesOverlaySerializer } from "@escaperoom/editor/validation";
import { insertCondition, writeRules } from "@escaperoom/editor";
import { initRoomDoc, roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import type { ValidationReport } from "@escaperoom/shared/validator";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";
import {
  createRoomValidateHandlers,
  type RoomValidateHandlerDeps,
} from "../src/server/rest/room-validate";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };
const reyAldric = parseRoomPackage(JSON.parse(readReyAldricRoomPackageJson()) as unknown);

type ValidateJson = { roomId: string; ok: boolean; report: ValidationReport; text: string };

/**
 * Handler con store en memoria; el actor viaja en una cabecera de test. La
 * serialización doc → RoomPackage es la de 3.1: aquí, un adaptador de test
 * (reglas del doc sobre el Rey Aldric).
 */
async function setup(options: Partial<Pick<RoomValidateHandlerDeps, "serialize">> = {}) {
  const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
  const drafts = createRoomDraftService({ store });
  const actors: Record<string, Actor> = { autora: author, otro: intruder };
  const handlers = createRoomValidateHandlers({
    drafts,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
    serialize:
      "serialize" in options ? options.serialize! : createRulesOverlaySerializer(reyAldric),
  });

  // El editor escribe las reglas en el doc y el draft las persiste.
  const doc = new Y.Doc();
  const push = async (fn: () => void) => {
    const before = Y.encodeStateVector(doc);
    fn();
    await drafts.appendUpdate(author, ROOM_ID, Y.encodeStateAsUpdate(doc, before));
  };
  await push(() => writeRules(doc, reyAldric.rules));

  const validate = (user?: string, roomId = ROOM_ID) =>
    handlers.postValidate(
      new Request(`http://localhost/api/rooms/${roomId}/validate`, {
        method: "POST",
        headers: user ? { "x-test-user": user } : {},
      }),
      { params: Promise.resolve({ roomId }) },
    );
  return { doc, push, validate };
}

describe("POST /api/rooms/:roomId/validate", () => {
  it("200 con el informe del draft del autor", async () => {
    const api = await setup();
    const res = await api.validate("autora");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = (await res.json()) as ValidateJson;
    expect(json).toMatchObject({ roomId: ROOM_ID, ok: true });
    expect(json.report.ok).toBe(true);
    expect(json.report.criticalRoute?.steps.at(-1)?.victory).toBe(true);
    expect(json.text).toContain("Secuencia de solución verificada");
  });

  it("valida el estado actual del draft: un dead end guardado aparece en el informe", async () => {
    const api = await setup();
    await api.push(() =>
      insertCondition(api.doc, "r-abrir-armario", {
        type: "flag_is",
        flag: "armario-desbloqueado",
        value: true,
      }),
    );
    const json = (await (await api.validate("autora")).json()) as ValidateJson;
    expect(json.ok).toBe(false);
    const deadEnds = json.report.checks.find((check) => check.id === "dead_ends")!;
    expect(deadEnds.status).toBe("error");
    expect(deadEnds.issues.flatMap((issue) => issue.ids)).toContain("r-abrir-armario");
    expect(json.text).toMatch(/^❌ Dead ends/mu);
  });

  it("sin sesión → 401; otro usuario → 403; sala inexistente → 404", async () => {
    const api = await setup();
    const anonymous = await api.validate();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    const other = await api.validate("otro");
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect((await api.validate("autora", "33333333-3333-4333-8333-333333333333")).status).toBe(404);
  });

  it("422 si el draft aún no forma un RoomPackage válido", async () => {
    const api = await setup({ serialize: () => ({ meta: {} }) });
    const res = await api.validate("autora");
    expect(res.status).toBe(422);
    const json = (await res.json()) as {
      error: { code: string; details: Array<{ path: string; message: string }> };
    };
    expect(json.error.code).toBe("INVALID_DRAFT");
    expect(json.error.details.length).toBeGreaterThan(0);
  });

  it("con la serialización real del editor (3.1): el draft completo del Rey Aldric valida", async () => {
    const api = await setup({ serialize: roomDocToPackage });
    await api.push(() => roomPackageToDoc(reyAldric, api.doc));
    const res = await api.validate("autora");
    expect(res.status).toBe(200);
    const json = (await res.json()) as ValidateJson;
    expect(json.report.ok).toBe(true);
  });

  it("con la serialización real, una sala recién creada en el editor es un RoomPackage válido", async () => {
    const api = await setup({ serialize: roomDocToPackage });
    const fresh = new Y.Doc();
    initRoomDoc(fresh, { id: ROOM_ID, title: "Nueva", language: "es" });
    await api.push(() => {
      api.doc.getMap("rules").clear();
      Y.applyUpdate(api.doc, Y.encodeStateAsUpdate(fresh));
    });
    const res = await api.validate("autora");
    expect(res.status).toBe(200);
  });

  it("501 (tras autorizar) mientras no hay serialización del draft", async () => {
    const api = await setup({ serialize: null });
    expect((await api.validate()).status).toBe(401);
    expect((await api.validate("otro")).status).toBe(403);
    const res = await api.validate("autora");
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_IMPLEMENTED" } });
  });
});
