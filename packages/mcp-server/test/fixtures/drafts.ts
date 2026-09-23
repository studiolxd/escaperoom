import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createCatalogService,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import * as Y from "yjs";
import type { CreatorMcpDeps, DraftDoc, RoomDocToPackage } from "../../src";

/** Sala del Rey Aldric en borrador, de la autora de test. */
export const ALDRIC_ROOM_ID = "11111111-1111-4111-8111-111111111111";
/** Draft cuyo contenido aún no es un RoomPackage válido. */
export const BROKEN_ROOM_ID = "22222222-2222-4222-8222-222222222222";
/** Sala de otra persona: la autora no puede leerla. */
export const FOREIGN_ROOM_ID = "33333333-3333-4333-8333-333333333333";

export const AUTHOR: Actor = { userId: "autora-test", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

export function loadAldric(): unknown {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
}

/**
 * Sustituto de TEST de la conversión doc Yjs → RoomPackage del ticket 3.1: el
 * draft guarda el RoomPackage entero como JSON en un mapa. La conversión real
 * se inyecta cuando 3.1 se publique; el MCP no depende de su forma.
 */
const TEST_MAP = "test-roompackage";
export const testRoomDocToPackage: RoomDocToPackage = (doc: DraftDoc) => {
  const json = doc.getMap<string>(TEST_MAP).get("json");
  return json === undefined ? {} : (JSON.parse(json) as unknown);
};

function encodePackage(pkg: unknown): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap<string>(TEST_MAP).set("json", JSON.stringify(pkg));
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/** Servicios en memoria (sin BD) con los drafts de test ya sembrados. */
export async function createTestDeps(
  actor: Actor | null,
  opts: { withCodec?: boolean } = {},
): Promise<CreatorMcpDeps> {
  const store = createInMemoryRoomDraftStore([
    { id: ALDRIC_ROOM_ID, authorId: AUTHOR.userId },
    { id: BROKEN_ROOM_ID, authorId: AUTHOR.userId },
    { id: FOREIGN_ROOM_ID, authorId: "otra-persona" },
  ]);
  const drafts = createRoomDraftService({ store });
  await drafts.appendUpdate(AUTHOR, ALDRIC_ROOM_ID, encodePackage(loadAldric()));
  await drafts.appendUpdate(AUTHOR, BROKEN_ROOM_ID, encodePackage({ meta: { title: "" } }));
  return {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts,
    actor,
    ...(opts.withCodec === false ? {} : { roomDocToPackage: testRoomDocToPackage }),
  };
}
