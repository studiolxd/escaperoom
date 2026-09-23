import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import {
  API_CONTENT_SECURITY_POLICY,
  buildContentSecurityPolicy,
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

  it("serviceOrigins ignora URLs inválidas o de otros esquemas", () => {
    expect(serviceOrigins("no es una url")).toEqual([]);
    expect(serviceOrigins("ftp://x.example")).toEqual([]);
    expect(serviceOrigins("https://x.example/ruta?q=1")).toEqual([
      "https://x.example",
      "wss://x.example",
    ]);
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
  it("todas las rutas llevan nosniff, referrer, marcos, permisos y COOP; la API, CSP cerrada", async () => {
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
      ]),
    );
    const api = rules.find((rule) => rule.source === "/api/:path*")!;
    expect(api.headers).toEqual([
      { key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY },
    ]);
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("HSTS solo en producción; cámara y micro solo para la propia web (LiveKit)", () => {
    const find = (env: { NODE_ENV: string }, key: string) =>
      staticSecurityHeaders(env).find((h) => h.key === key)?.value;
    expect(find({ NODE_ENV: "production" }, "Strict-Transport-Security")).toContain("max-age=");
    expect(find({ NODE_ENV: "development" }, "Strict-Transport-Security")).toBeUndefined();
    expect(find({ NODE_ENV: "production" }, "Permissions-Policy")).toContain("camera=(self)");
  });
});
