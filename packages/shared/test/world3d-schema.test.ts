import { describe, expect, it } from "vitest";
import {
  dimensionOf,
  parseRoomPackage,
  Piece3DSchema,
  positionFromTransform,
  safeParseRoomPackage,
  Transform3DSchema,
  type RoomPackage,
} from "../src/schemas";
import { makeRoom3D } from "./fixtures/room-3d";

/** Formato 3D (encargo 7.1a, specs/27 §3): esquemas Zod del mundo 3D. */

function pieceOf(overrides: Record<string, unknown> = {}) {
  return { id: "p-abcd1234", model: "suelo-piedra-1", x: 1, y: 1, h: 0, yaw: 0, ...overrides };
}

describe("world3d — esquemas", () => {
  it("parseRoomPackage acepta el paquete 3D mínimo", () => {
    const pkg = makeRoom3D();
    expect(pkg.meta.dimension).toBe("3d");
    expect(parseRoomPackage(structuredClone(pkg))).toEqual(pkg);
  });

  it("rechaza yaw: 360 (el rango es [0, 360))", () => {
    expect(Piece3DSchema.safeParse(pieceOf({ yaw: 359.9 })).success).toBe(true);
    expect(Piece3DSchema.safeParse(pieceOf({ yaw: 360 })).success).toBe(false);
    expect(Transform3DSchema.safeParse({ x: 0, y: 0, h: 0, yaw: 360 }).success).toBe(false);
  });

  it("rechaza h negativo y por encima de la altura máxima", () => {
    expect(Piece3DSchema.safeParse(pieceOf({ h: -1 })).success).toBe(false);
    expect(Piece3DSchema.safeParse(pieceOf({ h: 33 })).success).toBe(false);
    expect(Piece3DSchema.safeParse(pieceOf({ h: 32 })).success).toBe(true);
  });

  it("rechaza ids de pieza mal formados", () => {
    for (const id of ["abcd1234", "p-abcd123", "p-ABCD1234", "p-abcd12345", "q-abcd1234"]) {
      expect(Piece3DSchema.safeParse(pieceOf({ id })).success, id).toBe(false);
    }
  });

  it("rechaza escala fuera de [0.1, 10]", () => {
    expect(Piece3DSchema.safeParse(pieceOf({ scale: 0.05 })).success).toBe(false);
    expect(Piece3DSchema.safeParse(pieceOf({ scale: 11 })).success).toBe(false);
    expect(Piece3DSchema.safeParse(pieceOf({ scale: 0.1 })).success).toBe(true);
    expect(Piece3DSchema.safeParse(pieceOf({ scale: 10 })).success).toBe(true);
  });

  it("rechaza coordenadas no finitas o negativas", () => {
    expect(Piece3DSchema.safeParse(pieceOf({ x: -0.1 })).success).toBe(false);
    expect(Piece3DSchema.safeParse(pieceOf({ y: Number.POSITIVE_INFINITY })).success).toBe(false);
  });

  it("acepta h/yaw en un spawn y h en una antorcha, y los valida", () => {
    const pkg = makeRoom3D();
    const bad: RoomPackage = structuredClone(pkg);
    bad.map.rooms[0]!.spawnPoints[0]!.yaw = 360;
    expect(safeParseRoomPackage(bad).success).toBe(false);
    const torch: RoomPackage = structuredClone(pkg);
    torch.map.rooms[0]!.lighting.push({ type: "torch", x: 1, y: 1, h: 1.6 });
    expect(safeParseRoomPackage(torch).success).toBe(true);
    torch.map.rooms[0]!.lighting.push({ type: "torch", x: 1, y: 1, h: -1 });
    expect(safeParseRoomPackage(torch).success).toBe(false);
  });

  it("rechaza un colisionador con tamaño no positivo y una rampa con dirección desconocida", () => {
    const pkg = makeRoom3D();
    const model = pkg.world3d!.models["suelo-test"]!;
    model.colliders = [{ type: "box", cx: 0, cy: 0, ch: 0, sx: 0, sy: 1, sh: 1 }];
    expect(safeParseRoomPackage(pkg).success).toBe(false);
    model.colliders = [
      {
        type: "ramp",
        cx: 0,
        cy: 0,
        sx: 1,
        sy: 2,
        h0: 0,
        h1: 0.4,
        dir: "z+" as unknown as "x+",
      },
    ];
    expect(safeParseRoomPackage(pkg).success).toBe(false);
  });

  it("meta.dimension solo admite 2d o 3d", () => {
    const pkg = makeRoom3D();
    (pkg.meta as { dimension: string }).dimension = "4d";
    expect(safeParseRoomPackage(pkg).success).toBe(false);
  });
});

describe("world3d — helpers", () => {
  it("dimensionOf: ausente = 2d", () => {
    expect(dimensionOf({})).toBe("2d");
    expect(dimensionOf({ dimension: "2d" })).toBe("2d");
    expect(dimensionOf({ dimension: "3d" })).toBe("3d");
  });

  it("positionFromTransform redondea al entero más cercano", () => {
    expect(positionFromTransform({ x: 2.4, y: 2.6 })).toEqual({ x: 2, y: 3 });
    expect(positionFromTransform({ x: 0.2, y: 15.5 })).toEqual({ x: 0, y: 16 });
  });
});
