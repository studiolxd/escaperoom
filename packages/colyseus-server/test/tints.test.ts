import { describe, expect, it } from "vitest";
import { PLAYER_TINTS } from "../src/constants";
import { pickPlayerTint } from "../src/tints";

describe("pickPlayerTint", () => {
  it("devuelve el primer color cuando no hay ninguno en uso", () => {
    expect(pickPlayerTint([])).toBe(PLAYER_TINTS[0]);
  });

  it("evita los colores ya en uso", () => {
    expect(pickPlayerTint([PLAYER_TINTS[0], PLAYER_TINTS[1]])).toBe(PLAYER_TINTS[2]);
  });

  it("reutiliza un color liberado sin chocar con los presentes", () => {
    // El jugador del primer color salió: su tinte vuelve a estar libre.
    expect(pickPlayerTint([PLAYER_TINTS[1], PLAYER_TINTS[2]])).toBe(PLAYER_TINTS[0]);
  });

  it("no repite con toda la paleta en uso (devuelve un color válido)", () => {
    expect(PLAYER_TINTS).toContain(pickPlayerTint([...PLAYER_TINTS]));
  });
});
