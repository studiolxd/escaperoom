import type { HttpAuthError, HttpIdentity } from "../auth";
import type { OAuthProvider } from "./provider";

/** Token de `Authorization: Bearer <token>`, o `null` si la petición no trae uno. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] ?? null;
}

/**
 * Autentica una petición del transporte HTTP con un access token OAuth del
 * `provider`. `null` si no hay Bearer (quien llama puede probar la sesión);
 * un `HttpAuthError` si lo hay pero no vale (401 `invalid_token`). La clave
 * del rate limit es la autorización (familia de tokens), no el token suelto:
 * refrescar no reinicia el contador.
 */
export async function authenticateOAuthBearer(
  provider: OAuthProvider,
  request: Request,
): Promise<HttpIdentity | HttpAuthError | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const check = await provider.verifyAccessToken(token);
  if (!check.ok) return { error: check.error, description: check.description };
  return { actor: check.actor, rateLimitKey: `grant:${check.grantId}` };
}
