import { describe, expect, it } from "vitest";
import { findPath, isReachable } from "../src/world/pathfinding";
import type { GridCell } from "../src/world/selection";

/**
 * Expande una ruta de waypoints a las celdas realmente pisadas, con el mismo
 * movimiento natural que `RoomScene.readMove` (diagonal hasta que un eje
 * llega a su destino, luego recto en el que quede) — para comprobar que el
 * avatar SÍ pasa por donde debe, aunque tras `simplifyPath` esa celda ya no
 * sea un waypoint explícito de la lista.
 */
function walkedCells(path: GridCell[]): GridCell[] {
  const cells: GridCell[] = [path[0]!];
  for (let i = 1; i < path.length; i += 1) {
    let { x, y } = cells[cells.length - 1]!;
    const target = path[i]!;
    while (x !== target.x || y !== target.y) {
      x = x === target.x ? x : x + Math.sign(target.x - x);
      y = y === target.y ? y : y + Math.sign(target.y - y);
      cells.push({ x, y });
    }
  }
  return cells;
}

describe("findPath", () => {
  it("devuelve la propia celda si ya se está en el destino", () => {
    expect(findPath({ x: 3, y: 3 }, { x: 3, y: 3 }, () => true)).toEqual([{ x: 3, y: 3 }]);
  });

  it("devuelve undefined si el destino no es caminable", () => {
    expect(findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, () => false)).toBeUndefined();
  });

  it("encuentra una línea recta en un plano abierto, sin waypoints de más", () => {
    // `simplifyPath` la reduce a sus dos extremos: el tramo entero se anda
    // en línea recta de una vez (revisión en vivo: menos cambios de
    // dirección, la animación de caminar no se corta a mitad de camino).
    const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, () => true);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it("no da un rodeo en zigzag cuando un tramo diagonal-recto directo basta", () => {
    // Con todas las aristas al mismo coste, el BFS puede encontrar una "V"
    // en diagonal (0,0)→(1,1)→(2,0)→(3,0)) tan corta como la línea recta —
    // `simplifyPath` debe quedarse con la recta, no con el zigzag (cada
    // cambio de dirección reinicia la animación de caminar).
    const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, () => true);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it("rodea un obstáculo en vez de devolver undefined o cruzarlo", () => {
    // Muro vertical en x=2 salvo un hueco en y=5: sin pathfinding real, un
    // movimiento en línea recta desde (0,0) hacia (4,0) se quedaría clavado
    // contra el muro para siempre (el bug de la estatua).
    const isWalkable = (x: number, y: number) => x !== 2 || y === 5;
    const path = findPath({ x: 0, y: 0 }, { x: 4, y: 0 }, isWalkable);
    expect(path).toBeDefined();
    expect(path!.at(-1)).toEqual({ x: 4, y: 0 });
    expect(path!.every(({ x, y }) => isWalkable(x, y))).toBe(true);
    // Al recorrer la ruta con el movimiento natural (diagonal→recto por
    // tramo), pasa de verdad por el único hueco del muro, aunque tras
    // simplificar ya no sea un waypoint explícito de la lista.
    const walked = walkedCells(path!);
    expect(walked.every(({ x, y }) => isWalkable(x, y))).toBe(true);
    expect(walked.some((cell) => cell.x === 2 && cell.y === 5)).toBe(true);
  });

  it("no corta esquinas: un paso diagonal exige las dos celdas ortogonales libres", () => {
    // Grid 2×2 con (1,0) y (0,1) bloqueadas: sin cortar la esquina, (0,0) y
    // (1,1) quedan cada una en su propia esquina sin ruta entre ellas.
    const isWalkable = (x: number, y: number) => {
      if (x < 0 || x > 1 || y < 0 || y > 1) return false;
      if (x === 1 && y === 0) return false;
      if (x === 0 && y === 1) return false;
      return true;
    };
    const path = findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, isWalkable);
    expect(path).toBeUndefined();
  });

  it("devuelve undefined cuando el destino está en una bolsa aislada", () => {
    const isWalkable = (x: number, y: number) =>
      (x === 5 && y === 5) || (x >= 0 && x < 3 && y >= 0 && y < 3);
    expect(findPath({ x: 0, y: 0 }, { x: 5, y: 5 }, isWalkable)).toBeUndefined();
  });
});

describe("isReachable", () => {
  it("es coherente con findPath", () => {
    const isWalkable = (x: number, y: number) => x >= 0 && x <= 5 && y >= 0 && y <= 5;
    expect(isReachable({ x: 0, y: 0 }, { x: 5, y: 5 }, isWalkable)).toBe(true);
    expect(isReachable({ x: 0, y: 0 }, { x: 6, y: 6 }, isWalkable)).toBe(false);
  });
});
