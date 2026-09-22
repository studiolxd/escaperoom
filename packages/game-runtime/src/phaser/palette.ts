/**
 * Paleta de primitivas del runtime de 1.1 (sin pack gráfico todavía; el arte
 * pre-renderizado llega en 1.2). Cada `tileId` y cada `WorldObject.type`
 * apunta a un color base, y cada capa tiene un tinte distinto para poder
 * distinguir suelo, muros y decoración a simple vista.
 */

export const FLOOR_COLOR = 0x243244;
export const FLOOR_COLOR_ALT = 0x1c2636;
export const FLOOR_EDGE = 0x0f172a;

/** Tinte por `tileId` no vacío de una capa de tiles. */
export const TILE_COLORS: Record<number, number> = {
  1: 0x334155,
  2: 0x3b4a63,
  3: 0x2f3e52,
  4: 0x475569,
  5: 0x556b86,
  6: 0x4c3b5e,
  7: 0x5b4a2f,
  8: 0x6b5a3a,
  9: 0x64748b,
  10: 0x1e293b,
  11: 0x0f172a,
  20: 0x7c3aed,
  21: 0x0ea5e9,
  22: 0xf59e0b,
};

export function tileColor(tileId: number): number {
  return TILE_COLORS[tileId] ?? 0x94a3b8;
}

/** Color de cuerpo por tipo de `WorldObject`. */
export const OBJECT_COLORS: Record<string, number> = {
  decorativo: 0x64748b,
  escondite: 0x8b5cf6,
  cajon: 0xb45309,
  mecanismo: 0x0ea5e9,
  puerta: 0xeab308,
};

export function objectColor(type: string): number {
  return OBJECT_COLORS[type] ?? 0x94a3b8;
}

/** Paleta de avatares (4 colores = 4 jugadores en v1, specs/04 §2). */
export const PLAYER_COLORS = [0x38bdf8, 0xf472b6, 0x4ade80, 0xfacc15] as const;

export function playerColor(index: number): number {
  return PLAYER_COLORS[index % PLAYER_COLORS.length] ?? PLAYER_COLORS[0]!;
}

export const DECORATION_COLOR = 0x7c6f57;
