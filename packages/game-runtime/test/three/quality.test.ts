import { describe, expect, it } from "vitest";
import { createQualityMonitor } from "../../src/three/quality";

/** Alimenta el monitor con `seconds` s a `fps` y devuelve cuántas veces avisó de bajar. */
function feed(monitor: ReturnType<typeof createQualityMonitor>, fps: number, seconds: number): number {
  let downgrades = 0;
  const frames = Math.round(fps * seconds);
  for (let i = 0; i < frames; i++) {
    monitor.sample(1 / fps);
    if (monitor.shouldDowngrade()) downgrades++;
  }
  return downgrades;
}

describe("createQualityMonitor", () => {
  it("con 60 FPS no baja", () => {
    expect(feed(createQualityMonitor(), 60, 30)).toBe(0);
  });
  it("con 30 FPS justos no baja", () => {
    expect(feed(createQualityMonitor(), 30, 30)).toBe(0);
  });
  it("con 20 FPS durante 5 s baja una sola vez", () => {
    const monitor = createQualityMonitor();
    expect(feed(monitor, 20, 5)).toBe(1);
    expect(feed(monitor, 20, 10)).toBe(0);
  });
  it("con 20 FPS durante 3 s no baja", () => {
    expect(feed(createQualityMonitor(), 20, 3)).toBe(0);
  });
  it("es una media móvil: una racha lenta corta se compensa", () => {
    const monitor = createQualityMonitor();
    expect(feed(monitor, 60, 4)).toBe(0);
    expect(feed(monitor, 20, 1)).toBe(0); // media de 5 s ≈ 52 FPS
  });
  it("tras una racha rápida larga, solo cuenta la ventana de 5 s", () => {
    const monitor = createQualityMonitor();
    feed(monitor, 60, 20);
    expect(feed(monitor, 15, 5)).toBe(1);
  });
});
