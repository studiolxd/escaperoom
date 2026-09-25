import {
  readGameAccessTokenConfig,
  signGameAccessToken,
  type GameAccessClaims,
} from "@escaperoom/shared/game-access-token";

/**
 * Firma un `gameToken` de prueba con el secreto de desarrollo (activo bajo
 * `NODE_ENV=test`, ver `isDevFallbackAllowed`): lo que la `GameRoom` real
 * exige desde C-4/B-4 para `create`/`join`.
 */
export function testGameToken(claims: GameAccessClaims, ttlMs = 15 * 60 * 1000): string {
  const config = readGameAccessTokenConfig();
  if (!config) throw new Error("testGameToken: sin GAME_ACCESS_TOKEN_SECRET ni fallback de desarrollo");
  const now = Date.now();
  return signGameAccessToken(config.secret, claims, { now, expiresAt: now + ttlMs });
}

/** Token de partida de prueba (dev/test, sin compra): el que usan la mayoría de los tests. */
export function devTestGameToken(label = "test"): string {
  return testGameToken({ kind: "dev_test", label });
}
