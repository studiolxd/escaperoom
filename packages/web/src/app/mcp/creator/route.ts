import { createCreatorMcpServer } from "@escaperoom/mcp-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveActorFromRequest } from "@/server/context";
import { getCatalogService } from "@/server/services";

export const runtime = "nodejs";

/**
 * MCP del creador en `/mcp/creator` (HTTP streamable, sin sesión) — mínimo del
 * ticket 0.10. Sus tools llaman a los mismos servicios de dominio que tRPC y
 * REST (ADR-010/022); el OAuth 2.1 completo es Fase 4.
 */
async function handler(request: Request): Promise<Response> {
  const actor = await resolveActorFromRequest(request);
  const server = createCreatorMcpServer({ catalog: getCatalogService(), actor });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export { handler as GET, handler as POST, handler as DELETE };
