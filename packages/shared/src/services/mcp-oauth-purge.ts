/**
 * Purga de las filas caducadas del OAuth del MCP (A-15, ticket 4.7) en
 * `verification` (tabla compartida con los magic links y el resto de Better
 * Auth): códigos de autorización, access/refresh tokens, marcas de refresh
 * usado y de grant revocado (`server/mcp-oauth-store.ts`,
 * `MCP_OAUTH_IDENTIFIER_PREFIX`). Nada las purga hoy — Better Auth solo
 * gestiona sus propias filas —, así que crecen sin límite mientras se usa el
 * MCP. `expiresAt < now()` es idempotente (una fila caducada ya no la lee ni
 * `get` ni `take`), así que solaparse o repetir una pasada es inocuo.
 */

/** Prefijo de las filas del OAuth del MCP en `verification` (igual que en el store del proveedor). */
export const MCP_OAUTH_PURGE_IDENTIFIER_PREFIX = "mcp-oauth:";

export interface McpOAuthPurgeStore {
  /** Borra las filas `mcp-oauth:*` de `verification` caducadas antes de `now`. */
  purgeExpired(now: Date): Promise<number>;
}

/** Una pasada del job; delega toda la selección al store (SQL o memoria). */
export function purgeExpiredMcpOAuthRows(
  store: McpOAuthPurgeStore,
  now: Date = new Date(),
): Promise<number> {
  return store.purgeExpired(now);
}
