import type { Actor, CatalogService, FeaturedRoom } from "@escaperoom/shared/services";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Endpoint del MCP del creador (ADR-010); el transporte completo llega en Fase 4. */
export const MCP_ENDPOINT = "/mcp/creator" as const;

/** Nombre de la tool de ejemplo del ticket 0.10. */
export const GET_FEATURED_ROOM_TOOL = "get_featured_room" as const;

/** Dependencias inyectables del MCP: el mismo servicio de dominio y un actor. */
export type CreatorMcpDeps = {
  catalog: CatalogService;
  actor: Actor;
};

/**
 * Servidor MCP mínimo del creador (ticket 0.10): una sola tool que llama al
 * servicio de dominio compartido, sin reimplementar lógica (ADR-010/022). El
 * toolset completo y el OAuth 2.1 son Fase 4.
 */
export function createCreatorMcpServer(deps: CreatorMcpDeps): McpServer {
  const server = new McpServer({ name: "escaperoom-creator", version: "0.0.0" });

  server.registerTool(
    GET_FEATURED_ROOM_TOOL,
    {
      title: "Sala destacada",
      description:
        "Devuelve la sala destacada del catálogo (La Maldición del Rey Aldric) usando el servicio de dominio compartido.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (): Promise<CallToolResult> => {
      const room: FeaturedRoom = await deps.catalog.getFeaturedRoom(deps.actor);
      return { content: [{ type: "text", text: JSON.stringify(room) }] };
    },
  );

  return server;
}
