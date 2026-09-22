/**
 * Proyección isométrica 2:1 y utilidades de profundidad compartidas por la
 * escena del runtime (specs/04 §1). La rejilla vive en celdas; el runtime la
 * proyecta a coordenadas de mundo con el rombo estándar.
 */

/** Ancho del rombo de una celda en píxeles (2:1). */
export const ISO_TILE_WIDTH = 64;

/** Alto del rombo de una celda en píxeles (2:1). */
export const ISO_TILE_HEIGHT = 32;

export interface IsoPoint {
  x: number;
  y: number;
}

/** Proyecta una celda `(tx, ty)` a coordenadas de mundo. */
export function tileToWorld(tx: number, ty: number): IsoPoint {
  return {
    x: (tx - ty) * (ISO_TILE_WIDTH / 2),
    y: (tx + ty) * (ISO_TILE_HEIGHT / 2),
  };
}

/**
 * Punto de anclaje de un sprite/tile con pivote **abajo-centro del rombo**
 * (specs/26 §3.1): el vértice inferior de la celda, que es donde se apoyan los
 * objetos con altura y el avatar.
 */
export function tileAnchor(tx: number, ty: number): IsoPoint {
  const { x, y } = tileToWorld(tx, ty);
  return { x, y: y + ISO_TILE_HEIGHT / 2 };
}

/** Inversa de `tileToWorld`, redondeada a la celda más cercana. */
export function worldToTile(worldX: number, worldY: number): { tx: number; ty: number } {
  return {
    tx: Math.round(worldX / ISO_TILE_WIDTH + worldY / ISO_TILE_HEIGHT),
    ty: Math.round(worldY / ISO_TILE_HEIGHT - worldX / ISO_TILE_WIDTH),
  };
}

/**
 * Clave de profundidad única por celda, con un margen (`sub`) para ordenar
 * entidades dentro de la misma celda. Crece con `x + y` (coordenada isométrica
 * visual), de modo que las celdas "más al fondo" se dibujan antes.
 */
export function isoDepth(tx: number, ty: number, sub = 0): number {
  return (tx + ty) * 100 + tx + clampSub(sub);
}

function clampSub(sub: number): number {
  return Math.max(-1, Math.min(99, sub));
}

/** Centro en mundo de una rejilla `cols × rows`. */
export function gridCenter(cols: number, rows: number): IsoPoint {
  return tileToWorld((cols - 1) / 2, (rows - 1) / 2);
}

/** Bounds en mundo de una rejilla, con margen en celdas. */
export function gridBounds(
  cols: number,
  rows: number,
  margin = 1,
): { x: number; y: number; width: number; height: number } {
  const top = tileToWorld(0, 0);
  const left = tileToWorld(0, rows - 1);
  const right = tileToWorld(cols - 1, 0);
  const bottom = tileToWorld(cols - 1, rows - 1);
  const padX = ISO_TILE_WIDTH * margin;
  const padY = ISO_TILE_HEIGHT * margin;
  const x = left.x - padX;
  const y = top.y - padY;
  return {
    x,
    y,
    width: right.x - left.x + padX * 2,
    height: bottom.y - top.y + padY * 2,
  };
}
