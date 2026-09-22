import { describe, expect, it } from "vitest";
import { canvasForFrame, checkSvgAspect, rasterizeSvg, readSvgViewBox } from "../src/pack/svg";

const SQUARE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#b45309"/></svg>';

describe("canvasForFrame", () => {
  // Los lienzos se expresan a la escala de entrega (PACK_SCALE = 2 → 2×).
  it("usa 128×64 para el suelo (celda iso 2:1 a 2×)", () => {
    expect(canvasForFrame("tile-1")).toEqual({ width: 128, height: 64 });
    expect(canvasForFrame("tile-2")).toEqual({ width: 128, height: 64 });
  });

  it("da lienzo libre a los sprites y 64×64/64×96 a iconos y avatar (×2)", () => {
    expect(canvasForFrame("tile-10")).toEqual({ width: 128, height: 128 });
    expect(canvasForFrame("cuadro-rey")).toEqual({ width: 192, height: 192 });
    expect(canvasForFrame("icon-llave-oro")).toEqual({ width: 128, height: 128 });
    expect(canvasForFrame("avatar-s-walk-1")).toEqual({ width: 128, height: 192 });
    expect(canvasForFrame("fx-spark-1")).toEqual({ width: 128, height: 128 });
  });

  it("devuelve null para un frame desconocido", () => {
    expect(canvasForFrame("no-existe")).toBeNull();
  });
});

describe("rasterizeSvg", () => {
  it("escala el SVG al lienzo canónico del frame sin deformarlo (a 2×)", async () => {
    const tile = await rasterizeSvg(SQUARE_SVG, "tile-1");
    expect({ width: tile.width, height: tile.height }).toEqual({ width: 128, height: 64 });
    expect(tile.rgba.length).toBe(128 * 64 * 4);

    const prop = await rasterizeSvg(SQUARE_SVG, "cuadro-rey");
    expect({ width: prop.width, height: prop.height }).toEqual({ width: 192, height: 192 });
  });

  it("conserva el tamaño natural si el frame es desconocido", async () => {
    const natural = await rasterizeSvg(SQUARE_SVG, "no-existe");
    expect(natural.width).toBeGreaterThan(64);
    expect(natural.rgba.length).toBe(natural.width * natural.height * 4);
  });
});

describe("checkSvgAspect", () => {
  it("no avisa si el viewBox tiene el aspecto del lienzo", () => {
    const tileSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"></svg>';
    const iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"></svg>';
    expect(checkSvgAspect(tileSvg, "tile-1")).toBeNull();
    expect(checkSvgAspect(iconSvg, "icon-caliz")).toBeNull();
  });

  it("avisa si un tile a sangre no es 2:1", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 114 66"></svg>';
    const warning = checkSvgAspect(svg, "tile-1");
    expect(warning).toContain("114×66");
    expect(warning).toContain("tile-1");
  });

  it("devuelve null sin medidas", () => {
    expect(checkSvgAspect("<svg></svg>", "tile-1")).toBeNull();
  });
});

describe("readSvgViewBox", () => {
  it("lee viewBox y width/height numéricos", () => {
    expect(readSvgViewBox('<svg viewBox="0 0 450 260"></svg>')).toEqual({
      width: 450,
      height: 260,
    });
    expect(readSvgViewBox('<svg width="128" height="64"></svg>')).toEqual({
      width: 128,
      height: 64,
    });
    expect(readSvgViewBox('<svg width="100%" height="100%"></svg>')).toBeNull();
  });
});
