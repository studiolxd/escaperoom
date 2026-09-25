import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { createRoomSession } from "@escaperoom/shared/session";
import { REY_ALDRIC_STEP_IDS, reyAldricSteps } from "../src/lib/rey-aldric-route";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const room = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function done(session: ReturnType<typeof createRoomSession>): string[] {
  return reyAldricSteps(session)
    .filter((step) => step.done)
    .map((step) => step.id);
}

describe("ruta crítica del playtest (2.8)", () => {
  it("lista los 14 pasos de las notas de diseño, todos pendientes al empezar", () => {
    const session = createRoomSession(room, { playerIds: ["p1"] });
    session.start(0);
    expect(REY_ALDRIC_STEP_IDS).toHaveLength(14);
    expect(done(session)).toEqual([]);
  });

  it("marca los pasos a partir del estado real de la sesión", () => {
    const session = createRoomSession(room, { playerIds: ["p1"] });
    session.start(0);
    session.interact("cuadro-aurelio", 1);
    session.useItemOnObject("llave-bronce", "armario", 2);
    session.combine("p-combina", ["yesquero", "vela"], 3);
    session.interact("brasero", 4);
    session.attemptCode("p-candado-arca", "4732", 5);
    expect(done(session)).toEqual(["cuadro", "armario", "antorcha", "brasero", "arca"]);
  });
});
