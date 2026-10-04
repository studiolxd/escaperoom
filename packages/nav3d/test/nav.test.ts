import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRoomNav, createRoomNavFor, initNav3D, type RoomNav } from "../src";
import { floor, room, TEST_CATALOG, type TestPiece } from "./fixtures/catalog";

beforeAll(async () => {
  await initNav3D();
});

const navs: RoomNav[] = [];
function navOf(pieces: TestPiece[]): RoomNav {
  const nav = createRoomNavFor(room(pieces), "sala", TEST_CATALOG);
  navs.push(nav);
  return nav;
}
afterEach(() => {
  for (const nav of navs.splice(0)) nav.destroy();
});

/**
 * Recast cuantiza la altura a celdas de `ch` (0,1 m) y la superficie queda hasta ~0,12 m por
 * encima de la geometría real: las alturas se comparan con esta tolerancia (sesgo sistemático e
 * igual en cliente y servidor, que usan la misma navmesh).
 */
function expectHeight(actual: number, target: number): void {
  expect(actual).toBeGreaterThanOrEqual(target - 0.05);
  expect(actual).toBeLessThanOrEqual(target + 0.15);
}

/** Muro de 1 m de ancho en x = 3..4 y y = 0..4 (queda un hueco en y = 4..6). */
const wallPieces = (): TestPiece[] =>
  Array.from({ length: 4 }, (_, j) => ({ model: "muro", x: 3.5, y: j + 0.5 }));

describe("initNav3D", () => {
  it("es idempotente: comparte la misma promesa", () => {
    expect(initNav3D()).toBe(initNav3D());
  });
});

describe("closest", () => {
  it("en el centro del suelo devuelve el punto", () => {
    const nav = navOf(floor(6, 6));
    const p = nav.closest({ x: 3, y: 3, h: 0 });
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(3, 1);
    expect(p!.y).toBeCloseTo(3, 1);
    expectHeight(p!.h, 0);
  });

  it("fuera del suelo (o a otra altura) devuelve null", () => {
    const nav = navOf(floor(6, 6));
    expect(nav.closest({ x: 10, y: 3, h: 0 })).toBeNull();
    expect(nav.closest({ x: 3, y: 3, h: 2 })).toBeNull();
  });

  it("acepta una tolerancia propia", () => {
    const nav = navOf(floor(6, 6));
    expect(nav.closest({ x: 7, y: 3, h: 0 })).toBeNull();
    expect(nav.closest({ x: 7, y: 3, h: 0 }, { plan: 2, height: 0.5 })).not.toBeNull();
  });
});

describe("habitación vacía", () => {
  it("empty es true y closest/path devuelven null", () => {
    const nav = navOf([]);
    expect(nav.empty).toBe(true);
    expect(nav.closest({ x: 1, y: 1, h: 0 })).toBeNull();
    expect(nav.path({ x: 1, y: 1, h: 0 }, { x: 2, y: 2, h: 0 })).toBeNull();
  });

  it("createRoomNav con entrada vacía devuelve empty", () => {
    const nav = createRoomNav({ positions: new Float32Array(), indices: new Uint32Array() });
    expect(nav.empty).toBe(true);
  });

  it("una habitación con suelo no está vacía", () => {
    expect(navOf(floor(6, 6)).empty).toBe(false);
  });
});

