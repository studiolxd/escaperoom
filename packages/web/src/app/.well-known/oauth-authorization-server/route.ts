import { getMcpOAuthHandlers } from "@/server/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Metadata del servidor de autorización OAuth del MCP (RFC 8414, ticket 4.7). */
export function GET(request: Request) {
  return getMcpOAuthHandlers().authorizationServerMetadata(request);
}

export function OPTIONS() {
  return getMcpOAuthHandlers().options();
}
