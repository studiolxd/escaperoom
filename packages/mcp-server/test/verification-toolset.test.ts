import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  createCatalogService,
  createInMemoryPublishedAssetStorage,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createInMemoryRoomPublishStore,
  createPublishConfirmationService,
  createRoomDraftService,
  createRoomPublishService,
  createUnavailablePublishAssetSource,
  RoomPublishError,
  type Actor,
} from "@escaperoom/shared/services";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createCreatorMcpServer, type CreatorMcpDeps, type PreviewPlaytestLauncher } from "../src";
import { call, errorCode, type ToolCall } from "./fixtures/client";
import { ALDRIC_ROOM_ID, AUTHOR, FOREIGN_ROOM_ID, loadAldric } from "./fixtures/drafts";

/**
 * Ticket 4.5 — validate / preview / publish por MCP (specs/10 §2 fase D, §5).
 * Todo con los servicios de dominio reales (draft de 3.2, publicación de 3.9,
 * confirmación de 4.5) en memoria y la conversión real doc ↔ RoomPackage (3.1).
 */

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const aldric = parseRoomPackage(loadAldric());
const roomId = ALDRIC_ROOM_ID;
const APP_URL = "https://escaperoom.test";
const INTRUDER: Actor = { userId: "otra-persona", organizationId: null, role: "member" };

/** El escondite del cuadro sin entregar la llave: dead end ❌ (validador en rojo). */
function brokenAldric(): RoomPackage {
  const pkg = structuredClone(aldric);
  pkg.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = [];
  return pkg;
}

/** Lanzador de playtest falso con la forma del de 3.8 (web → Colyseus). */
function fakePlaytests(): PreviewPlaytestLauncher & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    async create(input) {
      created.push(input);
      return {
        playtestId: `pt-${created.length}`,
        token: `eyJ2IjoxfQ~firma-${created.length}`,
        expiresAt: Date.UTC(2030, 0, 1),
      };
    },
  };
}

async function setup(seed: RoomPackage = aldric) {
  const draftStore = createInMemoryRoomDraftStore([
    { id: ALDRIC_ROOM_ID, authorId: AUTHOR.userId },
    { id: FOREIGN_ROOM_ID, authorId: INTRUDER.userId },
  ]);
  const drafts = createRoomDraftService({ store: draftStore });
  const doc = roomPackageToDoc(seed);
  await drafts.appendUpdate(AUTHOR, ALDRIC_ROOM_ID, Y.encodeStateAsUpdate(doc));
  doc.destroy();

  const publishStore = createInMemoryRoomPublishStore([
    { id: ALDRIC_ROOM_ID, authorId: AUTHOR.userId, status: "draft" },
    { id: FOREIGN_ROOM_ID, authorId: INTRUDER.userId, status: "draft" },
  ]);
  const publish = createRoomPublishService({
    store: publishStore,
    drafts: draftStore,
    serializer: roomDocToPackage,
    assets: createUnavailablePublishAssetSource(),
    storage: createInMemoryPublishedAssetStorage(),
  });
  const confirmations = createPublishConfirmationService({
    publish,
    config: { secret: "secreto-de-test", ttlSeconds: 600 },
  });
  const playtests = fakePlaytests();

  const deps = (actor: Actor): CreatorMcpDeps => ({
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts,
    actor,
    roomDocToPackage,
    appUrl: APP_URL,
    playtests,
    publishRequests: confirmations,
  });
  return { deps, confirmations, publishStore, playtests };
}

async function connect(deps: CreatorMcpDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-4.5-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

/** Token de confirmación del enlace que devuelve `publish`. */
function confirmToken(result: ToolCall): string {
  const url = new URL(result.structured?.confirmUrl as string);
  expect(url.origin).toBe(APP_URL);
  expect(url.pathname).toBe("/es/publish-confirm");
  return url.searchParams.get("token")!;
}

async function confirmError(promise: Promise<unknown>): Promise<RoomPublishError> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(RoomPublishError);
  return error as RoomPublishError;
}

