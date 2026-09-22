import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ANONYMOUS_ACTOR,
  type CatalogService,
  type FeaturedRoom,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { GET_FEATURED_ROOM_TOOL, MCP_ENDPOINT, createCreatorMcpServer } from "../src";

const room: FeaturedRoom = {
  id: "room-rey-aldric",
  title: "La Maldición del Rey Aldric",
  description: "…",
  theme: "medieval",
  version: "1.0.0",
  packageFormat: "1",
  difficulty: 2,
  languages: ["es"],
  defaultLanguage: "es",
  estimatedMinutes: 55,
  players: { min: 1, max: 4 },
  counts: { rooms: 3, puzzles: 9 },
  viewer: { userId: "anonymous", organizationId: null, role: "anonymous" },
};

const catalog: CatalogService = { getFeaturedRoom: async () => room };

describe("mcp-server", () => {
  it("expone el endpoint del conector del creador", () => {
    expect(MCP_ENDPOINT).toBe("/mcp/creator");
  });

  it("la tool get_featured_room llama al servicio y devuelve su resultado", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createCreatorMcpServer({ catalog, actor: ANONYMOUS_ACTOR });
    const client = new Client({ name: "mcp-test", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: GET_FEATURED_ROOM_TOOL, arguments: {} });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find((block) => block.type === "text")?.text;
      expect(text).toBeDefined();
      expect(JSON.parse(text as string)).toEqual(room);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
