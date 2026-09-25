import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createCatalogService,
  createInMemoryReviewStore,
  createInMemoryRoomPackageRepository,
  createReviewService,
  type Actor,
  type FeaturedRoom,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createFeaturedRoomHandler } from "../src/server/rest/featured-room";
import { appRouter } from "../src/server/routers/_app";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function loadFixture(): unknown {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
}

const actor: Actor = {
  userId: "user-42",
  organizationId: "org-escapehub-official",
  role: "member",
};

/**
 * UN solo servicio (sin base de datos) inyectado en las tres puertas. La
 * paridad del DoD es que tRPC, REST y MCP devuelvan exactamente lo mismo.
 */
const catalog = createCatalogService({
  rooms: createInMemoryRoomPackageRepository(loadFixture()),
});

async function viaTrpc(): Promise<FeaturedRoom> {
  const caller = appRouter.createCaller({
    actor,
    catalog,
    reviews: createReviewService({ store: createInMemoryReviewStore({ rooms: [] }) }),
  });
  return caller.catalog.getFeaturedRoom();
}

async function viaRest(): Promise<FeaturedRoom> {
  const GET = createFeaturedRoomHandler({
    catalog,
    resolveActor: async () => actor,
  });
  const response = await GET(new Request("http://localhost/api/rooms/featured"));
  expect(response.status).toBe(200);
  return (await response.json()) as FeaturedRoom;
}

/**
 * Paridad tRPC == REST del ticket 0.10. La tercera puerta era la tool de
 * ejemplo del MCP (`get_featured_room`), retirada del toolset de producción
 * (D-28, auditoría 2026-09-24): no servía para crear salas y solo
 * demostraba la paridad, ya cubierta por estas dos.
 */
describe("paridad de puertas: tRPC == REST (mismo servicio, sin BD)", () => {
  it("las dos puertas devuelven el mismo resultado", async () => {
    const [trpc, rest] = await Promise.all([viaTrpc(), viaRest()]);

    expect(trpc).toEqual(rest);
    expect(trpc).toEqual(await catalog.getFeaturedRoom(actor));
  });

  it("expone la sala del Rey Aldric con el actor embebido", async () => {
    const room = await viaTrpc();
    expect(room.id).toBe("room-rey-aldric");
    expect(room.viewer).toEqual({
      userId: "user-42",
      organizationId: "org-escapehub-official",
      role: "member",
    });
  });
});
