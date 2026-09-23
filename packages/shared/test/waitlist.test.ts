import { describe, expect, it } from "vitest";
import {
  createInMemoryWaitlistStore,
  createWaitlistService,
  parseWaitlistInput,
  WaitlistError,
} from "../src/services/waitlist";

describe("waitlist (ticket 6.7, specs/20 §1)", () => {
  describe("parseWaitlistInput", () => {
    it("normaliza el email (recorta y pone en minúsculas) y usa 'es' por defecto", () => {
      const parsed = parseWaitlistInput({ email: "  Ada@Example.COM  " });
      expect(parsed).toEqual({ email: "ada@example.com", locale: "es", source: null });
    });

    it("acepta un locale conocido y una fuente", () => {
      const parsed = parseWaitlistInput({
        email: "ada@example.com",
        locale: "fr",
        source: "landing-hero",
      });
      expect(parsed).toEqual({ email: "ada@example.com", locale: "fr", source: "landing-hero" });
    });

    it("rechaza un email inválido", () => {
      expect(() => parseWaitlistInput({ email: "no-es-un-email" })).toThrow(WaitlistError);
    });

    it("rechaza un email vacío o ausente", () => {
      expect(() => parseWaitlistInput({ email: "" })).toThrow(WaitlistError);
      expect(() => parseWaitlistInput({ email: undefined })).toThrow(WaitlistError);
    });

    it("rechaza un locale desconocido", () => {
      expect(() => parseWaitlistInput({ email: "ada@example.com", locale: "xx" })).toThrow(
        WaitlistError,
      );
    });

    it("rechaza una fuente demasiado larga", () => {
      expect(() =>
        parseWaitlistInput({ email: "ada@example.com", source: "x".repeat(101) }),
      ).toThrow(WaitlistError);
    });
  });

  describe("createWaitlistService", () => {
    it("da de alta un email nuevo", async () => {
      const service = createWaitlistService({ store: createInMemoryWaitlistStore() });
      const result = await service.join({ email: "ada@example.com", locale: "en" });
      expect(result.created).toBe(true);
      expect(result.signup.email).toBe("ada@example.com");
      expect(result.signup.locale).toBe("en");
    });

    it("es idempotente: repetir el email no crea una segunda fila", async () => {
      const service = createWaitlistService({ store: createInMemoryWaitlistStore() });
      const first = await service.join({ email: "ada@example.com" });
      const second = await service.join({ email: "ADA@EXAMPLE.COM" });
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.signup.id).toBe(first.signup.id);
    });

    it("propaga la validación", async () => {
      const service = createWaitlistService({ store: createInMemoryWaitlistStore() });
      await expect(service.join({ email: "invalido" })).rejects.toThrow(WaitlistError);
    });
  });
});
