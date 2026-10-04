import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getModels3DCatalog, type Models3DCatalog } from "../src/packs";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import { MAX_WORLD3D_CUSTOM_MODELS } from "../src/schemas/limits";
import {
  renderValidationReport,
  validateRoomPackage,
  type ValidationCheckId,
  type ValidationReport,
} from "../src/validator";
import { checkWorld3D, checkWorld3DModels } from "../src/validator/checks3d";
import { makeRoom3D } from "./fixtures/room-3d";

/** Validador del modo 3D (encargo 7.1a §3): un caso por código de specs/27 §3 y §4. */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function codes(pkg: RoomPackage): string[] {
  return checkWorld3D(pkg).map((issue) => issue.code);
}

function checkOf(report: ValidationReport, id: ValidationCheckId) {
  return report.checks.find((check) => check.id === id)!;
}

describe("validador 3D — paquetes correctos", () => {
  it("un paquete 3D correcto no tiene issues ni errores", () => {
    const pkg = makeRoom3D();
    expect(checkWorld3D(pkg)).toEqual([]);
    expect(checkWorld3DModels(pkg)).toEqual([]);
    const report = validateRoomPackage(pkg);
    expect(report.ok).toBe(true);
    expect(checkOf(report, "world3d")).toMatchObject({ status: "ok", passed: true });
    expect(checkOf(report, "world3d").summary).toBe("Mundo 3D íntegro");
    expect(checkOf(report, "world3d_models")).toMatchObject({ status: "ok", passed: true });
    expect(checkOf(report, "world3d_models").summary).toBe("Modelos 3D conocidos");
  });

  it("el Rey Aldric (2D) no tiene issues nuevos y su informe de texto no cambia", () => {
    const report = validateRoomPackage(reyAldric);
    expect(report.ok).toBe(true);
    expect(checkOf(report, "world3d").issues).toEqual([]);
    expect(checkOf(report, "world3d_models").issues).toEqual([]);
    expect(renderValidationReport(report)).not.toMatch(/3D/);
  });
});

describe("validador 3D — checkWorld3D en una sala 2D", () => {
  it("world3d en 2D: dimension_field_in_2d", () => {
    const pkg = structuredClone(reyAldric);
    pkg.world3d = { rooms: {}, models: {} };
    expect(codes(pkg)).toEqual(["dimension_field_in_2d"]);
  });

  it("transform en un objeto 2D: un issue con el id del objeto", () => {
    const pkg = structuredClone(reyAldric);
    const object = pkg.objects[0]!;
    object.transform = { x: 1, y: 1, h: 0, yaw: 0 };
    const issues = checkWorld3D(pkg);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "dimension_field_in_2d", ids: [object.id] });
  });

  it("h/yaw en un spawn y h en una antorcha 2D: un issue por caso", () => {
    const pkg = structuredClone(reyAldric);
    const room = pkg.map.rooms[0]!;
    room.spawnPoints[0]!.h = 1;
    room.spawnPoints[1]!.yaw = 90;
    room.lighting.push({ type: "torch", x: 1, y: 1, h: 1.6, objectId: "antorcha-x" });
    const issues = checkWorld3D(pkg);
    expect(issues.map((i) => i.code)).toEqual([
      "dimension_field_in_2d",
      "dimension_field_in_2d",
      "dimension_field_in_2d",
    ]);
    expect(issues.map((i) => i.ids[0])).toEqual([
      room.spawnPoints[0]!.id,
      room.spawnPoints[1]!.id,
      "antorcha-x",
    ]);
    const report = validateRoomPackage(pkg);
    expect(checkOf(report, "world3d").status).toBe("error");
    expect(report.ok).toBe(false);
  });
});