describe("muro en medio", () => {
  const pieces = () => [...floor(7, 6), ...wallPieces()];

  it("path rodea el muro", () => {
    const nav = navOf(pieces());
    const path = nav.path({ x: 1, y: 1, h: 0 }, { x: 6, y: 1, h: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);
    for (const p of path!) expect(p.x < 3 || p.x > 4 || p.y > 4).toBe(true);
    const end = path![path!.length - 1]!;
    expect(end.x).toBeCloseTo(6, 1);
    expect(end.y).toBeCloseTo(1, 1);
  });

  it("slide contra el muro no lo atraviesa", () => {
    const nav = navOf(pieces());
    const end = nav.slide({ x: 2, y: 2, h: 0 }, { x: 5, y: 2, h: 0 });
    expect(end.x).toBeLessThan(3);
    expect(end.y).toBeCloseTo(2, 1);
  });

  it("slide libre llega al destino", () => {
    const nav = navOf(floor(6, 6));
    const end = nav.slide({ x: 1, y: 1, h: 0 }, { x: 3, y: 3, h: 0 });
    expect(end.x).toBeCloseTo(3, 1);
    expect(end.y).toBeCloseTo(3, 1);
  });

  it("slide desde un punto fuera de la navmesh devuelve el origen", () => {
    const nav = navOf(floor(6, 6));
    const from = { x: 20, y: 20, h: 0 };
    expect(nav.slide(from, { x: 3, y: 3, h: 0 })).toEqual(from);
  });
});

describe("desniveles", () => {
  it("un escalón de 0,2 m se sube", () => {
    // Banda de escalones en x = 3..5, y = 0..6.
    const steps: TestPiece[] = [];
    for (const x of [3.5, 4.5]) for (let j = 0; j < 6; j++) steps.push({ model: "escalon", x, y: j + 0.5 });
    const nav = navOf([...floor(6, 6), ...steps]);
    const path = nav.path({ x: 1, y: 3, h: 0 }, { x: 4, y: 3, h: 0.2 });
    expect(path).not.toBeNull();
    expectHeight(path![path!.length - 1]!.h, 0.2);
  });

  // Tarima de 3 × 3 m a 0,4 m, en x = 4..7, y = 1.5..4.5 (la malla se retrae 0,3 m del borde).
  const platform = (): TestPiece[] => {
    const out: TestPiece[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out.push({ model: "tarima", x: 4.5 + i, y: 2 + j });
    return out;
  };

  it("una tarima de 0,4 m sin rampa no se puede subir", () => {
    const nav = navOf([...floor(8, 6), ...platform()]);
    expect(nav.closest({ x: 6, y: 3.5, h: 0.4 })).not.toBeNull();
    expect(nav.path({ x: 1, y: 3.5, h: 0 }, { x: 6, y: 3.5, h: 0.4 })).toBeNull();
  });

  it("con la rampa al lado sí se sube", () => {
    // Rampa 1 × 2 girada 90° (sube hacia +x), con la cima pegada a la cara oeste de la tarima.
    const ramp: TestPiece = { model: "rampa", x: 3.5, y: 3.5, yaw: 90 };
    const nav = navOf([...floor(8, 6), ...platform(), ramp]);
    const path = nav.path({ x: 1, y: 3.5, h: 0 }, { x: 6, y: 3.5, h: 0.4 });
    expect(path).not.toBeNull();
    expectHeight(path![path!.length - 1]!.h, 0.4);
  });
});

describe("determinismo", () => {
  it("generar dos veces la misma habitación da los mismos resultados", () => {
    const pieces = [...floor(7, 6), ...wallPieces()];
    const a = navOf(pieces);
    const b = navOf(pieces);
    for (let i = 0; i < 10; i++) {
      const p = { x: 0.7 + i * 0.6, y: 0.5 + (i % 5) * 1.1, h: 0 };
      const target = { x: 6, y: 5, h: 0 };
      expect(b.closest(p)).toEqual(a.closest(p));
      expect(b.path(p, target)).toEqual(a.path(p, target));
      expect(b.slide(p, target)).toEqual(a.slide(p, target));
    }
  });
});

describe("rendimiento", () => {
  it("mide la generación de una habitación de 20 × 14 con 300 piezas", () => {
    const pieces: TestPiece[] = floor(20, 14);
    // 20 × 14 = 280 baldosas; 20 muros completan las 300 piezas.
    for (let i = 0; i < 20; i++) pieces.push({ model: "muro", x: 0.5 + i, y: 7.5 });
    expect(pieces).toHaveLength(300);
    const pkg = room(pieces);
    const t0 = performance.now();
    const nav = createRoomNavFor(pkg, "sala", TEST_CATALOG);
    const ms = performance.now() - t0;
    navs.push(nav);
    console.log(`[nav3d] navmesh 20×14, 300 piezas: ${ms.toFixed(0)} ms`);
    expect(nav.empty).toBe(false);
  });
});
