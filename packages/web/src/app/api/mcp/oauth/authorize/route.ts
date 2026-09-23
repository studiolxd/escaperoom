import { getMcpOAuthHandlers } from "@/server/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint de autorización OAuth del MCP (ticket 4.7). `GET`: el cliente MCP
 * abre aquí el navegador y se redirige a la pantalla de consentimiento.
 * `POST`: la decisión del creador desde ese formulario (sesión de Better Auth).
 */
export function GET(request: Request) {
  return getMcpOAuthHandlers().authorize(request);
}

export function POST(request: Request) {
  return getMcpOAuthHandlers().decide(request);
}
