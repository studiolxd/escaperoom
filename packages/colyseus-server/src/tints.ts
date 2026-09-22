import { PLAYER_TINTS } from "./constants.js";

/**
 * Elige el color de un jugador que entra: el primer tinte de la paleta que no
 * esté en uso en la sala. Así un color liberado al salir un jugador se puede
 * reutilizar sin que coincida con el de otro jugador presente.
 */
export function pickPlayerTint(usedTints: Iterable<string>): string {
  const used = new Set(usedTints);

  for (const tint of PLAYER_TINTS) {
    if (!used.has(tint)) {
      return tint;
    }
  }

  // Sala llena con todos los tintes en uso (no debería ocurrir con
  // MAX_PLAYERS = PLAYER_TINTS.length): reutiliza en orden.
  return PLAYER_TINTS[used.size % PLAYER_TINTS.length]!;
}
