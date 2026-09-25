import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRoomPackage, toRuntimeModel, type RuntimeModel } from "../src/loader";
import {
  PackManifestSchema,
  buildCollisionGrid,
  buildPlaceholderManifest,
  collectRequiredFrames,
  defaultAvatarAnims,
  directionFromGridDelta,
  parsePackManifest,
  resolveIconFrame,
  resolveSpriteFrame,
  resolveTileFrame,
  spriteOrigin,
  spriteSize,
  tileCollides,
  tileOrigin,
  tileSize,
  validateAtlasFrames,
  validatePack,
  validatePackAgainstModel,
  type PackManifest,
} from "../src/pack";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function loadModel(): RuntimeModel {
  const raw: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  return toRuntimeModel(loadRoomPackage(raw));
}

function validManifest(): PackManifest {
  return {
    id: "medieval-v1",
    version: "1.0.0",
    packageFormat: "roompackage/v1",
    projection: { tileWidth: 64, tileHeight: 32, scale: 1 },
    atlases: [
      { key: "tiles", image: "atlas-tiles.png", data: "atlas-tiles.json" },
      { key: "sprites", image: "atlas-sprites.png", data: "atlas-sprites.json" },
    ],
    tiles: {
      "1": { frame: "tile-1", collides: false },
      "10": { frame: "tile-10", collides: true },
    },
    sprites: { "cuadro-rey": { frame: "cuadro-rey" } },
    anims: [],
    ui: { icons: { "icon-llave-bronce": "icon-llave-bronce" } },
    fx: { spark: "fx-spark" },
    keys: ["tiles", "sprites"],
  };
}

