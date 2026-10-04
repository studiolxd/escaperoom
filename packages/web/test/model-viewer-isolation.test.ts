import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** `ModelViewer3D` arrastra Three.js: solo puede importarse con `dynamic(..., { ssr: false })`. */
const src = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("aislamiento del visor 3D", () => {
  it("ningún fichero importa model-viewer-3d de forma estática", () => {
    for (const file of files(src)) {
      if (file.endsWith("model-viewer-3d.tsx")) continue;
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/(from\s+|import\s+)["'][^"']*model-viewer-3d["']/);
    }
  });

  it("quien lo usa lo hace con dynamic", () => {
    const users = files(src).filter((f) => /import\(["'][^"']*model-viewer-3d["']\)/.test(readFileSync(f, "utf8")));
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) expect(readFileSync(file, "utf8"), file).toMatch(/dynamic\(/);
  });
});
