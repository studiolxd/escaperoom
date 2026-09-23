import { isAnonymous, type Actor } from "@escaperoom/shared/services";

/**
 * Identidad del MCP del creador. Es el punto de enganche del OAuth 2.1 del
 * ticket 4.7 (`@slxd/mcp-auth` resuelto contra Better Auth): hoy la identidad
 * llega por dos vías sin OAuth —
 *
 * - **stdio** (Claude Desktop, desarrollo): variables de entorno documentadas en
 *   el README (`actorFromEnv`).
 * - **HTTP** (`/mcp/creator`, chat web): la sesión de Better Auth de la
 *   petición, que resuelve quien monta el transporte (`HttpAuthenticator`).
 *
 * Cuando llegue 4.7, el `HttpAuthenticator` validará el Bearer de OAuth y
 * devolverá el mismo `Actor`: las tools no cambian (ADR-010/022).
 */

/** Variables de entorno de la identidad de desarrollo por stdio. */
export const MCP_ENV = {
  userId: "ESCAPEROOM_MCP_USER_ID",
  organizationId: "ESCAPEROOM_MCP_ORGANIZATION_ID",
  /** Origen de la web para los enlaces de `publish` (por defecto `http://localhost:3000`). */
  appUrl: "ESCAPEROOM_APP_URL",
} as const;

/**
 * Actor de desarrollo para stdio. Sin `ESCAPEROOM_MCP_USER_ID` devuelve `null`
 * (sin identidad): el servidor arranca igual y cada tool responde con el error
 * de auth, para que el creador lo vea en Claude Desktop.
 */
export function actorFromEnv(env: NodeJS.ProcessEnv = process.env): Actor | null {
  const userId = env[MCP_ENV.userId]?.trim();
  if (!userId) return null;
  return {
    userId,
    organizationId: env[MCP_ENV.organizationId]?.trim() || null,
    role: "member",
  };
}

/**
 * Resuelve el actor de una petición HTTP. `null` = sin identidad: el
 * transporte responde 401 con `WWW-Authenticate` (donde 4.7 anunciará el
 * servidor de autorización OAuth).
 */
export type HttpAuthenticator = (request: Request) => Promise<Actor | null>;

/** `true` si hay un creador identificado detrás de la llamada. */
export function hasIdentity(actor: Actor | null | undefined): actor is Actor {
  return !!actor && !isAnonymous(actor);
}

/** Cuerpo JSON-RPC y cabeceras del 401 del transporte HTTP sin identidad. */
export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "No autenticado: el MCP del creador requiere sesión" },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="escaperoom-creator"',
      },
    },
  );
}
