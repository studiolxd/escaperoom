import { getMcpOAuthHandlers } from "@/server/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Registro dinámico de clientes MCP (RFC 7591, ticket 4.7). */
export function POST(request: Request) {
  return getMcpOAuthHandlers().register(request);
}

export function OPTIONS() {
  return getMcpOAuthHandlers().options();
}
