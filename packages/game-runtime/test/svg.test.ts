import { describe, expect, it } from "vitest";
import { canvasForFrame, rasterizeSvg } from "../src/pack/svg";

const SQUARE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#b45309"/></svg>';

describe("canvasForFrame", () => {
  it("usa 64×32 para el suelo (celda iso 2:1)", () => {
    expect(canvasForFrame("tile-1")).toEqual({ width: 64, height: 32 });
    expect(canvasForFrame("tile-2")).toEqual({ width: 64, height: 32 });
  });

  it("da lienzo libre a los sprites y 64×64/64×96 a iconos y avatar", () => {
    expect(canvasForFrame("tile-10")).toEqual({ width: 64, height: 64 });
    expect(canvasForFrame("cuadro-rey")).toEqual({ width: 96, height: 96 });
    expect(canvasForFrame("icon-llave-oro")).toEqual({ width: 64, height: 64 });
    expect(canvasForFrame("avatar-s-walk-1")).toEqual({ width: 64, height: 96 });
    expect(canvasForFrame("fx-spark-1")).toEqual({ width: 64, height: 64 });
  });

  it("devuelve null para un frame desconocido", () => {
    expect(canvasForFrame("no-existe")).toBeNull();
  });
});

describe("rasterizeSvg", () => {
  it("escala el SVG al lienzo canónico del frame sin deformarlo", async () => {
    const tile = await rasterizeSvg(SQUARE_SVG, "tile-1");
    expect({ width: tile.width, height: tile.height }).toEqual({ width: 64, height: 32 });
    expect(tile.rgba.length).toBe(64 * 32 * 4);

    const prop = await rasterizeSvg(SQUARE_SVG, "cuadro-rey");
    expect({ width: prop.width, height: prop.height }).toEqual({ width: 96, height: 96 });
  });

  it("conserva el tamaño natural si el frame es desconocido", async () => {
    const natural = await rasterizeSvg(SQUARE_SVG, "no-existe");
    expect(natural.width).toBeGreaterThan(64);
    expect(natural.rgba.length).toBe(natural.width * natural.height * 4);
  });
});
