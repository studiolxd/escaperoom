import { getMcpOAuthHandlers } from "@/server/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Endpoint de token OAuth del MCP (ticket 4.7): `authorization_code` con PKCE y `refresh_token` con rotación. */
export function POST(request: Request) {
  return getMcpOAuthHandlers().token(request);
}

export function OPTIONS() {
  return getMcpOAuthHandlers().options();
}
