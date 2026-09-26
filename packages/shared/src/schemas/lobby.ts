import type { RoomPackage } from "./roompackage";
import type { LightConfig, SubRoom, TileLayer } from "./world";

/**
 * Sala de espera (lobby) de la partida — encargo lobby-diseño, specs/08 §2.1 y
 * specs/11 §4.1. El lobby es una habitación más del mapa con
 * `kind: "lobby"`, diseñada por el creador en el editor (tamaño, suelo, muros
 * y decoración, sin pruebas/puertas/ítems). Una sala que no la tenga (todas
 * las publicadas antes de este campo, Rey Aldric incluido) juega con un lobby
 * pequeño **generado** con el suelo y los muros de su habitación inicial
 * (`buildDefaultLobbyRoom`), para que nada deje de funcionar sin tocarla.
 *
 * Helpers puros: los usan el motor de sesión (`RoomSession`, dónde se entra
 * al mapa), la `GameRoom`, el cliente local del playtest, el loader del
 * runtime (modelo para pintar el lobby), el validador y el editor.
 */

export const LOBBY_ROOM_KIND = "lobby" as const;

/** Id base del lobby generado (se le añade sufijo si choca con otra habitación). */
export const DEFAULT_LOBBY_ROOM_ID = "lobby";

/** Nombre del lobby generado (dato del mapa, no texto de la interfaz). */
export const DEFAULT_LOBBY_ROOM_NAME = "Sala de espera";

/** Tamaño del lobby generado (celdas). */
export const DEFAULT_LOBBY_GRID = { cols: 10, rows: 8 } as const;

type MapLike = Pick<RoomPackage["map"], "rooms">;

/** ¿Es la sala de espera? */
export function isLobbyRoom(room: Pick<SubRoom, "kind">): boolean {
  return room.kind === LOBBY_ROOM_KIND;
}

/** Lobby **diseñado** por el creador (el primero con `kind: "lobby"`), si lo hay. */
export function lobbyRoomOf(map: MapLike): SubRoom | undefined {
  return map.rooms.find(isLobbyRoom);
}

/**
 * Habitación inicial de la partida: la primera del mapa que **no** es el
 * lobby. Es donde aparece cada jugador al entrar al mapa tras su 3-2-1 (y la
 * que usa el validador como punto de partida de la búsqueda).
 */
export function initialRoomOf(map: MapLike): SubRoom | undefined {
  return map.rooms.find((room) => !isLobbyRoom(room));
}

/** Habitaciones de juego (sin el lobby). */
export function gameRoomsOf(map: MapLike): SubRoom[] {
  return map.rooms.filter((room) => !isLobbyRoom(room));
}

/** Decodifica una capa RLE `[cantidad, tileId, …]` a una rejilla plana. */
function decodeLayer(layer: TileLayer): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < layer.rle.length; i += 2) {
    const count = layer.rle[i]!;
    const tile = layer.rle[i + 1]!;
    for (let n = 0; n < count && out.length < 1_000_000; n += 1) out.push(tile);
  }
  return out;
}

