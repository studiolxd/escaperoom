import { describe, expect, it, vi } from "vitest";
import { CENSOR, SENSITIVE_KEYS, scrub, writeToConsole } from "../src/logger/shared";

describe("scrub (E-10)", () => {
  it("redacta las claves sensibles a cualquier profundidad", () => {
    const result = scrub({
      email: "a@b.example",
      profile: { name: "Ana", contact: { email: "a@b.example", phone: "600000000" } },
    });
    expect(result).toEqual({
      email: CENSOR,
      profile: { name: "Ana", contact: { email: CENSOR, phone: "600000000" } },
    });
  });

  it("redacta dentro de arrays de objetos", () => {
    const result = scrub({
      jobs: [{ id: "1", accessToken: "at1" }, { id: "2", accessToken: "at2" }],
    });
    expect(result).toEqual({
      jobs: [{ id: "1", accessToken: CENSOR }, { id: "2", accessToken: CENSOR }],
    });
  });

  it("cubre authorization, cookie, refreshToken, idToken, apiKey, ipAddress y userAgent", () => {
    const sensitive = [
      "authorization",
      "cookie",
      "accessToken",
      "refreshToken",
      "idToken",
      "apiKey",
      "ipAddress",
      "userAgent",
    ];
    for (const key of sensitive) {
      expect(SENSITIVE_KEYS).toContain(key);
      expect(scrub({ [key]: "valor-secreto" })).toEqual({ [key]: CENSOR });
    }
  });

  it("no redacta 'code' a secas: es un nombre de campo demasiado genérico (códigos de error de dominio)", () => {
    expect(SENSITIVE_KEYS).not.toContain("code");
    expect(scrub({ code: "ALREADY_PROCESSED" })).toEqual({ code: "ALREADY_PROCESSED" });
  });

  it("no distingue mayúsculas/minúsculas", () => {
    expect(scrub({ Authorization: "Bearer x", AccessToken: "at" })).toEqual({
      Authorization: CENSOR,
      AccessToken: CENSOR,
    });
  });

  it("deja pasar valores no sensibles, null, Error y primitivos", () => {
    const err = new Error("boom");
    expect(scrub({ safe: "ok", nothing: null })).toEqual({ safe: "ok", nothing: null });
    expect(scrub(err)).toBe(err);
    expect(scrub("hola" as unknown as Record<string, unknown>)).toBe("hola");
  });
});

describe("writeToConsole (E-10)", () => {
  it("escribe el objeto ya redactado en consola", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeToConsole("info", { token: "secreto" }, "algo pasó");
      expect(log).toHaveBeenCalledWith("algo pasó", { token: CENSOR });
    } finally {
      log.mockRestore();
    }
  });

  it("no toca un Error suelto", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    try {
      writeToConsole("error", err);
      expect(error).toHaveBeenCalledWith(err);
    } finally {
      error.mockRestore();
    }
  });
});
