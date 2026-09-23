import { ANONYMOUS_ACTOR } from "@escaperoom/shared/services";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { hasIdentity } from "./auth";
import type { CreatorMcpDeps } from "./deps";
import { errorResult, notImplementedResult, ToolError } from "./results";
import { CREATOR_TOOLSET, type CreatorTool } from "./tools";

/** Endpoint HTTP del MCP del creador (ADR-010). */
export const MCP_ENDPOINT = "/mcp/creator" as const;

export const MCP_SERVER_INFO = { name: "escaperoom-creator", version: "0.1.0" } as const;

/** Nombre de la tool de ejemplo del ticket 0.10. */
export const GET_FEATURED_ROOM_TOOL = "get_featured_room" as const;

/**
 * Ejecuta una tool con la política común: identidad obligatoria (salvo
 * consultas públicas), "no implementado" para el esqueleto y traducción de
 * errores de dominio a resultados legibles con `isError`.
 */
async function runTool(
  tool: CreatorTool,
  input: unknown,
  deps: CreatorMcpDeps,
): Promise<CallToolResult> {
  const actor = deps.actor;
  const requiresIdentity = tool.requiresIdentity ?? true;
  if (requiresIdentity && !hasIdentity(actor)) {
    return errorResult(
      tool.name,
      "UNAUTHORIZED",
      "sin identidad de creador. En stdio, define ESCAPEROOM_MCP_USER_ID; por HTTP, inicia sesión.",
    );
  }
  if (!tool.run) return notImplementedResult(tool.name, tool.ticket);
  try {
    return await tool.run(input as never, {
      actor: actor ?? ANONYMOUS_ACTOR,
      deps,
    });
  } catch (error) {
    if (error instanceof ToolError) {
      return errorResult(tool.name, error.code, error.message, error.details);
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(tool.name, "INTERNAL", message);
  }
}

/**
 * Servidor MCP del creador: registra el toolset de specs/10 §2 sobre los
 * mismos servicios de dominio que tRPC y REST (ADR-010/022). Es independiente
 * del transporte: stdio (`runStdioServer`), HTTP Node (`startHttpServer`) o la
 * ruta de Next (`/mcp/creator`) lo conectan igual.
 */
export function createCreatorMcpServer(deps: CreatorMcpDeps): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions:
      "MCP del creador de escape rooms: construye y edita salas en borrador (draft) con las mismas reglas que el editor visual. Empieza por get_room y valida con validate.",
  });

  for (const tool of CREATOR_TOOLSET) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        _meta: { "escaperoom/phase": tool.phase, "escaperoom/ticket": tool.ticket },
      },
      (input: unknown) => runTool(tool, input, deps),
    );
  }

  return server;
}
