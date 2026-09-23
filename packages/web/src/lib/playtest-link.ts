/**
 * Link de prueba del playtest (ticket 3.8, specs/09 §3): `/{locale}/playtest/{token}`.
 *
 * El token lo firma el servidor de Colyseus (HMAC con `PLAYTEST_SECRET`) y solo
 * él lo verifica al entrar. Aquí únicamente se **lee** su payload (id del
 * playtest y caducidad) para emparejar la room y avisar de un link caducado
 * sin conectar; leerlo no concede nada.
 */

export interface PlaytestLinkPayload {
  playtestId: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** Ruta (sin locale) de la página de juego del playtest. */
export function playtestPath(token: string): string {
  return `/playtest/${encodeURIComponent(token)}`;
}

/** Payload del token sin verificar la firma; `null` si no tiene la forma esperada. */
export function readPlaytestToken(token: string): PlaytestLinkPayload | null {
  const [body, signature, extra] = token.split("~");
  if (!body || !signature || extra !== undefined || token.length > 512) return null;
  try {
    const base64 = body.replace(/-/gu, "+").replace(/_/gu, "/");
    const json = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as unknown;
    if (typeof json !== "object" || json === null) return null;
    const { v, pid, exp } = json as Record<string, unknown>;
    if (v !== 1 || typeof pid !== "string" || !pid || typeof exp !== "number") return null;
    return { playtestId: pid, expiresAt: exp * 1000 };
  } catch {
    return null;
  }
}

export function isPlaytestExpired(payload: PlaytestLinkPayload, now: number = Date.now()): boolean {
  return payload.expiresAt <= now;
}
