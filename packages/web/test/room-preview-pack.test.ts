import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPlaceholderManifest,
  loadRoomPackage,
  toRuntimeModel,
  type RuntimeModel,
} from "@escaperoom/game-runtime";
import { findRepoRoot } from "../src/lib/repo-root";
import { resolveRoomPreviewPack } from "../src/lib/room-preview-pack";

const fixturePath = join(
  findRepoRoot(process.cwd()),
  "docs/reference/roompackage-rey-aldric.v1.json",
);

const tempDirs: string[] = [];

function loadModel(): RuntimeModel {
  const raw: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  return toRuntimeModel(loadRoomPackage(raw));
}

function makeTempPacksRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "room-preview-pack-"));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(packsRoot: string, tileset: string, manifest: unknown): void {
  const dir = join(packsRoot, tileset);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveRoomPreviewPack", () => {
  it("cae al placeholder si no hay pack en public/packs", () => {
    const result = resolveRoomPreviewPack("medieval-v1", loadModel(), {
      packsRoot: makeTempPacksRoot(),
    });
    expect(result.pack).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it("usa el pack si el manifiesto valida contra el RoomPackage", () => {
    const model = loadModel();
    const packsRoot = makeTempPacksRoot();
    writeManifest(packsRoot, "medieval-v1", buildPlaceholderManifest(model));

    const result = resolveRoomPreviewPack("medieval-v1", model, { packsRoot });
    expect(result.pack?.manifest.id).toBe(`${model.meta.id}-placeholder`);
    expect(result.pack?.baseUrl).toBe("/packs/medieval-v1");
    expect(result.issues).toEqual([]);
  });

  it("ignora un manifiesto inválido y reporta las incidencias", () => {
    const packsRoot = makeTempPacksRoot();
    writeManifest(packsRoot, "medieval-v1", { id: "medieval-v1" });

    const result = resolveRoomPreviewPack("medieval-v1", loadModel(), { packsRoot });
    expect(result.pack).toBeUndefined();
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(true);
  });
});
