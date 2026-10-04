import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 7.6: una partida 2D no descarga Three.js y una 3D no descarga Phaser. El shell elige el canvas
 * con `dynamic()`; esto vigila que cada canvas solo importe su motor (los `import type` se borran
 * al compilar y no cuentan).
 */

const dir = join(process.cwd(), "src/components");

function runtimeImports(file: string): string[] {
  const source = readFileSync(join(dir, file), "utf8");
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms)].map(
    (match) => match[1]!,
  );
}

describe("aislamiento de motores gráficos", () => {
  it("el canvas 2D no importa three", () => {
    const imports = runtimeImports("game-session/game-session-canvas.tsx");
    expect(imports.some((spec) => spec.endsWith("/three") || spec === "three")).toBe(false);
    expect(imports).toContain("@escaperoom/game-runtime/phaser");
  });

  it("el canvas 3D no importa phaser (salvo import type)", () => {
    const imports = runtimeImports("game-session/game-session-canvas-3d.tsx");
    expect(imports.some((spec) => spec.endsWith("/phaser") || spec === "phaser")).toBe(false);
    expect(imports).toContain("@escaperoom/game-runtime/three");
  });

  it("el canvas del observador 3D no importa phaser (salvo import type)", () => {
    const imports = runtimeImports("event-panel/spectator-canvas-3d.tsx");
    expect(imports.some((spec) => spec.endsWith("/phaser") || spec === "phaser")).toBe(false);
  });

  it("el shell no importa ningún motor de forma estática", () => {
    const imports = runtimeImports("game-session/game-session-shell.tsx");
    expect(imports.some((spec) => /\/(phaser|three)$|^(phaser|three)$/.test(spec))).toBe(false);
  });
});
