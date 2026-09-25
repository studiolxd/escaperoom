import { describe, expect, it } from "vitest";
import { FALLBACK_CHARACTER_ID, isCharacterAvailable, pickPlayerCharacter } from "../src/characters";

const AVAILABLE = ["caballero-m"];

describe("pickPlayerCharacter", () => {
  it("asigna el primer personaje libre cuando no hay ninguno en uso", () => {
    expect(pickPlayerCharacter(AVAILABLE, [])).toBe("caballero-m");
  });

  it("cae al maniquí de reserva cuando no queda ningún personaje libre", () => {
    // Solo hay `caballero-m` hoy: el segundo jugador ya no tiene sitio.
    expect(pickPlayerCharacter(AVAILABLE, ["caballero-m"])).toBe(FALLBACK_CHARACTER_ID);
  });

  it("con varios personajes disponibles, elige el primero libre", () => {
    const many = ["caballero-m", "arquero-m", "mago-m"];
    expect(pickPlayerCharacter(many, ["caballero-m"])).toBe("arquero-m");
  });

  it("sin personajes en el pack, cae directo al maniquí de reserva", () => {
    expect(pickPlayerCharacter([], [])).toBe(FALLBACK_CHARACTER_ID);
  });
});

describe("isCharacterAvailable", () => {
  it("acepta un personaje del pack que no está en uso", () => {
    expect(isCharacterAvailable("caballero-m", AVAILABLE, [])).toBe(true);
  });

  it("rechaza un personaje del pack ya ocupado (resuelve la carrera de dos que eligen a la vez)", () => {
    expect(isCharacterAvailable("caballero-m", AVAILABLE, ["caballero-m"])).toBe(false);
  });

  it("rechaza un characterId que no existe en el pack", () => {
    expect(isCharacterAvailable("mago-m", AVAILABLE, [])).toBe(false);
  });

  it("el maniquí de reserva siempre está disponible, incluso repetido", () => {
    expect(isCharacterAvailable(FALLBACK_CHARACTER_ID, AVAILABLE, [FALLBACK_CHARACTER_ID])).toBe(
      true,
    );
  });
});
