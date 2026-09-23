import { getMcpOAuthHandlers } from "@/server/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revocación de tokens del MCP (RFC 7009, ticket 4.7): revoca la autorización entera. */
export function POST(request: Request) {
  return getMcpOAuthHandlers().revoke(request);
}

export function OPTIONS() {
  return getMcpOAuthHandlers().options();
}
