import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { buildGameModel, buildPack3D } from "../src/lib/game-model";
import { findRepoRoot } from "../src/lib/repo-root";

const root = findRepoRoot(process.cwd());
const load = (file: string) =>
  loadRoomPackage(JSON.parse(readFileSync(join(root, "docs/reference", file), "utf8")) as unknown);

const previousPacksRoot = process.env.PACKS_ROOT;
const tempDirs: string[] = [];

afterEach(() => {
  if (previousPacksRoot === undefined) delete process.env.PACKS_ROOT;
  else process.env.PACKS_ROOT = previousPacksRoot;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildGameModel — pack3d", () => {
  it("una sala 2D no lleva pack3d", () => {
    const payload = buildGameModel(load("roompackage-rey-aldric.v1.json"), "es");
    expect(payload.model.dimension).toBe("2d");
    expect(payload.pack3d).toBeUndefined();
  });

  it("una sala 3D lleva pack3d con el id del pack (sin baseUrl si no hay modelos)", () => {
    // PACKS_ROOT vacío (como en E2E y CI): sin carpeta `models`, el runtime pinta cajas.
    const empty = mkdtempSync(join(tmpdir(), "game-model-"));
    tempDirs.push(empty);
    process.env.PACKS_ROOT = empty;
    const payload = buildGameModel(load("roompackage-demo-3d.v1.json"), "es");
    expect(payload.model.dimension).toBe("3d");
    expect(payload.pack3d).toEqual({ packId: "medieval-v1" });
  });

  it("incluye la baseUrl cuando existe la carpeta de modelos", () => {
    const packs = mkdtempSync(join(tmpdir(), "game-model-"));
    tempDirs.push(packs);
    mkdirSync(join(packs, "medieval-v1", "models"), { recursive: true });
    process.env.PACKS_ROOT = packs;
    const payload = buildGameModel(load("roompackage-demo-3d.v1.json"), "es");
    expect(payload.pack3d).toEqual({ baseUrl: "/packs/medieval-v1", packId: "medieval-v1" });
  });

  it("buildPack3D devuelve undefined si el modelo es 2D", () => {
    expect(buildPack3D({ dimension: "2d" }, "medieval-v1")).toBeUndefined();
  });
});
