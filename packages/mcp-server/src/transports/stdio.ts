import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreatorMcpDeps } from "../deps";
import { createCreatorMcpServer } from "../server";

/**
 * Conecta el MCP del creador por stdio (Claude Desktop). La identidad llega en
 * `deps.actor` (en desarrollo, `actorFromEnv`). stdout es el canal del
 * protocolo: cualquier log debe ir a stderr.
 */
export async function runStdioServer(
  deps: CreatorMcpDeps,
  io: { stdin?: Readable; stdout?: Writable } = {},
): Promise<McpServer> {
  const server = createCreatorMcpServer(deps);
  await server.connect(new StdioServerTransport(io.stdin, io.stdout));
  return server;
}
