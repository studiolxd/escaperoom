import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ANONYMOUS_ACTOR, type Actor } from "@escaperoom/shared/services";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CREATOR_TOOLSET,
  GET_FEATURED_ROOM_TOOL,
  MCP_ENDPOINT,
  actorFromEnv,
  createCreatorMcpServer,
  type CreatorMcpDeps,
} from "../src";
import { call, errorCode } from "./fixtures/client";
import {
  ALDRIC_ROOM_ID,
  AUTHOR,
  BROKEN_ROOM_ID,
  FOREIGN_ROOM_ID,
  createTestDeps,
} from "./fixtures/drafts";
import { toolsetContract } from "./fixtures/toolset-contract";

async function connect(deps: CreatorMcpDeps) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function withClient<T>(
  actor: Actor | null,
  fn: (client: Client) => Promise<T>,
  opts?: { withCodec?: boolean },
): Promise<T> {
  const { client, close } = await connect(await createTestDeps(actor, opts));
  try {
    return await fn(client);
  } finally {
    await close();
  }
}

describe("mcp-server en memoria", () => {
  let session: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    session = await connect(await createTestDeps(AUTHOR));
  });
  afterEach(async () => {
    await session.close();
  });

  toolsetContract(() => session.client);

  it("expone el endpoint del conector del creador", () => {
    expect(MCP_ENDPOINT).toBe("/mcp/creator");
  });

  it("4.1 implementa get_room y validate (más la tool de 0.10); el resto llega en 4.2–4.5", () => {
    const implemented = CREATOR_TOOLSET.filter((tool) => tool.run && tool.ticket !== "4.2").map(
      (tool) => tool.name,
    );
    expect(implemented).toEqual(["validate", "get_room", GET_FEATURED_ROOM_TOOL]);
  });

  it("valida la entrada con los esquemas Zod compartidos", async () => {
    const result = await call(session.client, "add_puzzle", {
      roomId: ALDRIC_ROOM_ID,
      puzzle: { id: "p1", type: "no_existe" },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/validation/i);
  });

  it("un draft que aún no es RoomPackage devuelve INVALID_DRAFT legible", async () => {
    const result = await call(session.client, "get_room", { roomId: BROKEN_ROOM_ID });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("INVALID_DRAFT");
    expect(result.text).toContain("el draft no es un RoomPackage válido");
  });

  it("aplica la autorización del servicio del draft: no se leen salas ajenas", async () => {
    const result = await call(session.client, "get_room", { roomId: FOREIGN_ROOM_ID });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("FORBIDDEN");
  });

  it("la tool de 0.10 sigue llamando al servicio de catálogo", async () => {
    const result = await call(session.client, GET_FEATURED_ROOM_TOOL);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ id: "room-rey-aldric", viewer: AUTHOR });
  });
});

describe("auth del MCP", () => {
  it.each([
    ["sin actor", null],
    ["con actor anónimo", ANONYMOUS_ACTOR],
  ])("%s, las tools del creador devuelven error de auth", async (_label, actor) => {
    await withClient(actor, async (client) => {
      for (const name of ["get_room", "validate", "preview"]) {
        const result = await call(client, name, { roomId: ALDRIC_ROOM_ID });
        expect(result.isError).toBe(true);
        expect(errorCode(result)).toBe("UNAUTHORIZED");
      }
      // La consulta pública del catálogo (0.10) no exige identidad.
      expect((await call(client, GET_FEATURED_ROOM_TOOL)).isError).toBe(false);
    });
  });

  it("actorFromEnv lee la identidad de desarrollo de stdio", () => {
    expect(actorFromEnv({})).toBeNull();
    expect(actorFromEnv({ ESCAPEROOM_MCP_USER_ID: "  " })).toBeNull();
    expect(
      actorFromEnv({ ESCAPEROOM_MCP_USER_ID: "u1", ESCAPEROOM_MCP_ORGANIZATION_ID: "org-1" }),
    ).toEqual({ userId: "u1", organizationId: "org-1", role: "member" });
  });
});

describe("sin la conversión doc Yjs → RoomPackage (3.1)", () => {
  it("get_room avisa de que no está disponible", async () => {
    await withClient(
      AUTHOR,
      async (client) => {
        const result = await call(client, "get_room", { roomId: ALDRIC_ROOM_ID });
        expect(result.isError).toBe(true);
        expect(errorCode(result)).toBe("NOT_AVAILABLE");
        expect(result.text).toContain("ticket 3.1");
      },
      { withCodec: false },
    );
  });
});
