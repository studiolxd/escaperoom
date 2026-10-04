import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRoomNav, createRoomNavFor, initNav3D, type RoomNav } from "../src";
import { floor, room, TEST_CATALOG } from "./fixtures/catalog";

beforeAll(async () => {
  await initNav3D();
});

const navs: RoomNav[] = [];
afterEach(() => {
  for (const nav of navs.splice(0)) nav.destroy();
});

describe("debugGeometry", () => {
  it("devuelve triángulos para un suelo, en coordenadas Three (Y = altura)", () => {
    const nav = createRoomNavFor(room(floor(4, 4)), "sala", TEST_CATALOG);
    navs.push(nav);
    const { positions, indices } = nav.debugGeometry();
    expect(positions).toBeInstanceOf(Float32Array);
    expect(indices).toBeInstanceOf(Uint32Array);
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.length % 3).toBe(0);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.length % 3).toBe(0);
    let maxIndex = 0;
    for (const i of indices) maxIndex = Math.max(maxIndex, i);
    expect(maxIndex).toBeLessThan(positions.length / 3);
    // Suelo plano a h ≈ 0: X y Z cubren la habitación y Y queda cerca de 0.
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]!).toBeGreaterThanOrEqual(-0.01);
      expect(positions[i]!).toBeLessThanOrEqual(4.01);
      expect(positions[i + 1]!).toBeGreaterThanOrEqual(-0.05);
      expect(positions[i + 1]!).toBeLessThanOrEqual(0.2);
      expect(positions[i + 2]!).toBeGreaterThanOrEqual(-0.01);
      expect(positions[i + 2]!).toBeLessThanOrEqual(4.01);
    }
  });

  it("una navmesh vacía devuelve arrays vacíos", () => {
    const nav = createRoomNav({ positions: new Float32Array(), indices: new Uint32Array() });
    const { positions, indices } = nav.debugGeometry();
    expect(positions.length).toBe(0);
    expect(indices.length).toBe(0);
  });
});
