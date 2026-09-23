import { isAnonymous, type Actor } from "@escaperoom/shared/services";

/**
 * Identidad del MCP del creador:
 *
 * - **stdio** (Claude Desktop, desarrollo): variables de entorno documentadas en
 *   el README (`actorFromEnv`). No apto para producción: quien lanza el proceso
 *   decide la identidad.
 * - **HTTP** (`/mcp/creator`): `Authorization: Bearer` con un access token del
 *   OAuth 2.1 del ticket 4.7 (`src/oauth`, login resuelto contra Better Auth) o,
 *   para el chat web integrado, la cookie de sesión de Better Auth. Lo resuelve
 *   quien monta el transporte (`HttpAuthenticator`).
 *
 * En ambos casos las tools reciben el mismo `Actor` (ADR-010/022).
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

/** Identidad resuelta de una petición HTTP. */
export type HttpIdentity = {
  actor: Actor;
  /**
   * Clave del rate limit (4.7): la autorización OAuth (`grant:<id>`) o el
   * usuario de la sesión. Por defecto, `user:<userId>`.
   */
  rateLimitKey?: string;
};

/** Credencial presentada pero no válida (token caducado, revocado, desconocido). */
export type HttpAuthError = { error: "invalid_token"; description: string };

/**
 * Resuelve la identidad de una petición HTTP. `null` (o un actor anónimo) =
 * sin credenciales: 401 con `WWW-Authenticate` apuntando a la metadata del
 * recurso protegido para que el cliente MCP inicie el flujo OAuth.
 */
export type HttpAuthenticator = (
  request: Request,
) => Promise<Actor | HttpIdentity | HttpAuthError | null>;

/** Normaliza lo que devuelve un `HttpAuthenticator`. */
export function resolveHttpAuth(
  result: Actor | HttpIdentity | HttpAuthError | null,
): { ok: true; actor: Actor; rateLimitKey: string } | { ok: false; error?: HttpAuthError } {
  if (!result) return { ok: false };
  if ("error" in result) return { ok: false, error: result };
  const identity: HttpIdentity = "actor" in result ? result : { actor: result };
  if (!hasIdentity(identity.actor)) return { ok: false };
  return {
    ok: true,
    actor: identity.actor,
    rateLimitKey: identity.rateLimitKey ?? `user:${identity.actor.userId}`,
  };
}

/** `true` si hay un creador identificado detrás de la llamada. */
export function hasIdentity(actor: Actor | null | undefined): actor is Actor {
  return !!actor && !isAnonymous(actor);
}

/** Las cabeceras HTTP solo admiten ASCII seguro: sin tildes ni comillas. */
function headerSafe(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]|"/g, "");
}

/**
 * 401 del transporte HTTP (spec de autorización de MCP, RFC 6750 §3 y RFC 9728
 * §5.1): `WWW-Authenticate: Bearer` con `resource_metadata` —el cliente MCP
 * descubre desde ahí el servidor de autorización— y, si se presentó un token
 * no válido, `error="invalid_token"`.
 */
export function unauthorizedResponse(
  options: { resourceMetadataUrl?: string; scope?: string; error?: HttpAuthError } = {},
): Response {
  const params = ['realm="escaperoom-creator"'];
  if (options.resourceMetadataUrl)
    params.push(`resource_metadata="${options.resourceMetadataUrl}"`);
  if (options.scope) params.push(`scope="${options.scope}"`);
  if (options.error) {
    params.push(`error="${options.error.error}"`);
    params.push(`error_description="${headerSafe(options.error.description)}"`);
  }
  const message = options.error
    ? `No autenticado: ${options.error.description}`
    : "No autenticado: el MCP del creador requiere un token OAuth (o sesión)";
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer ${params.join(", ")}`,
      },
    },
  );
}
