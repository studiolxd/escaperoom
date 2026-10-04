import { describe, expect, it } from "vitest";
import type { NavPoint, RoomNav } from "@escaperoom/nav3d";
import {
  ARRIVE_EPSILON,
  WALK_SPEED,
  followPath,
  stepToward,
  turnToward,
  yawOf,
  type Pose,
} from "../../src/three/movement";

const at = (x: number, y: number, h = 0, yaw = 0): Pose => ({ x, y, h, yaw });

describe("yawOf", () => {
  it("0 = +y, 90 = +x, 180 = −y, 270 = −x", () => {
    expect(yawOf(0, 1)).toBeCloseTo(0);
    expect(yawOf(1, 0)).toBeCloseTo(90);
    expect(yawOf(0, -1)).toBeCloseTo(180);
    expect(yawOf(-1, 0)).toBeCloseTo(270);
  });
});

describe("turnToward", () => {
  it("llega al objetivo si cabe en el máximo", () => {
    expect(turnToward(10, 40, 90)).toBeCloseTo(40);
  });
  it("gira como mucho `maxDeg` por el camino corto", () => {
    expect(turnToward(0, 90, 30)).toBeCloseTo(30);
    expect(turnToward(90, 0, 30)).toBeCloseTo(60);
  });
  it("cruza 0/360 por el lado corto", () => {
    expect(turnToward(350, 10, 15)).toBeCloseTo(5);
    expect(turnToward(10, 350, 15)).toBeCloseTo(355);
    expect(turnToward(350, 20, 90)).toBeCloseTo(20);
  });
  it("el resultado queda en [0, 360)", () => {
    const r = turnToward(5, 355, 10);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(360);
  });
});

describe("followPath", () => {
  const path: NavPoint[] = [
    { x: 1, y: 0, h: 0 },
    { x: 1, y: 2, h: 0 },
  ];

  it("avanza WALK_SPEED·dt a lo largo de la ruta", () => {
    const r = followPath(at(0, 0), path, 0.1);
    expect(r.moving).toBe(true);
    expect(r.pose.x).toBeCloseTo(WALK_SPEED * 0.1);
    expect(r.pose.y).toBeCloseTo(0);
    expect(r.rest).toHaveLength(2);
  });

  it("consume los puntos alcanzados y sigue por el siguiente tramo", () => {
    const r = followPath(at(0, 0), path, 0.5); // 1,75 m: 1 hasta el primer punto + 0,75 del segundo
    expect(r.rest).toHaveLength(1);
    expect(r.pose.x).toBeCloseTo(1);
    expect(r.pose.y).toBeCloseTo(0.75);
  });

  it("no se pasa del último punto y deja la ruta vacía", () => {
    const r = followPath(at(0, 0), path, 5);
    expect(r.rest).toHaveLength(0);
    expect(r.pose.x).toBeCloseTo(1);
    expect(r.pose.y).toBeCloseTo(2);
    expect(r.moving).toBe(true);
  });

  it("con la ruta vacía no se mueve", () => {
    const r = followPath(at(3, 3), [], 0.1);
    expect(r.moving).toBe(false);
    expect(r.pose).toEqual(at(3, 3));
  });

  it("un primer punto a menos de ARRIVE_EPSILON se consume sin gastar movimiento", () => {
    const r = followPath(at(0, 0), [{ x: ARRIVE_EPSILON / 2, y: 0, h: 0 }, { x: 0, y: 3, h: 0 }], 0.1);
    expect(r.rest).toHaveLength(1);
    expect(r.pose.y).toBeCloseTo(WALK_SPEED * 0.1);
  });

  it("interpola la altura y gira hacia donde avanza (720°/s)", () => {
    const r = followPath(at(0, 0, 0, 0), [{ x: 3, y: 0, h: 0.6 }], 0.1);
    expect(r.pose.h).toBeGreaterThan(0);
    expect(r.pose.yaw).toBeCloseTo(72); // 0 → 90 a 720°/s durante 0,1 s
  });
});

describe("stepToward", () => {
  const free: RoomNav = {
    empty: false,
    closest: (p) => p,
    path: () => null,
    slide: (_from, to) => to,
    debugGeometry: () => ({ positions: new Float32Array(0), indices: new Uint32Array(0) }),
    destroy: () => undefined,
  };
  const blocked: RoomNav = { ...free, slide: (from) => from };

  it("avanza por la navmesh en la dirección pedida", () => {
    const r = stepToward(at(1, 1), { x: 1, y: 0 }, 0.1, free);
    expect(r.moving).toBe(true);
    expect(r.pose.x).toBeCloseTo(1 + WALK_SPEED * 0.1);
    expect(r.pose.y).toBeCloseTo(1);
  });

  it("normaliza la dirección", () => {
    const r = stepToward(at(0, 0), { x: 5, y: 0 }, 0.1, free);
    expect(r.pose.x).toBeCloseTo(WALK_SPEED * 0.1);
  });

  it("si la navmesh bloquea no se mueve (pero sí gira)", () => {
    const r = stepToward(at(1, 1), { x: 1, y: 0 }, 0.1, blocked);
    expect(r.moving).toBe(false);
    expect(r.pose.x).toBe(1);
    expect(r.pose.yaw).toBeCloseTo(72);
  });

  it("sin dirección no hace nada", () => {
    const r = stepToward(at(1, 1), { x: 0, y: 0 }, 0.1, free);
    expect(r).toEqual({ pose: at(1, 1), moving: false });
  });
});
