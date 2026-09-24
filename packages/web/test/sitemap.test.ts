import { describe, expect, it } from "vitest";

/**
 * F-39: `sitemap.ts` paginaba hasta 5 000 salas × 6 locales en cada petición
 * (`force-dynamic`, sin caché). `revalidate = 3600` lo regenera como mucho
 * cada hora en vez de en cada petición del rastreador.
 */
describe("app/sitemap.ts — revalidate en vez de force-dynamic (F-39)", () => {
  it("declara revalidate = 3600 y no force-dynamic", async () => {
    const mod = (await import("../src/app/sitemap")) as {
      revalidate?: number;
      dynamic?: string;
    };
    expect(mod.revalidate).toBe(3600);
    expect(mod.dynamic).not.toBe("force-dynamic");
  });
});
