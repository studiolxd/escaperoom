import type { PackAnim } from "./manifest";

/**
 * Convenciones de animación del avatar (specs/04 §2, specs/26 §4.4). El pack
 * entrega los frames; el runtime los agrupa en animaciones con estas claves
 * canónicas. Si el manifiesto declara `anims`, esas mandan.
 */

export const AVATAR_DIRECTIONS = ["n", "e", "s", "w"] as const;
export const AVATAR_ACTIONS = ["idle", "walk", "interact"] as const;

/**
 * Personaje del manifiesto sintético de placeholder (sin pack real): un único
 * "personaje" genérico cuyos frames sustituye la capa Phaser por texturas
 * procedurales.
 */
export const PLACEHOLDER_CHARACTER_ID = "avatar";

/**
 * Personaje de reserva (A1): el maniquí SVG tintado con el color del
 * jugador, usado cuando no queda ningún personaje libre en `manifest.avatars`.
 * No aparece en `manifest.avatars` (no es seleccionable en el lobby).
 */
export const FALLBACK_CHARACTER_ID = "maniqui";

export type AvatarDirection = (typeof AVATAR_DIRECTIONS)[number];
export type AvatarAction = (typeof AVATAR_ACTIONS)[number];

/** Nº de frames por acción (specs/26 §4.4): idle 8, andar 8, interactuar 4. */
export const AVATAR_ACTION_FRAMES: Record<AvatarAction, number> = {
  idle: 8,
  walk: 8,
  interact: 4,
};

/** Cadencia por acción en fps. */
export const AVATAR_ACTION_FRAME_RATE: Record<AvatarAction, number> = {
  idle: 8,
  walk: 12,
  interact: 8,
};

/** Clave canónica de animación: `avatar-<personaje>-<dirección>-<acción>`. */
export function avatarAnimKey(
  character: string,
  direction: AvatarDirection,
  action: AvatarAction,
): string {
  return `avatar-${character}-${direction}-${action}`;
}

/** Nombre canónico del frame `index` (1-based) de una animación. */
export function avatarFrameName(
  character: string,
  direction: AvatarDirection,
  action: AvatarAction,
  index: number,
): string {
  return `${avatarAnimKey(character, direction, action)}-${index}`;
}

/** Animaciones por defecto de un conjunto de personajes cuando el manifiesto no las declara. */
export function defaultAvatarAnims(characters: readonly string[]): PackAnim[] {
  const anims: PackAnim[] = [];
  for (const character of characters) {
    for (const direction of AVATAR_DIRECTIONS) {
      for (const action of AVATAR_ACTIONS) {
        const count = AVATAR_ACTION_FRAMES[action];
        anims.push({
          key: avatarAnimKey(character, direction, action),
          frames: Array.from({ length: count }, (_, index) =>
            avatarFrameName(character, direction, action, index + 1),
          ),
          frameRate: AVATAR_ACTION_FRAME_RATE[action],
          repeat: action === "interact" ? 0 : -1,
        });
      }
    }
  }
  return anims;
}

/**
 * Dirección de avatar a partir del desplazamiento en celdas. Se proyecta a
 * pantalla (pantalla = (dx − dy, dx + dy)) para que "arriba" sea `n` en el
 * rombo isométrico: `e` (+x) = abajo-derecha, `s` (+y) = abajo-izquierda,
 * `w` (−x) = arriba-izquierda, `n` (−y) = arriba-derecha.
 *
 * Corrección (B2): un paso de rejilla de un solo eje (`dx` o `dy` = ±1, el
 * caso normal de WASD) siempre empata `|screenX|` y `|screenY|` en magnitud
 * (`(1,0)` y `(0,1)` proyectan a `(1,1)` y `(-1,1)` respectivamente). La
 * versión anterior desempataba siempre hacia el eje X, así que un paso en
 * `dy` (arriba/abajo en rejilla) nunca daba "n" ni "s". El desempate correcto
 * depende del signo relativo: un paso en `dx` proyecta `screenX` y `screenY`
 * con el **mismo** signo (eje X, `e`/`w`); un paso en `dy` los proyecta con
 * signo **opuesto** (eje Y, `s`/`n`).
 */
export function directionFromGridDelta(dx: number, dy: number): AvatarDirection {
  const screenX = dx - dy;
  const screenY = dx + dy;
  const absX = Math.abs(screenX);
  const absY = Math.abs(screenY);
  const useXAxis = absX > absY || (absX === absY && Math.sign(screenX) === Math.sign(screenY));
  if (useXAxis) {
    return screenX >= 0 ? "e" : "w";
  }
  return screenY >= 0 ? "s" : "n";
}
