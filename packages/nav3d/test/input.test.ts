import { describe, expect, it } from "vitest";
import { buildNavInput, colliderTriangles } from "../src";
import { floor, room, TEST_CATALOG, testObject } from "./fixtures/catalog";

/** Rango de cada eje de los vértices de una `NavInput`. */
function bounds(positions: ArrayLike<number>) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, positions[i]!);
    max[i % 3] = Math.max(max[i % 3]!, positions[i]!);
  }
  return { min, max };
}

/** Altura (Y) del vértice más alto en torno a un punto de planta. */
function topAt(tri: { positions: number[]; indices: number[] }, x: number, z: number): number {
  let top = -Infinity;
  for (let i = 0; i < tri.positions.length; i += 3) {
    if (Math.abs(tri.positions[i]! - x) < 1e-9 && Math.abs(tri.positions[i + 2]! - z) < 1e-9) {
      top = Math.max(top, tri.positions[i + 1]!);
    }
  }
  return top;
}

describe("colliderTriangles", () => {
  it("la caja tiene 8 vértices y 12 triángulos", () => {
    const t = colliderTriangles({ type: "box", cx: 0, cy: 0, ch: 1, sx: 1, sy: 2, sh: 2 });
    expect(t.positions.length / 3).toBe(8);
    expect(t.indices.length / 3).toBe(12);
  });

  it("todas las caras de la caja miran hacia fuera", () => {
    const t = colliderTriangles({ type: "box", cx: 0, cy: 0, ch: 1, sx: 2, sy: 2, sh: 2 });
    for (let i = 0; i < t.indices.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => t.indices[i + k]! * 3);
      const p = t.positions;
      const u = [p[b!]! - p[a!]!, p[b! + 1]! - p[a! + 1]!, p[b! + 2]! - p[a! + 2]!];
      const w = [p[c!]! - p[a!]!, p[c! + 1]! - p[a! + 1]!, p[c! + 2]! - p[a! + 2]!];
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const centroid = [0, 1, 2].map((k) => (p[a! + k]! + p[b! + k]! + p[c! + k]!) / 3);
      const out = [centroid[0]!, centroid[1]! - 1, centroid[2]!];
      expect(n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]!).toBeGreaterThan(0);
    }
  });

  it("la cuña de base a h = 0 tiene 6 vértices y la cara superior sube en el sentido de `dir`", () => {
    const base = { type: "ramp", cx: 0, cy: 0, sx: 2, sy: 4, h0: 0, h1: 1 } as const;
    const cases = [
      { dir: "x+", high: [1, 0], low: [-1, 0] },
      { dir: "x-", high: [-1, 0], low: [1, 0] },
      { dir: "y+", high: [0, 2], low: [0, -2] },
      { dir: "y-", high: [0, -2], low: [0, 2] },
    ] as const;
    for (const { dir, high, low } of cases) {
      const t = colliderTriangles({ ...base, dir });
      expect(t.positions.length / 3).toBe(6);
      expect(t.indices.length / 3).toBe(8);
      // Esquinas del lado alto (x o z extremos según el eje) a h1; lado bajo a 0.
      const corner = (side: readonly number[]) => {
        const x = side[0] !== 0 ? side[0]! : 1;
        const z = side[1] !== 0 ? side[1]! : 2;
        return topAt(t, x, z);
      };
      expect(corner(high)).toBe(1);
      expect(corner(low)).toBe(0);
    }
  });

  it("la cuña con h0 > 0 conserva el frente vertical (8 vértices)", () => {
    const t = colliderTriangles({ type: "ramp", cx: 0, cy: 0, sx: 1, sy: 1, h0: 0.2, h1: 0.6, dir: "y+" });
    expect(t.positions.length / 3).toBe(8);
    expect(t.indices.length / 3).toBe(12);
  });
});

describe("buildNavInput", () => {
  it("aplica traslación, giro y escala del colocador", () => {
    const pkg = room([{ model: "tarima", x: 5, y: 5, h: 1, yaw: 90, scale: 2 }]);
    const { min, max } = bounds(buildNavInput(pkg, "sala", TEST_CATALOG).positions);
    expect(min).toEqual([4, 1, 4].map((v) => expect.closeTo(v, 5)));
    expect(max).toEqual([6, 1.8, 6].map((v) => expect.closeTo(v, 5)));
  });

  it("una caja girada 90° intercambia sus medidas en planta", () => {
    const pkg = room([
      { model: "muro", x: 5, y: 5, yaw: 0 },
    ]);
    // Rampa 1 × 2 (x × y): girada 90° pasa a ocupar 2 en X y 1 en Z.
    const ramp = room([{ model: "rampa", x: 5, y: 5, yaw: 0 }]);
    const turned = room([{ model: "rampa", x: 5, y: 5, yaw: 90 }]);
    const a = bounds(buildNavInput(ramp, "sala", TEST_CATALOG).positions);
    const b = bounds(buildNavInput(turned, "sala", TEST_CATALOG).positions);
    expect(a.max[0]! - a.min[0]!).toBeCloseTo(1, 5);
    expect(a.max[2]! - a.min[2]!).toBeCloseTo(2, 5);
    expect(b.max[0]! - b.min[0]!).toBeCloseTo(2, 5);
    expect(b.max[2]! - b.min[2]!).toBeCloseTo(1, 5);
    expect(buildNavInput(pkg, "sala", TEST_CATALOG).indices.length).toBe(36);
  });

  it("incluye los objetos que bloquean y usa el modelo del estado inicial", () => {
    const pkg = room(
      [],
      [
        testObject({
          id: "arca",
          sprite: "muro",
          states: { a: { sprite: "tarima" } },
          initialState: "a",
        }),
        testObject({ id: "mesa", sprite: "escalon", states: { a: { animation: "abrir" } }, initialState: "a" }),
      ],
    );
    // tarima (36 índices) + escalón (36 índices).
    expect(buildNavInput(pkg, "sala", TEST_CATALOG).indices.length).toBe(72);
  });

  it("excluye puertas, objetos con leadsTo y placas", () => {
    const pkg = room(
      [],
      [
        testObject({ id: "puerta-1", type: "puerta" }),
        testObject({ id: "salida", leadsTo: "otra" }),
        testObject({ id: "placa-1" }),
        testObject({ id: "mesa" }),
      ],
      ["placa-1"],
    );
    expect(buildNavInput(pkg, "sala", TEST_CATALOG).indices.length).toBe(36);
  });

  it("ignora modelos desconocidos, objetos de otra habitación y colisionadores vacíos", () => {
    const pkg = room(
      [
        { model: "no-existe", x: 1, y: 1 },
        { model: "alfombra", x: 2, y: 2 },
      ],
      [testObject({ id: "lejos", roomId: "otra" })],
    );
    const input = buildNavInput(pkg, "sala", TEST_CATALOG);
    expect(input.indices.length).toBe(0);
    expect(input.positions.length).toBe(0);
  });

  it("una habitación que no existe devuelve arrays vacíos", () => {
    const input = buildNavInput(room(floor(2, 2)), "nada", TEST_CATALOG);
    expect(input.indices.length).toBe(0);
    expect(input.positions.length).toBe(0);
  });
});
