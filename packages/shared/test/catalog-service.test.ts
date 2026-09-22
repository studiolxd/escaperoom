import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  actorFromSession,
  createCatalogService,
  createInMemoryRoomPackageRepository,
  createJsonFileRoomPackageRepository,
  isAnonymous,
  type Actor,
} from "../src/services";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function loadFixture(): unknown {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
}

const member: Actor = { userId: "u1", organizationId: "o1", role: "member" };

describe("catalogService.getFeaturedRoom", () => {
  it("lee y valida el fixture del Rey Aldric desde fichero (sin base de datos)", async () => {
    const service = createCatalogService({
      rooms: createJsonFileRoomPackageRepository(fixturePath),
    });

    const room = await service.getFeaturedRoom(member);

    expect(room.id).toBe("room-rey-aldric");
    expect(room.title).toBe("La Maldición del Rey Aldric");
    expect(room.difficulty).toBe(2);
    expect(room.languages).toEqual(["es"]);
    expect(room.players).toEqual({ min: 1, max: 4 });
    expect(room.counts).toEqual({ rooms: 3, puzzles: 9 });
  });

  it("embebe el actor que invoca el servicio", async () => {
    const service = createCatalogService({
      rooms: createInMemoryRoomPackageRepository(loadFixture()),
    });

    const room = await service.getFeaturedRoom(member);
    expect(room.viewer).toEqual({ userId: "u1", organizationId: "o1", role: "member" });

    const guest = await service.getFeaturedRoom(ANONYMOUS_ACTOR);
    expect(guest.viewer).toEqual({ userId: "anonymous", organizationId: null, role: "anonymous" });
  });

  it("rechaza un paquete inválido al construir el repositorio", () => {
    expect(() => createInMemoryRoomPackageRepository({ meta: {} })).toThrow();
  });
});

describe("actorFromSession", () => {
  it("sin sesión devuelve el actor anónimo", () => {
    expect(actorFromSession(null)).toEqual(ANONYMOUS_ACTOR);
    expect(isAnonymous(actorFromSession(undefined))).toBe(true);
  });

  it("con sesión deriva userId y organización activa", () => {
    expect(
      actorFromSession({
        user: { id: "u1" },
        session: { activeOrganizationId: "o1" },
      }),
    ).toEqual({ userId: "u1", organizationId: "o1", role: "member" });
  });
});
