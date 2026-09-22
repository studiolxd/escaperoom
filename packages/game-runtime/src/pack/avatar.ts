import type { PackAnim } from "./manifest";

/**
 * Convenciones de animación del avatar (specs/04 §2, specs/26 §4.4). El pack
 * entrega los frames; el runtime los agrupa en animaciones con estas claves
 * canónicas. Si el manifiesto declara `anims`, esas mandan.
 */

export const AVATAR_DIRECTIONS = ["n", "e", "s", "w"] as const;
export const AVATAR_ACTIONS = ["idle", "walk", "interact"] as const;

export type AvatarDirection = (typeof AVATAR_DIRECTIONS)[number];
export type AvatarAction = (typeof AVATAR_ACTIONS)[number];

/** Nº de frames por acción (specs/26 §4.4): idle 2, andar 4, interactuar 1. */
export const AVATAR_ACTION_FRAMES: Record<AvatarAction, number> = {
  idle: 2,
  walk: 4,
  interact: 1,
};

/** Cadencia por acción en fps. */
export const AVATAR_ACTION_FRAME_RATE: Record<AvatarAction, number> = {
  idle: 4,
  walk: 8,
  interact: 6,
};

/** Clave canónica de animación: `avatar-<dirección>-<acción>`. */
export function avatarAnimKey(direction: AvatarDirection, action: AvatarAction): string {
  return `avatar-${direction}-${action}`;
}

/** Nombre canónico del frame `index` (1-based) de una animación. */
export function avatarFrameName(
  direction: AvatarDirection,
  action: AvatarAction,
  index: number,
): string {
  return `${avatarAnimKey(direction, action)}-${index}`;
}

/** Animaciones por defecto del avatar cuando el manifiesto no las declara. */
export function defaultAvatarAnims(): PackAnim[] {
  const anims: PackAnim[] = [];
  for (const direction of AVATAR_DIRECTIONS) {
    for (const action of AVATAR_ACTIONS) {
      const count = AVATAR_ACTION_FRAMES[action];
      anims.push({
        key: avatarAnimKey(direction, action),
        frames: Array.from({ length: count }, (_, index) =>
          avatarFrameName(direction, action, index + 1),
        ),
        frameRate: AVATAR_ACTION_FRAME_RATE[action],
        repeat: action === "interact" ? 0 : -1,
      });
    }
  }
  return anims;
}

/**
 * Dirección de avatar a partir del desplazamiento en celdas. Se proyecta a
 * pantalla para que "arriba" sea `n` en el rombo isométrico.
 */
export function directionFromGridDelta(dx: number, dy: number): AvatarDirection {
  const screenX = dx - dy;
  const screenY = dx + dy;
  if (Math.abs(screenX) >= Math.abs(screenY)) {
    return screenX >= 0 ? "e" : "w";
  }
  return screenY >= 0 ? "s" : "n";
}
