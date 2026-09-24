import { describe, expect, it } from "vitest";
import { resolveGoogleSocialProviders } from "../src/lib/auth-google-provider";

describe("resolveGoogleSocialProviders (A-17)", () => {
  it("sin credenciales, ningún proveedor (antes se registraba con claves vacías)", () => {
    expect(resolveGoogleSocialProviders({})).toBeUndefined();
    expect(resolveGoogleSocialProviders({ GOOGLE_CLIENT_ID: "id-only" })).toBeUndefined();
    expect(resolveGoogleSocialProviders({ GOOGLE_CLIENT_SECRET: "secret-only" })).toBeUndefined();
    expect(resolveGoogleSocialProviders({ GOOGLE_CLIENT_ID: "  ", GOOGLE_CLIENT_SECRET: "" })).toBeUndefined();
  });

  it("con ambas variables, registra el proveedor", () => {
    expect(
      resolveGoogleSocialProviders({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }),
    ).toEqual({ google: { clientId: "id", clientSecret: "secret" } });
  });
});
