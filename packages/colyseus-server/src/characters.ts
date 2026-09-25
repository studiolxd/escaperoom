import { FALLBACK_CHARACTER_ID } from "./game/avatar-pack.js";

/**
 * Elige el personaje de un jugador que entra sin `characterId` explícito
 * (A1): el primero de `available` que no esté ya ocupado en la sala. Si no
 * queda ninguno libre —hoy solo hay `caballero-m`, así que a partir del
 * segundo jugador—, cae al maniquí de reserva (`FALLBACK_CHARACTER_ID`), que
 * no es único (varios jugadores pueden compartirlo, distinguibles por el
 * anillo de color).
 */
export function pickPlayerCharacter(
  available: readonly string[],
  usedCharacters: Iterable<string>,
): string {
  const used = new Set(usedCharacters);
  for (const characterId of available) {
    if (!used.has(characterId)) {
      return characterId;
    }
  }
  return FALLBACK_CHARACTER_ID;
}

/**
 * `true` si `characterId` es válido para asignarlo explícitamente: existe en
 * el pack (o es el maniquí de reserva, siempre disponible) y no está ya
 * ocupado en la sala. El maniquí de reserva es la única excepción a "único
 * por sesión" (A1): no está en `available`, así que nunca se rechaza por
 * "ocupado".
 */
export function isCharacterAvailable(
  characterId: string,
  available: readonly string[],
  usedCharacters: Iterable<string>,
): boolean {
  if (characterId === FALLBACK_CHARACTER_ID) {
    return true;
  }
  if (!available.includes(characterId)) {
    return false;
  }
  const used = new Set(usedCharacters);
  return !used.has(characterId);
}

export { FALLBACK_CHARACTER_ID };