describe("PackManifestSchema (specs/26 §6)", () => {
  it("acepta un manifiesto válido", () => {
    const manifest = parsePackManifest(validManifest());
    expect(manifest.id).toBe("medieval-v1");
    expect(manifest.tiles["10"]).toEqual({ frame: "tile-10", collides: true });
    expect(PackManifestSchema.safeParse(validManifest()).success).toBe(true);
  });

  it("rechaza una proyección que no es 2:1", () => {
    const manifest = {
      ...validManifest(),
      projection: { tileWidth: 64, tileHeight: 48, scale: 1 },
    };
    const result = PackManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => /2:1/.test(issue.message))).toBe(true);
    }
  });

  it("exige collides explícito en cada entrada de tiles", () => {
    const manifest = validManifest();
    // @ts-expect-error se elimina a propósito para probar la validación
    delete manifest.tiles["10"].collides;
    const result = PackManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "tiles.10.collides"),
      ).toBe(true);
    }
  });

  it("rechaza claves de atlas que no existen en atlases", () => {
    const manifest = { ...validManifest(), keys: ["tiles", "inexistente"] };
    const result = PackManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it('rechaza el tileId "0" (celda vacía)', () => {
    const manifest = validManifest();
    manifest.tiles["0"] = { frame: "tile-0", collides: false };
    const result = PackManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("avisa (sin error) si la proyección no es la 64×32 de v1", () => {
    const manifest = validManifest();
    manifest.projection = { tileWidth: 128, tileHeight: 64, scale: 2 };
    const result = validatePack(manifest, loadModel());
    expect(result.issues.some((issue) => issue.severity === "warning")).toBe(true);
  });

  it("acepta avatars y avatarOrigin (A1/A4/B1)", () => {
    const manifest = {
      ...validManifest(),
      avatars: [{ id: "caballero-m", label: { es: { text: "Caballero" } } }],
      avatarOrigin: [0.5, 0.886] as [number, number],
    };
    const result = PackManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("sin avatars ni avatarOrigin (packs antiguos) sigue siendo válido", () => {
    expect(PackManifestSchema.safeParse(validManifest()).success).toBe(true);
  });

  it("rechaza personajes duplicados en avatars", () => {
    const manifest = {
      ...validManifest(),
      avatars: [
        { id: "caballero-m", label: { es: { text: "Caballero" } } },
        { id: "caballero-m", label: { es: { text: "Otro" } } },
      ],
    };
    const result = PackManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });
});

describe("resolución de frames por nombre (specs/26 §3.3)", () => {
  it("usa el frame declarado por el manifiesto", () => {
    const manifest = validManifest();
    manifest.sprites["cuadro-rey"] = { frame: "cuadro-rey-torcido" };
    manifest.ui.icons["icon-llave-bronce"] = "icon-bronce-alt";
    manifest.tiles["10"] = { frame: "muro", collides: true };

    expect(resolveSpriteFrame(manifest, "cuadro-rey")).toBe("cuadro-rey-torcido");
    expect(resolveIconFrame(manifest, "icon-llave-bronce")).toBe("icon-bronce-alt");
    expect(resolveTileFrame(manifest, 10)).toBe("muro");
  });

  it("cae al nombre canónico cuando el manifiesto no lo declara", () => {
    expect(resolveSpriteFrame(undefined, "arca-cerrada")).toBe("arca-cerrada");
    expect(resolveIconFrame(undefined, "icon-vela")).toBe("icon-vela");
    expect(resolveTileFrame(undefined, 7)).toBe("tile-7");
  });

  it("no infiere la colisión del número de tile", () => {
    expect(tileCollides(undefined, 10)).toBe(false);
    expect(tileCollides(validManifest(), 10)).toBe(true);
    expect(tileCollides(validManifest(), 1)).toBe(false);
  });
});

describe("collectRequiredFrames y validador de pack", () => {
  it("enumera tiles, sprites e iconos del fixture del Rey Aldric", () => {
    const required = collectRequiredFrames(loadModel());
    expect(required.tiles).toEqual([1, 2, 3, 10, 20, 21, 22]);
    expect(required.sprites).toContain("cuadro-rey");
    expect(required.sprites).toContain("cuadro-rey-torcido");
    expect(required.sprites).toContain("tapiz-dragones");
    expect(required.icons).toHaveLength(10);
    expect(required.icons).toContain("icon-llave-oro");
  });

  it("validatePackAgainstModel reporta los frames que faltan", () => {
    const issues = validatePackAgainstModel(validManifest(), loadModel());
    const paths = issues.map((issue) => issue.path);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
    expect(paths).toContain("tiles.2");
    expect(paths).toContain("sprites.arca-cerrada-der");
    expect(paths).toContain("ui.icons.icon-vela");
  });

  it("el manifiesto sintético cubre todo el modelo y pasa la validación", () => {
    const model = loadModel();
    const manifest = buildPlaceholderManifest(model);
    const result = validatePack(manifest, model);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("validateAtlasFrames detecta frames declarados que no están en ningún atlas", () => {
    const model = loadModel();
    const manifest = buildPlaceholderManifest(model);
    const issues = validateAtlasFrames(manifest, {});
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);

    const allFrames = new Set<string>();
    for (const entry of Object.values(manifest.tiles)) allFrames.add(entry.frame);
    for (const entry of Object.values(manifest.sprites)) allFrames.add(entry.frame);
    for (const frame of Object.values(manifest.ui.icons)) allFrames.add(frame);
    allFrames.add(manifest.fx.spark);
    for (const anim of manifest.anims) for (const frame of anim.frames) allFrames.add(frame);
    expect(validateAtlasFrames(manifest, { sprites: allFrames })).toEqual([]);
  });
});

describe("placeholder", () => {
  it("marca el muro 10 como colisión y el suelo como transitable", () => {
    const manifest = buildPlaceholderManifest(loadModel());
    expect(manifest.tiles["10"]?.collides).toBe(true);
    expect(manifest.tiles["1"]?.collides).toBe(false);
    expect(manifest.tiles["20"]?.collides).toBe(false);
  });

  it("declara las animaciones mínimas del avatar (idle/walk/interact ×4)", () => {
    const manifest = buildPlaceholderManifest(loadModel());
    expect(manifest.anims).toHaveLength(12);
    expect(manifest.anims.map((anim) => anim.key)).toContain("avatar-avatar-n-walk");
    expect(
      defaultAvatarAnims(["avatar"]).find((anim) => anim.key === "avatar-avatar-s-idle")?.frames,
    ).toEqual([
      "avatar-avatar-s-idle-1",
      "avatar-avatar-s-idle-2",
      "avatar-avatar-s-idle-3",
      "avatar-avatar-s-idle-4",
      "avatar-avatar-s-idle-5",
      "avatar-avatar-s-idle-6",
      "avatar-avatar-s-idle-7",
      "avatar-avatar-s-idle-8",
    ]);
  });

  it("defaultAvatarAnims genera animaciones para varios personajes", () => {
    const anims = defaultAvatarAnims(["caballero-m", "maniqui"]);
    expect(anims).toHaveLength(24);
    expect(anims.map((anim) => anim.key)).toContain("avatar-caballero-m-e-interact");
    expect(anims.map((anim) => anim.key)).toContain("avatar-maniqui-w-idle");
  });

  it("proyecta el delta de rejilla a las 4 direcciones (paso diagonal)", () => {
    expect(directionFromGridDelta(-1, -1)).toBe("n");
    expect(directionFromGridDelta(1, 1)).toBe("s");
    expect(directionFromGridDelta(1, -1)).toBe("e");
    expect(directionFromGridDelta(-1, 1)).toBe("w");
  });

  it("proyecta el delta de rejilla a las 4 direcciones (paso de un solo eje, B2)", () => {
    // Antes de B2, un paso de un solo eje (WASD) siempre daba "e"/"w", nunca
    // "n"/"s": este es el caso que reproducía el fallo.
    expect(directionFromGridDelta(1, 0)).toBe("e");
    expect(directionFromGridDelta(-1, 0)).toBe("w");
    expect(directionFromGridDelta(0, 1)).toBe("s");
    expect(directionFromGridDelta(0, -1)).toBe("n");
  });
});

describe("colisión desde el manifiesto", () => {
  it("bloquea celdas de muro y objetos, y deja libres suelo y puertas", () => {
    const model = loadModel();
    const manifest = buildPlaceholderManifest(model);
    const salon = model.subroomsById["salon-trono"];
    if (!salon) throw new Error("falta la habitación salon-trono");

    const grid = buildCollisionGrid(salon, { manifest });
    expect(grid.blocks(0, 0)).toBe(true);
    expect(grid.blocks(5, 5)).toBe(false);
    expect(grid.blocks(10, 1)).toBe(true);
    expect(grid.blocks(10, 13)).toBe(false);
  });

  it("sin manifiesto ningún tile colisiona (solo los objetos sólidos)", () => {
    const model = loadModel();
    const salon = model.subroomsById["salon-trono"];
    if (!salon) throw new Error("falta la habitación salon-trono");

    const grid = buildCollisionGrid(salon);
    expect(grid.blocks(0, 0)).toBe(false);
    expect(grid.blocks(10, 1)).toBe(true);
  });

  it("trata fuera de la rejilla como bloqueado", () => {
    const model = loadModel();
    const salon = model.subroomsById["salon-trono"];
    if (!salon) throw new Error("falta la habitación salon-trono");

    const grid = buildCollisionGrid(salon, { manifest: buildPlaceholderManifest(model) });
    expect(grid.blocks(-1, 0)).toBe(true);
    expect(grid.blocks(salon.width, salon.height)).toBe(true);
  });

  it("la huella de varias celdas (footprint) también bloquea, además del ancla", () => {
    const model = loadModel();
    const bodega = model.subroomsById["bodega"];
    if (!bodega) throw new Error("falta la habitación bodega");

    const grid = buildCollisionGrid(bodega);
    // mesa-catas está en (9,6) con footprint 1×3 en (8,6) y (10,6) (specs/26 §2).
    expect(grid.blocks(9, 6)).toBe(true);
    expect(grid.blocks(8, 6)).toBe(true);
    expect(grid.blocks(10, 6)).toBe(true);
    expect(grid.blocks(7, 6)).toBe(false);
  });
});

describe("size/origin por frame (specs/26 §3.2)", () => {
  it("PackTileEntrySchema/PackSpriteEntrySchema aceptan size/origin opcionales", () => {
    const manifest = {
      ...validManifest(),
      tiles: {
        ...validManifest().tiles,
        "10": { frame: "tile-10", collides: true, size: [64, 136], origin: [0.5, 1] },
      },
      sprites: { arca: { frame: "arca", size: [102, 92], origin: [0.5, 0.9782] } },
    };
    const result = PackManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tiles["10"]?.size).toEqual([64, 136]);
      expect(result.data.sprites.arca?.origin).toEqual([0.5, 0.9782]);
    }
  });

  it("un origen puede salir de [0, 1] (p. ej. la mirilla)", () => {
    const manifest = {
      ...validManifest(),
      sprites: { mirilla: { frame: "mirilla", origin: [1.09, 0.5] } },
    };
    expect(PackManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("tileSize/tileOrigin y spriteSize/spriteOrigin caen a los valores por defecto sin entrada", () => {
    const manifest = validManifest();
    expect(tileSize(manifest, 1)).toBeUndefined();
    expect(tileOrigin(manifest, 1)).toEqual([0.5, 1]);
    expect(spriteSize(manifest, "no-declarado")).toBeUndefined();
    expect(spriteOrigin(manifest, "no-declarado")).toEqual([0.5, 1]);
  });

  it("tileSize/tileOrigin y spriteSize/spriteOrigin devuelven lo declarado por el manifiesto", () => {
    const manifest: PackManifest = {
      ...validManifest(),
      tiles: { "10": { frame: "tile-10", collides: true, size: [64, 136], origin: [0.5, 1] } },
      sprites: { arca: { frame: "arca", size: [102, 92], origin: [0.5, 0.9782] } },
    };
    expect(tileSize(manifest, 10)).toEqual([64, 136]);
    expect(spriteSize(manifest, "arca")).toEqual([102, 92]);
    expect(spriteOrigin(manifest, "arca")).toEqual([0.5, 0.9782]);
  });
});
