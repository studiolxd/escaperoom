import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_ENV } from "../src";
import { call, errorCode } from "./fixtures/client";
import { ALDRIC_ROOM_ID, AUTHOR } from "./fixtures/drafts";
import { toolsetContract } from "./fixtures/toolset-contract";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

/** Arranca `script` como proceso hijo por stdio, igual que Claude Desktop. */
async function spawnStdio(script: string, env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: tsx,
    args: [script],
    cwd: packageDir,
    env: { PATH: process.env.PATH ?? "", ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("transporte stdio", () => {
  let client: Client;
  beforeAll(async () => {
    client = await spawnStdio("test/fixtures/stdio-server.ts", { [MCP_ENV.userId]: AUTHOR.userId });
  }, 30_000);
  afterAll(async () => {
    await client?.close();
  });

  toolsetContract(() => client);

  it("sin identidad en el entorno, las tools devuelven error de auth", async () => {
    const anonymous = await spawnStdio("test/fixtures/stdio-server.ts", {});
    try {
      const result = await call(anonymous, "get_room", { roomId: ALDRIC_ROOM_ID });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("UNAUTHORIZED");
    } finally {
      await anonymous.close();
    }
  }, 30_000);

  it("el punto de entrada real (src/bin/stdio.ts) arranca y lista el toolset", async () => {
    const real = await spawnStdio("src/bin/stdio.ts", {
      [MCP_ENV.userId]: AUTHOR.userId,
      // No se consulta la BD: listar tools no toca Postgres.
      DATABASE_URL: "postgresql://nadie:nada@127.0.0.1:1/escaperoom",
    });
    try {
      const { tools } = await real.listTools();
      expect(tools.map((tool) => tool.name)).toContain("get_room");
    } finally {
      await real.close();
    }
  }, 30_000);
});
