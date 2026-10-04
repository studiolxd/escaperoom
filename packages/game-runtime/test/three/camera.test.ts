import { describe, expect, it } from "vitest";
import {
  CAMERA,
  cameraForward,
  cameraRight,
  initialOrbit,
  orbitPosition,
  rotateOrbit,
  zoomOrbit,
} from "../../src/three/camera";

const origin = { x: 0, y: 0, z: 0 };

describe("orbitPosition", () => {
  it("polar 0° y azimut 0° deja la cámara a `distance` hacia +Z", () => {
    const p = orbitPosition({ azimuth: 0, polar: 0, distance: 5 }, origin);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(5);
  });
  it("azimut 90° la lleva a +X", () => {
    const p = orbitPosition({ azimuth: 90, polar: 0, distance: 4 }, origin);
    expect(p.x).toBeCloseTo(4);
    expect(p.z).toBeCloseTo(0);
  });
  it("polar 90° es cenital", () => {
    const p = orbitPosition({ azimuth: 30, polar: 90, distance: 3 }, origin);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(3);
    expect(p.z).toBeCloseTo(0);
  });
  it("suma el objetivo y conserva la distancia", () => {
    const target = { x: 2, y: 1, z: -3 };
    const p = orbitPosition({ azimuth: 200, polar: 55, distance: 5 }, target);
    expect(Math.hypot(p.x - 2, p.y - 1, p.z + 3)).toBeCloseTo(5);
  });
});

describe("initialOrbit", () => {
  it("se coloca detrás del avatar: azimut = yaw + 180", () => {
    expect(initialOrbit(0).azimuth).toBe(180);
    expect(initialOrbit(270).azimuth).toBe(90);
    const o = initialOrbit(0);
    expect(o.polar).toBe(CAMERA.startPolarDeg);
    expect(o.distance).toBe(CAMERA.startDistance);
    // Con yaw 0 el avatar mira a +Z: la cámara queda en −Z.
    expect(orbitPosition(o, origin).z).toBeLessThan(0);
  });
});

describe("rotateOrbit", () => {
  const start = initialOrbit(0);
  it("el arrastre horizontal cambia el azimut y lo normaliza a [0, 360)", () => {
    const r = rotateOrbit({ ...start, azimuth: 5 }, 100, 0);
    expect(r.azimuth).toBeCloseTo(5 - 100 * CAMERA.rotateSpeedDegPerPx + 360);
  });
  it("el arrastre vertical respeta los límites de inclinación", () => {
    expect(rotateOrbit(start, 0, 10_000).polar).toBe(CAMERA.maxPolarDeg);
    expect(rotateOrbit(start, 0, -10_000).polar).toBe(CAMERA.minPolarDeg);
  });
  it("no toca la distancia", () => {
    expect(rotateOrbit(start, 30, 30).distance).toBe(start.distance);
  });
});

describe("zoomOrbit", () => {
  const start = initialOrbit(0);
  it("una muesca mueve `zoomStep`", () => {
    expect(zoomOrbit(start, 1).distance).toBe(start.distance + CAMERA.zoomStep);
    expect(zoomOrbit(start, -2).distance).toBe(start.distance - 2 * CAMERA.zoomStep);
  });
  it("respeta los límites", () => {
    expect(zoomOrbit(start, 100).distance).toBe(CAMERA.maxDistance);
    expect(zoomOrbit(start, -100).distance).toBe(CAMERA.minDistance);
  });
});

describe("cameraForward", () => {
  it("0° avanza hacia −y, 90° hacia −x, 180° hacia +y", () => {
    const a = cameraForward(0);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(-1);
    const b = cameraForward(90);
    expect(b.x).toBeCloseTo(-1);
    expect(b.y).toBeCloseTo(0);
    const c = cameraForward(180);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(1);
  });
  it("con la cámara detrás de un avatar que mira a +y, avanzar es +y", () => {
    const f = cameraForward(initialOrbit(0).azimuth);
    expect(f.y).toBeCloseTo(1);
  });
  it("la derecha de la pantalla queda a la derecha del avance", () => {
    const f = cameraForward(180); // mira a +y (sur)
    const r = cameraRight(f);
    expect(r.x).toBeCloseTo(-1); // mirando al sur, la derecha es el oeste
    expect(r.y).toBeCloseTo(0);
  });
});
