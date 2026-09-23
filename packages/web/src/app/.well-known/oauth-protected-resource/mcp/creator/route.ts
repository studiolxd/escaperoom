import { getMcpOAuthHandlers } from "@/server/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Metadata del recurso protegido `/mcp/creator` (RFC 9728 §3.1, ruta
 * insertada): la anuncia el 401 del MCP en `WWW-Authenticate` (ticket 4.7).
 */
export function GET(request: Request) {
  return getMcpOAuthHandlers().protectedResourceMetadata(request);
}

export function OPTIONS() {
  return getMcpOAuthHandlers().options();
}
