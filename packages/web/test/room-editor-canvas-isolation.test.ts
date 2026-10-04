import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Aislamiento de imports: el editor 2D no descarga Three.js ni el 3D descarga Phaser. */
const dir = join(process.cwd(), "src/components/room-editor");
const importsOf = (file: string) =>
  [...readFileSync(join(dir, file), "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

describe("aislamiento de imports del editor", () => {
  it("el lienzo 2D no importa `…/three`", () => {
    const imports = importsOf("room-editor-canvas.tsx");
    expect(imports.some((i) => i.endsWith("/three") || i === "three")).toBe(false);
    expect(imports).toContain("@escaperoom/game-runtime/phaser");
  });

  it("el lienzo 3D no importa `…/phaser`", () => {
    const imports = importsOf("room-editor-canvas-3d.tsx");
    expect(imports.some((i) => i.endsWith("/phaser") || i === "phaser")).toBe(false);
    expect(imports).toContain("@escaperoom/game-runtime/three");
  });

  it("el espacio de trabajo y el shell no importan ni Three ni Phaser directamente", () => {
    for (const file of ["room-editor-workspace-3d.tsx", "room-editor-workspace.tsx", "room-editor-shell.tsx"]) {
      const imports = importsOf(file);
      expect(imports.filter((i) => /(^|\/)(three|phaser)$/.test(i)), file).toEqual([]);
    }
  });
});