describe("validador 3D — checkWorld3D en una sala 3D", () => {
  it("world3d_missing: falta world3d y no se sigue con el resto", () => {
    const pkg = makeRoom3D();
    delete pkg.world3d;
    pkg.objects[0]!.transform = undefined;
    expect(codes(pkg)).toEqual(["world3d_missing"]);
  });

  it("layers_in_3d: layers o decorations no vacíos", () => {
    const withLayers = makeRoom3D();
    withLayers.map.rooms[0]!.layers = [{ name: "ground", rle: [16, 1] }];
    expect(codes(withLayers)).toEqual(["layers_in_3d"]);
    const withDecorations = makeRoom3D();
    withDecorations.map.rooms[0]!.decorations = [{ sprite: "barril", x: 1, y: 1 }];
    expect(codes(withDecorations)).toEqual(["layers_in_3d"]);
  });

  it("world3d_unknown_room: clave de world3d.rooms que no es una habitación", () => {
    const pkg = makeRoom3D();
    pkg.world3d!.rooms["fantasma"] = { pieces: [] };
    const issues = checkWorld3D(pkg);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "world3d_unknown_room", ids: ["fantasma"] });
  });

  it("transform_missing: objeto sin transform", () => {
    const pkg = makeRoom3D();
    delete pkg.objects[0]!.transform;
    expect(codes(pkg)).toEqual(["transform_missing"]);
  });

  it("transform_position_mismatch: position distinta de la derivada del transform", () => {
    const pkg = makeRoom3D();
    pkg.objects[0]!.position = { x: 0, y: 0 };
    const issues = checkWorld3D(pkg);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "transform_position_mismatch", ids: ["arca"] });
  });

  it("out_of_bounds_3d: transform de objeto o pieza fuera de la caja de su habitación", () => {
    const object = makeRoom3D();
    object.objects[0]!.transform = { x: 4.5, y: 2.2, h: 0, yaw: 0 };
    object.objects[0]!.position = { x: 5, y: 2 };
    expect(codes(object)).toEqual(["out_of_bounds_3d"]);

    const piece = makeRoom3D();
    piece.world3d!.rooms["sala"]!.pieces[0]!.y = 4.5;
    const issues = checkWorld3D(piece);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "out_of_bounds_3d", ids: ["p-suelo000"] });

    const edge = makeRoom3D();
    edge.world3d!.rooms["sala"]!.pieces[0]!.x = 4;
    expect(codes(edge)).toEqual([]);
  });

  it("piece_id_duplicate: dos piezas con el mismo id (incluso en habitaciones distintas)", () => {
    const pkg = makeRoom3D();
    pkg.map.rooms.push({ ...structuredClone(pkg.map.rooms[0]!), id: "otra" });
    pkg.world3d!.rooms["otra"] = {
      pieces: [{ id: "p-suelo000", model: "suelo-test", x: 1, y: 1, h: 0, yaw: 0 }],
    };
    const issues = checkWorld3D(pkg);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "piece_id_duplicate", ids: ["p-suelo000"] });
  });

  it("footprint_in_3d: un objeto declara footprint", () => {
    const pkg = makeRoom3D();
    pkg.objects[0]!.footprint = [{ x: 3, y: 3 }];
    expect(codes(pkg)).toEqual(["footprint_in_3d"]);
  });

  it("custom_models_limit: más de 40 modelos propios", () => {
    const pkg = makeRoom3D();
    const template = pkg.world3d!.models["suelo-test"]!;
    for (let i = 0; i < MAX_WORLD3D_CUSTOM_MODELS; i += 1) {
      pkg.world3d!.models[`extra-${i}`] = structuredClone(template);
    }
    expect(Object.keys(pkg.world3d!.models).length).toBeGreaterThan(MAX_WORLD3D_CUSTOM_MODELS);
    expect(codes(pkg)).toEqual(["custom_models_limit"]);
  });

  it("checkGeometry sigue comprobando position y spawns contra grid en 3D", () => {
    const pkg = makeRoom3D();
    pkg.map.rooms[0]!.spawnPoints[0]!.x = 9;
    const report = validateRoomPackage(pkg);
    expect(checkOf(report, "geometry").status).toBe("error");
  });
});

describe("validador 3D — checkWorld3DModels (avisos)", () => {
  it("unknown_model: pieza, sprite del objeto y sprite de un estado", () => {
    const pkg = makeRoom3D();
    pkg.world3d!.rooms["sala"]!.pieces[0]!.model = "columna-rara";
    pkg.objects[0]!.sprite = "arca-rara";
    pkg.objects[0]!.states = { closed: "arca-test", open: { sprite: "arca-abierta-rara" } };
    const issues = checkWorld3DModels(pkg);
    expect(issues.map((i) => i.code)).toEqual(["unknown_model", "unknown_model", "unknown_model"]);
    expect(issues.map((i) => i.ids[0])).toEqual(["p-suelo000", "arca", "arca"]);
    const report = validateRoomPackage(pkg);
    const check = checkOf(report, "world3d_models");
    expect(check.status).toBe("warning");
    expect(check.summary).toBe("Modelos 3D desconocidos: 3");
    expect(report.ok).toBe(true);
  });

  it("resuelve contra el catálogo del pack cuando se le pasa uno", () => {
    const pkg = makeRoom3D();
    pkg.world3d!.rooms["sala"]!.pieces[0]!.model = "muro";
    const catalog: Models3DCatalog = {
      packId: "medieval-v1",
      version: "0.0.1",
      models: {
        muro: {
          file: "models/muro.glb",
          category: "muro",
          label: { es: { text: "Muro" } },
          size: { w: 1, d: 1, hgt: 2.4 },
          colliders: [],
          snap: true,
          clips: [],
        },
      },
      avatars: {},
    };
    expect(checkWorld3DModels(pkg)).toHaveLength(1);
    expect(checkWorld3DModels(pkg, catalog)).toEqual([]);
    expect(getModels3DCatalog(pkg.map.tileset)).toBeDefined();
  });

  it("unknown_clip: el estado declara una animación que el modelo no trae", () => {
    const pkg = makeRoom3D();
    pkg.objects[0]!.states = {
      closed: "arca-test",
      open: { sprite: "arca-test", animation: "abrir" },
      broken: { animation: "romper" },
    };
    const issues = checkWorld3DModels(pkg);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "unknown_clip", ids: ["arca"] });
    expect(issues[0]!.message).toContain("romper");
  });

  it("en una sala 2D no avisa de nada", () => {
    expect(checkWorld3DModels(reyAldric)).toEqual([]);
  });
});
