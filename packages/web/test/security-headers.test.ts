import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import {
  API_CONTENT_SECURITY_POLICY,
  buildContentSecurityPolicy,
  reportToHeaderValue,
  serviceOrigins,
  staticSecurityHeaders,
} from "../src/lib/security-headers";
import proxy from "../src/proxy";

/**
 * CSP y cabeceras de seguridad (ticket 6.3, specs/13 §11): la política pura, la
 * respuesta de página que produce `proxy.ts` y las cabeceras fijas de
 * `next.config.ts`.
 */

function directive(csp: string, name: string): string[] {
  const found = csp.split("; ").find((part) => part.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("buildContentSecurityPolicy", () => {
  const prod = buildContentSecurityPolicy("abc123", {
    NODE_ENV: "production",
    NEXT_PUBLIC_COLYSEUS_URL: "wss://play.example.com",
    NEXT_PUBLIC_EDITOR_SYNC_URL: "wss://sync.example.com",
    LIVEKIT_URL: "wss://escaperoom.livekit.cloud",
    STORAGE_ENDPOINT: "https://cuenta.r2.cloudflarestorage.com",
  });

  it("script-src estricta: nonce + strict-dynamic, sin unsafe-inline ni unsafe-eval", () => {
    const scripts = directive(prod, "script-src");
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("connect-src abre Colyseus (HTTP + WS), el editor, LiveKit y el bucket", () => {
    const connect = directive(prod, "connect-src");
    expect(connect).toEqual(
      expect.arrayContaining([
        "'self'",
        "wss://play.example.com",
        "https://play.example.com",
        "wss://sync.example.com",
        "wss://escaperoom.livekit.cloud",
        "wss://*.livekit.cloud",
        "https://cuenta.r2.cloudflarestorage.com",
      ]),
    );
  });

  it("connect-src abre el origen de ingesta del DSN de Sentry (F-12)", () => {
    const withSentry = buildContentSecurityPolicy("abc123", {
      NODE_ENV: "production",
      NEXT_PUBLIC_SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
    });
    expect(directive(withSentry, "connect-src")).toContain("https://o0.ingest.sentry.io");
  });

  it("sin NEXT_PUBLIC_SENTRY_DSN no añade nada a connect-src", () => {
    expect(directive(prod, "connect-src")).not.toEqual(
      expect.arrayContaining([expect.stringContaining("sentry")]),
    );
  });

  it("bloquea objetos, marcos y base; fuerza HTTPS en producción", () => {
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(prod, "frame-src")).toEqual(["'none'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("en desarrollo: localhost de Colyseus y editor por defecto y unsafe-eval (React dev)", () => {
    const dev = buildContentSecurityPolicy("n", { NODE_ENV: "development" });
    expect(directive(dev, "connect-src")).toEqual(
      expect.arrayContaining([
        "ws://localhost:2567",
        "http://localhost:2567",
        "ws://localhost:2568",
      ]),
    );
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("sin NEXT_PUBLIC_PLAUSIBLE_DOMAIN ni NEXT_PUBLIC_GA_MEASUREMENT_ID no añade nada de analítica", () => {
    expect(directive(prod, "script-src")).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("plausible"),
        expect.stringContaining("google"),
      ]),
    );
    expect(directive(prod, "connect-src")).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("plausible"),
        expect.stringContaining("google"),
      ]),
    );
  });

  it("con NEXT_PUBLIC_PLAUSIBLE_DOMAIN abre script-src y connect-src al origen del script (SaaS por defecto)", () => {
    const withPlausible = buildContentSecurityPolicy("abc123", {
      NODE_ENV: "production",
      NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "escaperoom.example",
    });
    expect(directive(withPlausible, "script-src")).toContain("https://plausible.io");
    expect(directive(withPlausible, "connect-src")).toContain("https://plausible.io");
  });

  it("un NEXT_PUBLIC_PLAUSIBLE_SRC propio (self-host) abre su origen en vez del SaaS", () => {
    const selfHosted = buildContentSecurityPolicy("abc123", {
      NODE_ENV: "production",
      NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "escaperoom.example",
      NEXT_PUBLIC_PLAUSIBLE_SRC: "https://analytics.escaperoom.example/js/script.js",
    });
    expect(directive(selfHosted, "script-src")).toContain("https://analytics.escaperoom.example");
    expect(directive(selfHosted, "connect-src")).toContain("https://analytics.escaperoom.example");
    expect(directive(selfHosted, "script-src")).not.toContain("https://plausible.io");
  });

  it("con NEXT_PUBLIC_GA_MEASUREMENT_ID abre Google Tag Manager (script) y los dominios de medición (connect)", () => {
    const withGa = buildContentSecurityPolicy("abc123", {
      NODE_ENV: "production",
      NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-REAL12345",
    });
    expect(directive(withGa, "script-src")).toContain("https://www.googletagmanager.com");
    expect(directive(withGa, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://www.google-analytics.com",
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://www.googletagmanager.com",
      ]),
    );
  });

  it("serviceOrigins ignora URLs inválidas o de otros esquemas", () => {
    expect(serviceOrigins("no es una url")).toEqual([]);
    expect(serviceOrigins("ftp://x.example")).toEqual([]);
    expect(serviceOrigins("https://x.example/ruta?q=1")).toEqual([
      "https://x.example",
      "wss://x.example",
    ]);
  });

  it("A-23: en producción, sin NEXT_PUBLIC_COLYSEUS_URL/NEXT_PUBLIC_EDITOR_SYNC_URL, no autoriza los localhost de dev", () => {
    const prodNoRealtime = buildContentSecurityPolicy("abc123", { NODE_ENV: "production" });
    const connect = directive(prodNoRealtime, "connect-src");
    expect(connect).not.toEqual(expect.arrayContaining([expect.stringContaining("localhost")]));
  });

  it("A-23: con Sentry configurado, la CSP lleva report-to/report-uri", () => {
    const withSentry = buildContentSecurityPolicy("abc123", {
      NODE_ENV: "production",
      NEXT_PUBLIC_SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/123",
    });
    expect(withSentry).toContain("report-to csp-endpoint");
    expect(withSentry).toContain(
      "report-uri https://o0.ingest.sentry.io/api/123/security/?sentry_key=examplePublicKey",
    );
    expect(prod).not.toContain("report-to");
    expect(prod).not.toContain("report-uri");
  });

  it("A-23: reportToHeaderValue solo con Sentry, con el mismo endpoint que report-uri", () => {
    expect(reportToHeaderValue(undefined)).toBeNull();
    const value = reportToHeaderValue("https://examplePublicKey@o0.ingest.sentry.io/123");
    expect(JSON.parse(value ?? "{}")).toMatchObject({
      group: "csp-endpoint",
      endpoints: [{ url: "https://o0.ingest.sentry.io/api/123/security/?sentry_key=examplePublicKey" }],
    });
  });
});

