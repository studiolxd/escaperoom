import { describe, expect, it } from "vitest";
import {
  INTRO_DIALOG_ID,
  combineInputs,
  isIntroOpen,
  isWorldInputEnabled,
  toggleSelection,
} from "../src/lib/playtest-state";

describe("intro bloquea el juego", () => {
  it("reconoce el diálogo de intro", () => {
    expect(isIntroOpen({ id: INTRO_DIALOG_ID, text: "x" })).toBe(true);
    expect(isIntroOpen({ id: "d-brasero", text: "x" })).toBe(false);
    expect(isIntroOpen(null)).toBe(false);
  });

  it("deshabilita el input del mundo hasta cerrar la intro", () => {
    expect(isWorldInputEnabled({ introOpen: true, inventoryOpen: false })).toBe(false);
    expect(isWorldInputEnabled({ introOpen: false, inventoryOpen: false })).toBe(true);
  });
});

describe("el inventario abierto no propaga clics al mundo", () => {
  it("deshabilita el mundo con el inventario abierto", () => {
    expect(isWorldInputEnabled({ introOpen: false, inventoryOpen: true })).toBe(false);
  });

  it("también lo deshabilita con un panel modal abierto", () => {
    expect(isWorldInputEnabled({ introOpen: false, inventoryOpen: false, panelOpen: true })).toBe(
      false,
    );
  });
});

describe("combinar con dos seleccionados", () => {
  it("selecciona, deselecciona y reemplaza al más antiguo", () => {
    let staged: string[] = [];
    staged = toggleSelection(staged, "yesquero");
    staged = toggleSelection(staged, "vela");
    expect(staged).toEqual(["yesquero", "vela"]);

    // Un tercero reemplaza al más antiguo.
    staged = toggleSelection(staged, "llave-bronce");
    expect(staged).toEqual(["vela", "llave-bronce"]);

    // Pulsar uno seleccionado lo quita.
    staged = toggleSelection(staged, "vela");
    expect(staged).toEqual(["llave-bronce"]);
  });

  it("combina dos items distintos o uno solo (receta de un ingrediente)", () => {
    expect(combineInputs(["yesquero", "vela"])).toEqual(["yesquero", "vela"]);
    expect(combineInputs(["llave-plata"])).toEqual(["llave-plata"]);
    expect(combineInputs([])).toBeNull();
    expect(combineInputs(["yesquero", "yesquero"])).toBeNull();
  });
});
