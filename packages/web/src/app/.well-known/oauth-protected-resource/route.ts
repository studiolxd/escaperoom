import { getMcpOAuthHandlers } from "@/server/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Metadata del recurso protegido `/mcp/creator` (RFC 9728, ticket 4.7) en la
 * raíz: la consultan los clientes que no insertan la ruta del recurso.
 */
export function GET(request: Request) {
  return getMcpOAuthHandlers().protectedResourceMetadata(request);
}

export function OPTIONS() {
  return getMcpOAuthHandlers().options();
}
