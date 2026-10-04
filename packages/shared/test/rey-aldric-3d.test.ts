import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generarReyAldric3D, REY_ALDRIC_3D_META } from "../scripts/convertir-sala-3d";
import { parseRoomPackage, positionFromTransform } from "../src/schemas";
import { validateRoomPackage } from "../src/validator";

/**
 * «La Maldición del Rey Aldric» en 3D (encargo 7.10b): fixture generado por el conversor
 * (`pnpm --filter @escaperoom/shared convertir:3d`) y comprobaciones de que se puede resolver.
 */

const leer = (ruta: string): string => readFileSync(fileURLToPath(new URL(`../../../${ruta}`, import.meta.url)), "utf8");

const pkg2D = parseRoomPackage(JSON.parse(leer("docs/reference/roompackage-rey-aldric.v1.json")) as unknown);
const texto3D = leer("docs/reference/roompackage-rey-aldric-3d.v1.json");
const pkg3D = parseRoomPackage(JSON.parse(texto3D) as unknown);

/**
 * Modelos que 7.10a dejó sin exportar (se pintan como caja y el validador avisa `unknown_model`).
 * Hoy ninguno: el catálogo declara todos los que usa la sala. Si aparece alguno, se lista aquí con
 * el motivo; cualquier aviso que no esté en la lista hace fallar el test.
 */
const MODELOS_SIN_EXPORTAR: readonly string[] = [];

describe("fixture del Rey Aldric 3D", () => {
  it("coincide con lo que genera el conversor hoy (nadie lo edita a mano)", () => {
    expect(texto3D).toBe(generarReyAldric3D());
  });

  it("es una sala 3D distinta de la 2D y no toca la 2D", () => {
    expect(pkg3D.meta).toMatchObject({ id: REY_ALDRIC_3D_META.id, title: REY_ALDRIC_3D_META.title, dimension: "3d" });
    expect(pkg2D.meta.dimension).toBeUndefined();
    expect(pkg2D.world3d).toBeUndefined();
  });

  it("reglas, ítems, diálogos y pistas son copia exacta del 2D", () => {
    expect(pkg3D.rules).toEqual(pkg2D.rules);
    expect(pkg3D.items).toEqual(pkg2D.items);
    expect(pkg3D.dialogs).toEqual(pkg2D.dialogs);
    expect(pkg3D.hints).toEqual(pkg2D.hints);
  });
});

describe("Rey Aldric 3D — validación y resolubilidad", () => {
  const report3D = validateRoomPackage(pkg3D);
  const report2D = validateRoomPackage(pkg2D);

  it("pasa el esquema y el validador sin errores", () => {
    expect(report3D.ok).toBe(true);
    expect(report3D.checks.filter((c) => c.status === "error")).toEqual([]);
  });

  it("es resoluble de 1 a 8 jugadores con la misma ruta crítica que el 2D", () => {
    expect(report3D.solvability.map((s) => s.playerCount)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const pasos = (route: { kind: string; subjectId: string; puzzleType?: string; itemsGained: string[] }[] | null) =>
      route?.map((s) => ({ kind: s.kind, subjectId: s.subjectId, puzzleType: s.puzzleType, itemsGained: s.itemsGained }));
    for (const [i, result] of report3D.solvability.entries()) {
      expect(result.solvable).toBe(true);
      expect(pasos(result.route)).toEqual(pasos(report2D.solvability[i]!.route));
    }
  });

  it("sin avisos unknown_model ni unknown_clip (salvo los modelos sin exportar listados)", () => {
    const avisos = report3D.checks
      .flatMap((c) => c.issues)
      .filter((i) => i.code === "unknown_model" || i.code === "unknown_clip");
    const inesperados = avisos.filter((i) => !MODELOS_SIN_EXPORTAR.some((m) => i.message.includes(`«${m}»`)));
    expect(inesperados).toEqual([]);
  });

  it("cada objeto tiene `transform` dentro de su habitación y `position` coherente", () => {
    const rooms = new Map(pkg3D.map.rooms.map((r) => [r.id, r.grid]));
    expect(pkg3D.objects).toHaveLength(pkg2D.objects.length);
    for (const object of pkg3D.objects) {
      const grid = rooms.get(object.roomId)!;
      const t = object.transform!;
      expect(t, object.id).toBeDefined();
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(grid.cols);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(grid.rows);
      expect(object.position, object.id).toEqual(positionFromTransform(t));
      expect(object.footprint, object.id).toBeUndefined();
    }
  });

  it("todas las piezas caen dentro de su habitación y sus ids son únicos", () => {
    const ids = new Set<string>();
    for (const room of pkg3D.map.rooms) {
      expect(room.layers).toEqual([]);
      expect(room.decorations).toEqual([]);
      for (const piece of pkg3D.world3d!.rooms[room.id]!.pieces) {
        expect(piece.x).toBeLessThanOrEqual(room.grid.cols);
        expect(piece.y).toBeLessThanOrEqual(room.grid.rows);
        expect(ids.has(piece.id)).toBe(false);
        ids.add(piece.id);
      }
    }
    expect(ids.size).toBeGreaterThan(700); // 20×14 + 18×12 + 20×20 celdas, y 6 canales
  });
});
