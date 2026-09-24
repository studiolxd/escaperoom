import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOrigin } from "../src/app/[locale]/(play)/oauth/consent/page";

/**
 * F-13: el issuer del OAuth del MCP se construía con `requestOrigin(headers)`,
 * que leía `x-forwarded-host`/`host` — cabeceras que decide el cliente si el
 * proxy no las sobrescribe. `getMcpOAuthProvider` pasa este valor a
 * `publicOrigin`, que ya prioriza `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`
 * sobre él, pero solo cuando esas variables SÍ están configuradas: en un
 * despliegue de producción que las olvide, el valor de las cabeceras se
 * usaría igualmente como issuer. `requestOrigin` ya no debe derivarse de
 * cabeceras fuera de desarrollo, pase lo que pase.
 */
describe("requestOrigin — issuer del OAuth nunca desde x-forwarded-host/host en producción (F-13)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("en producción ignora el Host aunque un atacante lo manipule", () => {
    vi.stubEnv("NODE_ENV", "production");
    const headers = new Headers({
      host: "atacante.example",
      "x-forwarded-host": "atacante.example",
    });
    expect(requestOrigin(headers)).not.toContain("atacante.example");
  });

  it("en desarrollo sí puede leer el Host (comodidad local, sin envs configuradas)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const headers = new Headers({ host: "localhost:4000" });
    expect(requestOrigin(headers)).toBe("http://localhost:4000");
  });
});
