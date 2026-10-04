import { describe, expect, it } from "vitest";
import {
  CAMERA,
  FREE_CAMERA_MARGIN,
  FREE_CAMERA_MAX_H,
  FREE_CAMERA_MAX_PITCH,
  FREE_CAMERA_MIN_H,
  FREE_CAMERA_SPEED,
  cameraForward,
  freeCameraDirection,
  freeCameraFromLook,
  moveFreeCamera,
  rotateFreeCamera,
  type FreeCameraState,
  cameraRight,
  EDITOR_CAMERA,
  editorCameraPosition,
  initialEditorCamera,
  initialOrbit,
  panPivot,
  rotateEditor,
  zoomEditor,
  type EditorCameraState,
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

describe("moveFreeCamera", () => {
  const bounds = { cols: 4, rows: 6 };
  const start: FreeCameraState = { x: 2, y: 3, h: 6, azimuth: 180, pitch: 45 };
  const none = { forward: 0, right: 0, up: 0 };

  it("avanza hacia donde mira, en el plano y a 5 m/s", () => {
    const s = moveFreeCamera(start, { ...none, forward: 1 }, 0.2, bounds);
    // Azimut 180° mira hacia +y.
    expect(s.x).toBeCloseTo(2);
    expect(s.y).toBeCloseTo(3 + FREE_CAMERA_SPEED * 0.2);
    expect(s.h).toBe(6);
  });
  it("retrocede y se desplaza a los lados respecto a la mirada", () => {
    const back = moveFreeCamera(start, { ...none, forward: -1 }, 0.2, bounds);
    expect(back.y).toBeCloseTo(3 - 1);
    const right = moveFreeCamera(start, { ...none, right: 1 }, 0.2, bounds);
    expect(right.x).toBeCloseTo(2 - 1); // mirando al sur, la derecha es el oeste
    expect(right.y).toBeCloseTo(3);
  });
  it("no supera 5 m/s en diagonal", () => {
    const s = moveFreeCamera(start, { ...none, forward: 1, right: 1 }, 1, bounds);
    expect(Math.hypot(s.x - 2, s.y - 3)).toBeCloseTo(FREE_CAMERA_SPEED);
  });
  it("sube y baja", () => {
    expect(moveFreeCamera(start, { ...none, up: 1 }, 0.2, bounds).h).toBeCloseTo(7);
    expect(moveFreeCamera(start, { ...none, up: -1 }, 0.2, bounds).h).toBeCloseTo(5);
  });
  it("queda dentro de la caja ampliada 5 m", () => {
    const far = moveFreeCamera(start, { ...none, forward: 1 }, 100, bounds);
    expect(far.y).toBe(bounds.rows + FREE_CAMERA_MARGIN);
    const west = moveFreeCamera(start, { ...none, right: 1 }, 100, bounds);
    expect(west.x).toBe(-FREE_CAMERA_MARGIN);
    const east = moveFreeCamera({ ...start, azimuth: 270 }, { ...none, forward: 1 }, 100, bounds);
    expect(east.x).toBe(bounds.cols + FREE_CAMERA_MARGIN);
    const north = moveFreeCamera(start, { ...none, forward: -1 }, 100, bounds);
    expect(north.y).toBe(-FREE_CAMERA_MARGIN);
  });
  it("queda entre 0,5 y 15 m de altura", () => {
    expect(moveFreeCamera(start, { ...none, up: 1 }, 100, bounds).h).toBe(FREE_CAMERA_MAX_H);
    expect(moveFreeCamera(start, { ...none, up: -1 }, 100, bounds).h).toBe(FREE_CAMERA_MIN_H);
  });
});

describe("rotateFreeCamera", () => {
  const start: FreeCameraState = { x: 0, y: 0, h: 6, azimuth: 5, pitch: 45 };
  it("el arrastre horizontal cambia el azimut y lo normaliza a [0, 360)", () => {
    const r = rotateFreeCamera(start, 100, 0);
    expect(r.azimuth).toBeCloseTo(5 - 100 * CAMERA.rotateSpeedDegPerPx + 360);
  });
  it("la elevación se queda entre −80° y 80°", () => {
    expect(rotateFreeCamera(start, 0, 10_000).pitch).toBe(FREE_CAMERA_MAX_PITCH);
    expect(rotateFreeCamera(start, 0, -10_000).pitch).toBe(-FREE_CAMERA_MAX_PITCH);
  });
  it("no toca la posición", () => {
    const r = rotateFreeCamera(start, 30, 30);
    expect([r.x, r.y, r.h]).toEqual([0, 0, 6]);
  });
});

describe("freeCameraFromLook", () => {
  it("es la inversa de freeCameraDirection", () => {
    const state: FreeCameraState = { x: 1, y: 2, h: 4, azimuth: 123, pitch: 30 };
    const d = freeCameraDirection(state);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    const back = freeCameraFromLook({ x: 1, y: 4, z: 2 }, d);
    expect(back.x).toBeCloseTo(1);
    expect(back.y).toBeCloseTo(2);
    expect(back.h).toBeCloseTo(4);
    expect(back.azimuth).toBeCloseTo(123);
    expect(back.pitch).toBeCloseTo(30);
  });
});

describe("cámara de editor", () => {
  const base: EditorCameraState = {
    azimuth: 0,
    elevation: 89,
    distance: 10,
    pivot: { x: 5, y: 0, z: 5 },
  };
  /** Metros por píxel a 10 m con fov 50° y 720 px de alto. */
  const mPerPx = (2 * 10 * Math.tan((50 * Math.PI) / 360)) / 720;

  it("estado inicial: pivote en el centro, distancia max(cols, rows) × 1,2, elevación 50°", () => {
    const s = initialEditorCamera({ cols: 10, rows: 6 }, 0.4);
    expect(s.pivot).toEqual({ x: 5, y: 0.4, z: 3 });
    expect(s.distance).toBeCloseTo(12);
    expect(s.elevation).toBe(50);
    expect(s.azimuth).toBe(0);
  });

  it("la distancia inicial respeta los límites", () => {
    expect(initialEditorCamera({ cols: 1, rows: 1 }).distance).toBe(EDITOR_CAMERA.minDistance);
    expect(initialEditorCamera({ cols: 100, rows: 100 }).distance).toBe(EDITOR_CAMERA.maxDistance);
  });

  it("editorCameraPosition coloca la cámara sobre el pivote", () => {
    const p = editorCameraPosition({ ...base, elevation: 90, azimuth: 0 });
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(10);
    expect(p.z).toBeCloseTo(5);
  });

  it("rotateEditor limita la elevación a 5°–89° y normaliza el azimut", () => {
    expect(rotateEditor(base, 0, 10_000).elevation).toBe(89);
    expect(rotateEditor(base, 0, -10_000).elevation).toBe(5);
    const turned = rotateEditor({ ...base, azimuth: 10 }, 100, 0);
    expect(turned.azimuth).toBeGreaterThanOrEqual(0);
    expect(turned.azimuth).toBeLessThan(360);
  });

  describe("panPivot", () => {
    it("arrastrar a la derecha mueve el pivote a la izquierda (el suelo sigue al puntero)", () => {
      const s = panPivot(base, 100, 0, 720);
      expect(s.pivot.x).toBeCloseTo(5 - 100 * mPerPx, 5);
      expect(s.pivot.z).toBeCloseTo(5);
      expect(s.pivot.y).toBe(0);
    });

    it("arrastrar hacia abajo adelanta el pivote (hacia donde mira la cámara)", () => {
      const s = panPivot(base, 0, 100, 720);
      expect(s.pivot.x).toBeCloseTo(5);
      // azimut 0: la cámara mira hacia −z; a 89° la profundidad es casi 1 píxel = 1 px.
      expect(s.pivot.z).toBeCloseTo(5 - (100 * mPerPx) / Math.sin((89 * Math.PI) / 180), 5);
    });

    it("sigue el azimut de la cámara", () => {
      const s = panPivot({ ...base, azimuth: 90 }, 100, 0, 720);
      expect(s.pivot.x).toBeCloseTo(5);
      expect(s.pivot.z).toBeCloseTo(5 + 100 * mPerPx, 5);
    });

    it("a más distancia, más metros por píxel", () => {
      const near = panPivot({ ...base, distance: 5 }, 100, 0, 720);
      const far = panPivot({ ...base, distance: 20 }, 100, 0, 720);
      expect(5 - far.pivot.x).toBeCloseTo((5 - near.pivot.x) * 4, 5);
    });

    it("un lienzo sin alto no mueve nada", () => {
      expect(panPivot(base, 100, 100, 0)).toBe(base);
    });
  });

  describe("zoomEditor", () => {
    it("×1,1 al alejar y ×0,9 al acercar, por muesca", () => {
      expect(zoomEditor(base, 1).distance).toBeCloseTo(11);
      expect(zoomEditor(base, -1).distance).toBeCloseTo(9);
      expect(zoomEditor(base, 2).distance).toBeCloseTo(12.1);
    });

    it("limita la distancia a 2–60 m", () => {
      expect(zoomEditor(base, 1000).distance).toBe(60);
      expect(zoomEditor(base, -1000).distance).toBe(2);
    });
  });
});