/** Tile no vacío más frecuente de una capa (`0` si la capa está vacía). */
function dominantTile(layer: TileLayer | undefined): number {
  if (!layer) return 0;
  const counts = new Map<number, number>();
  for (const tile of decodeLayer(layer)) {
    if (tile !== 0) counts.set(tile, (counts.get(tile) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [tile, count] of counts) {
    if (count > bestCount || (count === bestCount && tile < best)) {
      best = tile;
      bestCount = count;
    }
  }
  return best;
}

/** RLE por filas (una racha no cruza el final de fila), la forma del fixture. */
function encodeRows(grid: number[], cols: number): number[] {
  const rle: number[] = [];
  for (let start = 0; start < grid.length; start += cols) {
    const row = grid.slice(start, start + cols);
    let i = 0;
    while (i < row.length) {
      let j = i;
      while (j < row.length && row[j] === row[i]) j += 1;
      rle.push(j - i, row[i]!);
      i = j;
    }
  }
  return rle;
}

/** Id libre para el lobby generado (`lobby`, `lobby-2`…). */
function freeLobbyId(map: MapLike): string {
  const taken = new Set(map.rooms.map((room) => room.id));
  if (!taken.has(DEFAULT_LOBBY_ROOM_ID)) return DEFAULT_LOBBY_ROOM_ID;
  for (let n = 2; ; n += 1) {
    const candidate = `${DEFAULT_LOBBY_ROOM_ID}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Lobby por defecto de una sala sin lobby diseñado: 10×8 celdas con el suelo
 * (tile dominante de la primera capa) y los muros (tile dominante de la capa
 * `walls`, o de la segunda capa) de su habitación inicial, muros en la fila
 * superior y la columna izquierda (la misma convención isométrica que las
 * habitaciones del pack), la luz ambiente de la habitación inicial y
 * `maxPlayers` puntos de aparición en el centro.
 */
export function buildDefaultLobbyRoom(map: MapLike, maxPlayers = 8): SubRoom {
  const source = initialRoomOf(map) ?? map.rooms[0];
  const { cols, rows } = DEFAULT_LOBBY_GRID;
  const groundLayer = source?.layers.find((layer) => layer.name === "ground") ?? source?.layers[0];
  const wallsLayer =
    source?.layers.find((layer) => layer.name === "walls") ??
    source?.layers.find((layer) => layer !== groundLayer);
  const floor = dominantTile(groundLayer);
  const wall = dominantTile(wallsLayer);

  const layers: TileLayer[] = [];
  if (floor !== 0) {
    layers.push({
      name: groundLayer?.name ?? "ground",
      rle: encodeRows(new Array<number>(cols * rows).fill(floor), cols),
    });
  }
  if (wall !== 0) {
    const grid = new Array<number>(cols * rows).fill(0);
    for (let x = 0; x < cols; x += 1) grid[x] = wall;
    for (let y = 0; y < rows; y += 1) grid[y * cols] = wall;
    layers.push({ name: wallsLayer?.name ?? "walls", rle: encodeRows(grid, cols) });
  }

  const count = Math.max(1, Math.min(8, maxPlayers));
  const centerX = Math.floor(cols / 2);
  const centerY = Math.floor(rows / 2) + 1;
  const offsets = [0, -1, 1, -2, 2, -3, 3, 4];
  const spawnPoints = Array.from({ length: count }, (_, i) => ({
    id: `spawn-${i + 1}`,
    x: Math.min(cols - 1, Math.max(1, centerX + offsets[i]!)),
    y: i < 4 ? centerY : centerY + 1,
  }));

  const lighting: LightConfig[] = (source?.lighting ?? []).filter(
    (light) => light.type === "ambient",
  );

  return {
    id: freeLobbyId(map),
    name: DEFAULT_LOBBY_ROOM_NAME,
    kind: LOBBY_ROOM_KIND,
    grid: { cols, rows },
    layers,
    decorations: [],
    spawnPoints,
    lighting,
  };
}

/**
 * El paquete con sala de espera garantizada: el mismo objeto si ya tiene un
 * lobby diseñado; si no, una copia con el lobby por defecto al final de
 * `map.rooms` (nunca primero: la habitación inicial sigue siendo la primera
 * de juego). Es lo que juegan la `GameRoom`, el cliente local y el modelo del
 * runtime; el paquete guardado/publicado no cambia.
 */
export function withLobbyRoom<T extends Pick<RoomPackage, "map" | "meta">>(pkg: T): T {
  if (lobbyRoomOf(pkg.map)) return pkg;
  return {
    ...pkg,
    map: {
      ...pkg.map,
      rooms: [...pkg.map.rooms, buildDefaultLobbyRoom(pkg.map, pkg.meta.players.max)],
    },
  };
}