// Cada paso vuelve a correr el validador (~0,3 s en el Rey Aldric; CI es más lento).
const SLOW = { timeout: 30_000 };

describe("validate — checklist obligatoria de publicación", SLOW, () => {
  it("en verde: publicable, sin errores, con avisos y estimación", async () => {
    const { deps } = await setup();
    const client = await connect(deps(AUTHOR));
    const result = await call(client, "validate", { roomId });
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^📋 Checklist de publicación — 0 errores · \d+ avisos?/u);
    expect(result.text).toContain("✅ Publicable: llama a publish");
    expect(result.text).toMatch(/Estimación: ~\d+ min/u);
    expect(result.structured).toMatchObject({ ok: true, publishable: true, errors: [] });
    expect(result.structured?.estimate).toMatchObject({ minutes: expect.any(Number) });
  });

  it("en rojo: no publicable y lista los errores que bloquean", async () => {
    const { deps } = await setup(brokenAldric());
    const client = await connect(deps(AUTHOR));
    const result = await call(client, "validate", { roomId });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("⛔ No publicable");
    expect(result.text).toContain("Errores que bloquean la publicación:");
    const errors = result.structured?.errors as Array<{ check: string }>;
    expect(result.structured?.publishable).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((e) => e.check)).toContain("dead_ends");
  });
});

