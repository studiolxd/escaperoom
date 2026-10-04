import { describe, expect, it } from "vitest";
import {
  PROXIMITY_CONE_DEG,
  PROXIMITY_MAX_HEIGHT,
  PROXIMITY_RADIUS,
  highlightedObject,
} from "../../src/three/proximity";

const pose = { x: 5, y: 5, h: 0, yaw: 0 }; // mira a +y
const obj = (id: string, dx: number, dy: number, h = 0) => ({ id, x: 5 + dx, y: 5 + dy, h });

describe("highlightedObject", () => {
  it("sin candidatos no resalta nada", () => {
    expect(highlightedObject(pose, [])).toBeUndefined();
  });

  it("respeta el radio", () => {
    expect(highlightedObject(pose, [obj("a", 0, PROXIMITY_RADIUS - 0.01)])).toBe("a");
    expect(highlightedObject(pose, [obj("a", 0, PROXIMITY_RADIUS + 0.01)])).toBeUndefined();
  });

  it("respeta el cono de 120° frente al avatar", () => {
    const edge = PROXIMITY_CONE_DEG / 2;
    const inside = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return obj("a", Math.sin(r) * 1.5, Math.cos(r) * 1.5);
    };
    expect(highlightedObject(pose, [inside(edge - 2)])).toBe("a");
    expect(highlightedObject(pose, [inside(edge + 2)])).toBeUndefined();
    expect(highlightedObject(pose, [obj("a", 0, -1.5)])).toBeUndefined(); // a la espalda
  });

  it("el cono sigue el giro del avatar", () => {
    expect(highlightedObject({ ...pose, yaw: 180 }, [obj("a", 0, -1.5)])).toBe("a");
    expect(highlightedObject({ ...pose, yaw: 90 }, [obj("a", 1.5, 0)])).toBe("a");
  });

  it("respeta la diferencia de altura", () => {
    expect(highlightedObject(pose, [obj("a", 0, 1, PROXIMITY_MAX_HEIGHT - 0.01)])).toBe("a");
    expect(highlightedObject(pose, [obj("a", 0, 1, PROXIMITY_MAX_HEIGHT + 0.01)])).toBeUndefined();
    expect(highlightedObject(pose, [obj("a", 0, 1, -PROXIMITY_MAX_HEIGHT - 0.01)])).toBeUndefined();
  });

  it("elige el más cercano", () => {
    expect(highlightedObject(pose, [obj("lejos", 0, 1.8), obj("cerca", 0, 0.9)])).toBe("cerca");
  });

  it("a igual distancia desempata por id menor", () => {
    expect(highlightedObject(pose, [obj("b", 0.5, 1), obj("a", -0.5, 1)])).toBe("a");
    expect(highlightedObject(pose, [obj("a", -0.5, 1), obj("b", 0.5, 1)])).toBe("a");
  });

  it("un objeto pegado al avatar no se descarta por el cono", () => {
    expect(highlightedObject(pose, [obj("a", 0, -0.2)])).toBe("a");
    expect(highlightedObject(pose, [obj("a", 0, -0.4)])).toBeUndefined();
  });
});
