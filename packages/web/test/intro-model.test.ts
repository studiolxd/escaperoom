import { describe, expect, it } from "vitest";
import { resolveIntroModel } from "../src/lib/intro-model";

const OPTIONS = { locale: "es", defaultLanguage: "es", languages: ["es"] };

describe("resolveIntroModel — narración (audioUrl) de una introducción de texto", () => {
  it("resuelve el audio cuando `resolveAudioUrl` lo puede servir", async () => {
    const model = await resolveIntroModel(
      { type: "text", text: { es: { text: "Bienvenidos" } }, audioUrl: "upload:abc" },
      { ...OPTIONS, resolveAudioUrl: async (ref) => `https://cdn.test/${ref}` },
    );
    expect(model).toEqual({
      kind: "text",
      text: "Bienvenidos",
      audioUrl: "https://cdn.test/upload:abc",
    });
  });

  it("sin `resolveAudioUrl`, o si no puede servirlo, se muestra el texto igual pero sin audio", async () => {
    const withoutResolver = await resolveIntroModel(
      { type: "text", text: { es: { text: "Bienvenidos" } }, audioUrl: "upload:abc" },
      OPTIONS,
    );
    expect(withoutResolver).toEqual({ kind: "text", text: "Bienvenidos" });

    const resolverFails = await resolveIntroModel(
      { type: "text", text: { es: { text: "Bienvenidos" } }, audioUrl: "upload:abc" },
      { ...OPTIONS, resolveAudioUrl: async () => null },
    );
    expect(resolverFails).toEqual({ kind: "text", text: "Bienvenidos" });

    const resolverThrows = await resolveIntroModel(
      { type: "text", text: { es: { text: "Bienvenidos" } }, audioUrl: "upload:abc" },
      {
        ...OPTIONS,
        resolveAudioUrl: async () => {
          throw new Error("caído");
        },
      },
    );
    expect(resolverThrows).toEqual({ kind: "text", text: "Bienvenidos" });
  });

  it("sin `audioUrl` en la introducción, no llama al resolver", async () => {
    let called = false;
    const model = await resolveIntroModel(
      { type: "text", text: { es: { text: "Bienvenidos" } } },
      {
        ...OPTIONS,
        resolveAudioUrl: async (ref) => {
          called = true;
          return ref;
        },
      },
    );
    expect(called).toBe(false);
    expect(model).toEqual({ kind: "text", text: "Bienvenidos" });
  });
});
