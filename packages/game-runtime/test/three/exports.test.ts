import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("aislamiento de Three.js", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("el índice del paquete no reexporta ./three ni importa three", () => {
    const index = read("../../src/index.ts");
    expect(index).not.toContain("./three");
    expect(index).not.toMatch(/from\s+["']three/);
  });

  it("el paquete expone el subpath ./three", () => {
    const pkg = JSON.parse(read("../../package.json")) as { exports: Record<string, string> };
    expect(pkg.exports["./three"]).toBe("./src/three/index.ts");
  });

  it("los módulos puros no importan three ni tocan el DOM", () => {
    for (const file of ["movement", "proximity"]) {
      const src = read(`../../src/three/${file}.ts`);
      expect(src).not.toMatch(/from\s+["']three/);
      expect(src).not.toMatch(/\bdocument\b|\bwindow\b/);
    }
  });
});