describe("proxy.ts — respuesta de página", () => {
  it("lleva la CSP con un nonce nuevo por petición y se lo pasa a Next en la petición", () => {
    const first = proxy(new NextRequest("http://localhost/es/rooms"));
    const second = proxy(new NextRequest("http://localhost/es/rooms"));
    const csp = first.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/u.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(second.headers.get("content-security-policy")).not.toContain(nonce);

    // Cabeceras de petición que Next usa al renderizar (así pone el nonce en sus <script>).
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("la redirección de locale («/» → «/es») también lleva la CSP", () => {
    const res = proxy(new NextRequest("http://localhost/"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("content-security-policy")).toContain("script-src");
  });
});

describe("next.config.ts — cabeceras fijas", () => {
  it("todas las rutas llevan nosniff, referrer, marcos, permisos, COOP y CORP; la API, CSP cerrada", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*")!;
    const keys = all.headers.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "Referrer-Policy",
        "X-Frame-Options",
        "Permissions-Policy",
        "Cross-Origin-Opener-Policy",
        "Cross-Origin-Resource-Policy",
      ]),
    );
    const api = rules.find((rule) => rule.source === "/api/:path*")!;
    expect(api.headers).toEqual([
      { key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY },
    ]);
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("A-23: la CSP cerrada de la API también cubre /.well-known/* y /mcp/*", async () => {
    const rules = await nextConfig.headers!();
    const wellKnown = rules.find((rule) => rule.source === "/.well-known/:path*");
    const mcp = rules.find((rule) => rule.source === "/mcp/:path*");
    expect(wellKnown?.headers).toEqual([
      { key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY },
    ]);
    expect(mcp?.headers).toEqual([
      { key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY },
    ]);
  });

  it("HSTS solo en producción; cámara y micro solo para la propia web (LiveKit)", () => {
    const find = (env: { NODE_ENV: string }, key: string) =>
      staticSecurityHeaders(env).find((h) => h.key === key)?.value;
    expect(find({ NODE_ENV: "production" }, "Strict-Transport-Security")).toContain("max-age=");
    expect(find({ NODE_ENV: "development" }, "Strict-Transport-Security")).toBeUndefined();
    expect(find({ NODE_ENV: "production" }, "Permissions-Policy")).toContain("camera=(self)");
  });

  it("A-23: Cross-Origin-Resource-Policy same-origin; Report-To solo con Sentry configurado", () => {
    const find = (env: Record<string, string>, key: string) =>
      staticSecurityHeaders(env).find((h) => h.key === key)?.value;
    expect(find({ NODE_ENV: "production" }, "Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(find({ NODE_ENV: "production" }, "Report-To")).toBeUndefined();
    expect(
      find(
        { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: "https://k@o0.ingest.sentry.io/1" },
        "Report-To",
      ),
    ).toContain("csp-endpoint");
  });
});