describe("preview — partida de prueba del playtest de 3.8", SLOW, () => {
  it("devuelve la URL del link de prueba en la web con el draft congelado", async () => {
    const { deps, playtests } = await setup();
    const client = await connect(deps(AUTHOR));
    const result = await call(client, "preview", { roomId });
    expect(result.isError).toBe(false);
    const url = new URL(result.structured?.url as string);
    expect(url.origin).toBe(APP_URL);
    expect(url.pathname).toBe(`/es/playtest/${encodeURIComponent("eyJ2IjoxfQ~firma-1")}`);
    expect(result.text).toContain(`✅ preview — partida de prueba lista: ${url.toString()}`);
    expect(result.structured).toMatchObject({
      playtestId: "pt-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    // El lanzador recibe el RoomPackage serializado del draft, con su autor.
    expect(playtests.created).toEqual([
      { roomPackage: parseRoomPackage(aldric), authorId: AUTHOR.userId, draftRoomId: roomId },
    ]);
  });

  it("solo el autor: el draft de otra persona no se previsualiza", async () => {
    const { deps, playtests } = await setup();
    const client = await connect(deps(AUTHOR));
    const result = await call(client, "preview", { roomId: FOREIGN_ROOM_ID });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("FORBIDDEN");
    expect(playtests.created).toHaveLength(0);
  });

  it("un draft que el servidor de partidas no puede jugar da un error accionable", async () => {
    const { deps } = await setup();
    const client = await connect({
      ...deps(AUTHOR),
      playtests: {
        async create() {
          throw Object.assign(new Error("sin regla de victoria"), { code: "UNPLAYABLE" });
        },
      },
    });
    const result = await call(client, "preview", { roomId });
    expect(errorCode(result)).toBe("INVALID_DRAFT");
    expect(result.text).toContain("sin regla de victoria");
  });
});

describe("publish — validador en verde + confirmación humana", SLOW, () => {
  it("falla si el validador no está en verde, con el informe, y no crea solicitud", async () => {
    const { deps, publishStore } = await setup(brokenAldric());
    const client = await connect(deps(AUTHOR));
    const result = await call(client, "publish", { roomId, versionNotes: "v1.0" });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("VALIDATION_FAILED");
    expect(result.text).toContain("la sala no pasa el validador");
    expect(result.text).toContain("⛔ No publicable");
    expect(result.text).toContain("Informe completo del validador:");
    const error = result.structured?.error as { publishable: boolean; errors: unknown[] };
    expect(error.publishable).toBe(false);
    expect(error.errors.length).toBeGreaterThan(0);
    expect(result.structured?.confirmUrl).toBeUndefined();
    expect(await publishStore.listVersions(roomId)).toEqual([]);
  });

  it("en verde NO publica: crea la solicitud; solo al confirmar se crea la roomVersion", async () => {
    const { deps, confirmations, publishStore } = await setup();
    const client = await connect(deps(AUTHOR));
    const result = await call(client, "publish", {
      roomId,
      versionNotes: "v1.0 — sala inicial",
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("⏸️ publish — solicitud creada; la sala NO se ha publicado");
    expect(result.structured).toMatchObject({
      status: "pending_confirmation",
      published: false,
      nextSemver: "1.0.0",
      latestSemver: null,
    });
    // Nada publicado todavía.
    expect(await publishStore.listVersions(roomId)).toEqual([]);
    expect(publishStore.rooms.get(roomId)?.status).toBe("draft");

    // El humano confirma en la web con su sesión.
    const token = confirmToken(result);
    const published = await confirmations.confirm(AUTHOR, token);
    expect(published.version).toMatchObject({ semver: "1.0.0", changelog: "v1.0 — sala inicial" });
    const versions = await publishStore.listVersions(roomId);
    expect(versions.map((v) => v.semver)).toEqual(["1.0.0"]);
    expect(publishStore.rooms.get(roomId)?.status).toBe("published");

    // Un solo uso: el mismo enlace no publica otra versión.
    const again = await confirmError(confirmations.confirm(AUTHOR, token));
    expect(again.code).toBe("VERSION_CHANGED");
    expect(await publishStore.listVersions(roomId)).toHaveLength(1);
  });

  it("si el draft cambia entre la solicitud y la confirmación, la confirmación se rechaza", async () => {
    const { deps, confirmations, publishStore } = await setup();
    const client = await connect(deps(AUTHOR));
    const requested = await call(client, "publish", { roomId, versionNotes: "v1.0" });
    const token = confirmToken(requested);

    // El agente sigue editando tras pedir la publicación.
    const edit = await call(client, "add_dialog", {
      roomId,
      dialog: { id: "d-epilogo", text: { es: { text: "Fin." } } },
    });
    expect(edit.isError, edit.text).toBe(false);

    const inspected = await confirmations.inspect(AUTHOR, token);
    expect(inspected).toMatchObject({ status: "stale", reason: "DRAFT_CHANGED" });
    const rejected = await confirmError(confirmations.confirm(AUTHOR, token));
    expect(rejected.code).toBe("DRAFT_CHANGED");
    expect(await publishStore.listVersions(roomId)).toEqual([]);

    // Una solicitud nueva sobre el draft actual sí se confirma.
    const retry = await call(client, "publish", { roomId, versionNotes: "v1.0" });
    const published = await confirmations.confirm(AUTHOR, confirmToken(retry));
    expect(published.version.semver).toBe("1.0.0");
  });

  it("solo el autor: ni pide publicar un draft ajeno ni confirma la solicitud de otro", async () => {
    const { deps, confirmations, publishStore } = await setup();
    const intruder = await connect(deps(INTRUDER));
    const foreign = await call(intruder, "publish", { roomId, versionNotes: "v1.0" });
    expect(foreign.isError).toBe(true);
    expect(errorCode(foreign)).toBe("FORBIDDEN");

    const author = await connect(deps(AUTHOR));
    const token = confirmToken(await call(author, "publish", { roomId, versionNotes: "v1.0" }));
    await expect(confirmations.confirm(INTRUDER, token)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await publishStore.listVersions(roomId)).toEqual([]);
  });

  it("las notas de versión son obligatorias", async () => {
    const { deps } = await setup();
    const client = await connect(deps(AUTHOR));
    const result = await call(client, "publish", { roomId, versionNotes: "   " });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("versionNotes");
  });
});
