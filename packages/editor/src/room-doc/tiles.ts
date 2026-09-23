/**
 * Codificación de capas de tiles (specs/04 §1, specs/08 §2.1): el RoomPackage
 * guarda cada capa en RLE `[cantidad, tileId, ...]` y el doc Yjs, celda a celda.
 *
 * El RLE se genera **por filas** (una racha nunca cruza el final de una fila),
 * que es la forma del fixture del Rey Aldric: así la ida y vuelta
 * RoomPackage → doc → RoomPackage reproduce el RLE original byte a byte.
 */

/** Rejilla fila-major de `cols × rows` (`0` = celda vacía) a RLE por filas. */
export function encodeRowRle(tiles: readonly number[], cols: number): number[] {
  const rle: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const tileId = tiles[i] ?? 0;
    const startsRow = i % cols === 0;
    const last = rle.length - 1;
    if (!startsRow && last > 0 && rle[last] === tileId) {
      rle[last - 1] = (rle[last - 1] ?? 0) + 1;
    } else {
      rle.push(1, tileId);
    }
  }
  return rle;
}

/**
 * RLE a rejilla de `size` celdas. Igual que el loader del runtime, lo que falte
 * se rellena con `0` y lo que sobre se descarta; una longitud impar o una
 * cantidad negativa son un RLE mal formado.
 */
export function decodeRle(rle: readonly number[], size: number): number[] {
  if (rle.length % 2 !== 0) {
    throw new Error(`RLE mal formado: longitud impar (${rle.length})`);
  }
  const tiles: number[] = [];
  for (let i = 0; i < rle.length && tiles.length < size; i += 2) {
    const count = rle[i] ?? 0;
    const tileId = rle[i + 1] ?? 0;
    if (count < 0) throw new Error(`RLE mal formado: cantidad negativa (${count})`);
    for (let n = 0; n < count && tiles.length < size; n++) tiles.push(tileId);
  }
  while (tiles.length < size) tiles.push(0);
  return tiles;
}

/** Clave de una celda en el mapa `tiles` de una subroom: `"<capa>|<x>,<y>"`. */
export function tileKey(layer: string, x: number, y: number): string {
  return `${layer}|${x},${y}`;
}

/** Inversa de `tileKey`, o `undefined` si la clave no tiene esa forma. */
export function parseTileKey(key: string): { layer: string; x: number; y: number } | undefined {
  const match = /^(.*)\|(-?\d+),(-?\d+)$/.exec(key);
  if (!match) return undefined;
  return { layer: match[1] as string, x: Number(match[2]), y: Number(match[3]) };
}
