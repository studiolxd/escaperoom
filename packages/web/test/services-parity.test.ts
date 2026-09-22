import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GET_FEATURED_ROOM_TOOL, createCreatorMcpServer } from "@escaperoom/mcp-server";
import {
  createCatalogService,
  createInMemoryRoomPackageRepository,
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
  const caller = appRouter.createCaller({ actor, catalog });
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

async function viaMcp(): Promise<FeaturedRoom> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer({ catalog, actor });
  const client = new Client({ name: "parity-test", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: GET_FEATURED_ROOM_TOOL, arguments: {} });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("la tool MCP no devolvió contenido de texto");
    return JSON.parse(text) as FeaturedRoom;
  } finally {
    await client.close();
    await server.close();
  }
}

describe("paridad de puertas: tRPC == REST == MCP (mismo servicio, sin BD)", () => {
  it("las tres puertas devuelven el mismo resultado", async () => {
    const [trpc, rest, mcp] = await Promise.all([viaTrpc(), viaRest(), viaMcp()]);

    expect(trpc).toEqual(rest);
    expect(rest).toEqual(mcp);
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
