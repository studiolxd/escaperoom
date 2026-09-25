import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { validateRoomPackage } from "@escaperoom/shared/validator";
import { describe, expect, it } from "vitest";
import {
  buildFlatRecord,
  collection,
  readFlatRecord,
  roomDocToPackage,
  roomPackageToDoc,
  setRoomPlayers,
} from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture: RoomPackage = parseRoomPackage(
  JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
);

/**
 * Ajustes de jugadores del editor (ticket "mínimo y máximo de jugadores"):
 * `setRoomPlayers` escribe `meta.players` en el doc y el validador compartido
 * (el mismo que usa `RoomValidator` del editor) recalcula el aviso
 * `solo_bridge_missing` generalizado a cualquier N en la siguiente lectura,
 * sin que el editor tenga que saber nada de la mecánica cooperativa.
 */
describe("setRoomPlayers — aviso al revés (bajar el rango por debajo de una prueba colocada)", () => {
  it("con el puente declarado, cambiar el rango no genera aviso", () => {
    const doc = roomPackageToDoc(fixture);
    setRoomPlayers(doc, { min: 2, max: 3 });
    const pkg = roomDocToPackage(doc);
    expect(pkg.meta.players).toEqual({ min: 2, max: 3 });
    expect(validateRoomPackage(pkg).ok).toBe(true);
  });

  it("sin puente y una prueba que exige 3 jugadores, bajar el mínimo a 2 avisa solo para 2", () => {
    const doc = roomPackageToDoc(fixture);

    // El puzzle cooperativo del fixture («p-placas-estatuas») pasa a exigir 3
    // jugadores (una placa más) y pierde su objeto-puente.
    const puzzles = collection(doc, "puzzles");
    const record = puzzles.get("p-placas-estatuas");
    if (!record) throw new Error("falta el puzzle de prueba en el fixture");
    const order = record.get("order") as number;
    const value = readFlatRecord(record);
    const plates = value.plates as Array<{ objectId: string; x: number; y: number }>;
    value.plates = [...plates, { objectId: plates[0]!.objectId, x: plates[0]!.x, y: plates[0]!.y }];
    delete value.soloBridgeItemId;
    puzzles.set("p-placas-estatuas", buildFlatRecord(value, order));

    // La sala admitía grupos de 1 a 4; se baja el mínimo a 2 (sigue sin cubrir
    // la exigencia de 3, pero ya no admite 1 jugador en solitario).
    setRoomPlayers(doc, { min: 2, max: 4 });

    const pkg = roomDocToPackage(doc);
    const report = validateRoomPackage(pkg);
    expect(report.ok).toBe(false);
    const solvability = report.checks.find((check) => check.id === "solvability")!;
    const issue = solvability.issues.find((candidate) => candidate.code === "solo_bridge_missing");
    expect(issue).toMatchObject({
      code: "solo_bridge_missing",
      ids: ["p-placas-estatuas"],
      playerCounts: [2],
    });
    expect(issue!.message).toContain("exige pisar 3 placas a la vez");

    // Subir el mínimo a 3 (el nº que exige la prueba) hace desaparecer el aviso.
    setRoomPlayers(doc, { min: 3, max: 4 });
    const raised = validateRoomPackage(roomDocToPackage(doc));
    expect(
      raised.checks
        .find((check) => check.id === "solvability")!
        .issues.some((candidate) => candidate.code === "solo_bridge_missing"),
    ).toBe(false);
  });
});
