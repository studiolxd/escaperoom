import type { PackAnim, PackManifest } from "./manifest";

/**
 * Convenciones de animación del avatar (specs/04 §2, specs/26 §4.4). El pack
 * entrega los frames; el runtime los agrupa en animaciones con estas claves
 * canónicas. Si el manifiesto declara `anims`, esas mandan.
 */

/** Las 4 direcciones "clásicas" (cardinales en pantalla), que todo personaje trae. */
export const AVATAR_DIRECTIONS = ["n", "e", "s", "w"] as const;
/** Las 4 diagonales (deuda "8 direcciones"): opcionales, un personaje puede no traerlas. */
export const AVATAR_DIAGONAL_DIRECTIONS = ["ne", "se", "sw", "nw"] as const;
/** Las 8 direcciones, en el orden angular de `directionFromGridDelta` (0°, 45°, … 315°). */
export const ALL_AVATAR_DIRECTIONS = [
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
  "n",
] as const;
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

export type AvatarDirection = (typeof ALL_AVATAR_DIRECTIONS)[number];
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

/**
 * Animaciones por defecto de un conjunto de personajes cuando el manifiesto no
 * las declara. `directions` por defecto son las 4 cardinales (compatible con
 * personajes sin diagonales); `build-pack.ts` pasa `ALL_AVATAR_DIRECTIONS` y
 * deja que se descarten las que no tengan frames.
 */
export function defaultAvatarAnims(
  characters: readonly string[],
  directions: readonly AvatarDirection[] = AVATAR_DIRECTIONS,
): PackAnim[] {
  const anims: PackAnim[] = [];
  for (const character of characters) {
    for (const direction of directions) {
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
 * Dirección de avatar a partir del desplazamiento en celdas, en las 4
 * direcciones cardinales (respaldo cuando el personaje no trae diagonales, o
 * comportamiento previo a la deuda "8 direcciones"). Se proyecta a pantalla
 * (pantalla = (dx − dy, dx + dy)) para que "arriba" sea `n` en el rombo
 * isométrico: `e` (+x) = abajo-derecha, `s` (+y) = abajo-izquierda, `w` (−x) =
 * arriba-izquierda, `n` (−y) = arriba-derecha.
 *
 * Corrección (B2): un paso de rejilla de un solo eje (`dx` o `dy` = ±1, el
 * caso normal de WASD) siempre empata `|screenX|` y `|screenY|` en magnitud
 * (`(1,0)` y `(0,1)` proyectan a `(1,1)` y `(-1,1)` respectivamente). La
 * versión anterior desempataba siempre hacia el eje X, así que un paso en
 * `dy` (arriba/abajo en rejilla) nunca daba "n" ni "s". El desempate correcto
 * depende del signo relativo: un paso en `dx` proyecta `screenX` y `screenY`
 * con el **mismo** signo (eje X, `e`/`w`); un paso en `dy` los proyecta con
 * signo **opuesto** (eje Y, `s`/`n`). Un paso puramente diagonal en rejilla
 * (`dx` y `dy` = ±1, mismo signo) da `screenX = 0`: se resuelve por el eje Y
 * (`s`/`n`); diagonal con signos opuestos da `screenY = 0`: por el eje X
 * (`e`/`w`). Así, sin diagonales, ne→e, se→s, sw→w, nw→n.
 */
function directionFromGridDelta4(dx: number, dy: number): AvatarDirection {
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

/**
 * Orden angular de `ALL_AVATAR_DIRECTIONS` sobre pantalla (0°, 45°, … 315°,
 * medido con `atan2(screenY, screenX)`, screenY hacia abajo): `ne` = 0°
 * (pantalla pura derecha), `e` = 45°, `se` = 90° (pantalla pura abajo), `s` =
 * 135°, `sw` = 180° (pantalla pura izquierda), `w` = 225°, `nw` = 270°
 * (pantalla pura arriba), `n` = 315°. Un paso de un solo eje en rejilla cae
 * exactamente a mitad de camino entre dos octantes (p. ej. `dx=1,dy=0` →
 * 45° = `e`) y coincide con `directionFromGridDelta4`; uno puramente diagonal
 * cae en un octante exacto (p. ej. `dx=1,dy=-1` → 0° = `ne`).
 */
function directionFromGridDelta8(dx: number, dy: number): AvatarDirection {
  const screenX = dx - dy;
  const screenY = dx + dy;
  const angleDeg = (Math.atan2(screenY, screenX) * 180) / Math.PI;
  const octant = Math.round(((angleDeg % 360) + 360) / 45) % 8;
  return ALL_AVATAR_DIRECTIONS[octant]!;
}

/**
 * Dirección de avatar a partir del desplazamiento en celdas. Con
 * `hasDiagonals` (el personaje trae las 4 diagonales, deuda "8 direcciones"),
 * resuelve entre las 8; si no, se queda en las 4 cardinales de siempre
 * (`directionFromGridDelta4`), que ya elegían la más cercana para un paso
 * diagonal.
 */
export function directionFromGridDelta(
  dx: number,
  dy: number,
  hasDiagonals = false,
): AvatarDirection {
  return hasDiagonals ? directionFromGridDelta8(dx, dy) : directionFromGridDelta4(dx, dy);
}

/**
 * ¿Trae `character` las 4 diagonales? Preferimos lo que declare
 * `manifest.avatars[].directions` (calculado en `build-pack.ts` a partir de
 * los frames reales); si el manifiesto no trae esa entrada (packs antiguos,
 * personaje de reserva/placeholder sin listar en `avatars`), se cae a mirar
 * si hay algún `anim` declarado para alguna dirección diagonal de ese
 * personaje.
 */
export function avatarHasDiagonals(manifest: PackManifest, character: string): boolean {
  const declared = manifest.avatars?.find((avatar) => avatar.id === character)?.directions;
  if (declared !== undefined) {
    return declared === 8;
  }
  return AVATAR_DIAGONAL_DIRECTIONS.some((direction) =>
    manifest.anims.some((anim) => anim.key === avatarAnimKey(character, direction, "idle")),
  );
}
