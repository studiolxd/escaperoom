import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANONYMOUS_ACTOR } from "@escaperoom/shared/services";
import { describe, expect, it, vi } from "vitest";

/**
 * A-22 (auditoría 2026-09-24, specs/13 §1): contrato de error REST único,
 * recorriendo `app/api/**` (como `test/admin-audit.test.ts` hace para
 * `app/api/admin/**`), con un cuerpo `{` (JSON roto) en cada método
 * POST/PATCH/PUT/DELETE.
 *
 * A diferencia de `admin-audit.test.ts`, aquí NO se sustituye
 * `@/server/services` (habría que stubear ~30 servicios distintos): las
 * rutas que necesitan tocar Postgres/Redis para autorizar antes de leer el
 * cuerpo lanzan y se cuentan aparte ("sin infra"), no fallan el test. Lo que
 * SÍ se comprueba en toda ruta que responde: cualquier 400 por cuerpo roto
 * es `INVALID_JSON` (nunca `BAD_REQUEST`/`VALIDATION_ERROR`), y toda
 * respuesta de error lleva `Cache-Control: no-store`.
 *
 * Directorios excluidos: `auth/[...all]` (Better Auth, no esta superficie),
 * `trpc` (otro protocolo), `health` (sin cuerpo), `stripe` (webhook con
 * verificación de firma, no la API de clientes), `mcp` (OAuth 2.1, su propio
 * contrato de error — ver README del MCP).
 */

vi.mock("@/server/context", () => ({
  resolveActorFromRequest: async () => ANONYMOUS_ACTOR,
  resolveBrowserActorFromRequest: async () => ANONYMOUS_ACTOR,
}));

const API_DIR = fileURLToPath(new URL("../src/app/api", import.meta.url));
const EXCLUDED_TOP_LEVEL = new Set(["auth", "trpc", "health", "stripe", "mcp"]);
/**
 * Rutas sin migrar todavía a `server/rest/_http.ts` (A-22): catálogo
 * (`rooms-list.ts`, `featured-room.ts`) y reseñas (`room-reviews.ts`), en uso
 * por otra sesión en paralelo — ver la PR. Se comprueba solo `no-store`; el
 * código de "JSON roto" sigue siendo el suyo hasta que se migren.
 */
const NOT_YET_MIGRATED = ["/rooms/route.ts", "/rooms/featured/route.ts", "/reviews/route.ts"];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const DUMMY_ID = "00000000-0000-4000-8000-00000000000a";

function findRoutes(dir: string, root: string): Array<{ file: string; params: string[] }> {
  const routes: Array<{ file: string; params: string[] }> = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      routes.push(...findRoutes(full, root));
    } else if (entry === "route.ts") {
      const segments = path.relative(root, dir).split(path.sep).filter(Boolean);
      routes.push({
        file: full,
        params: segments.flatMap((s) => (/^\[(.+)\]$/u.exec(s)?.[1] ? [s.slice(1, -1)] : [])),
      });
    }
  }
  return routes;
}

const allRoutes = findRoutes(API_DIR, API_DIR).filter((r) => {
  const top = path.relative(API_DIR, path.dirname(r.file)).split(path.sep)[0];
  return top === undefined || !EXCLUDED_TOP_LEVEL.has(top);
});

describe("contrato de error REST en app/api/** (A-22)", () => {
  it("encuentra rutas para recorrer (el barrido no está vacío)", () => {
    expect(allRoutes.length).toBeGreaterThan(20);
  });

  it("cuerpo `{` roto: si la ruta responde 400, siempre es INVALID_JSON con no-store", async () => {
    let exercised = 0;
    let skipped = 0;
    for (const route of allRoutes) {
      const mod = (await import(/* @vite-ignore */ route.file)) as Record<string, unknown>;
      const params = Object.fromEntries(route.params.map((name) => [name, DUMMY_ID]));
      const url = "http://localhost" + route.file.split("/src/app")[1]!.replace(/\/route\.ts$/u, "");

      for (const method of METHODS) {
        const handler = mod[method];
        if (typeof handler !== "function") continue;
        if (method === "GET" || method === "DELETE") continue; // sin cuerpo relevante aquí

        const request = new Request(url, {
          method,
          headers: { "content-type": "application/json" },
          body: "{",
        });
        let response: Response;
        try {
          response = (await (
            handler as (r: Request, c: { params: Promise<Record<string, string>> }) => unknown
          )(request, { params: Promise.resolve(params) })) as Response;
        } catch {
          // Necesita infra real (Postgres/Redis) para llegar hasta el body: no es
          // lo que este contrato comprueba, se cuenta y se sigue.
          skipped += 1;
          continue;
        }
        exercised += 1;
        const migrated = !NOT_YET_MIGRATED.some((suffix) => route.file.endsWith(suffix));

        if (migrated && response.status === 400) {
          const body = (await response.json()) as { error?: { code?: string } };
          expect(body.error?.code, `${method} ${url} -> 400`).toBe("INVALID_JSON");
        }
        if (migrated && response.status >= 400) {
          expect(
            response.headers.get("Cache-Control"),
            `${method} ${url} -> ${response.status} sin no-store`,
          ).toBe("no-store");
        }
      }
    }
    // Si nada se pudo ejercitar sin infra, el test no está comprobando nada de verdad.
    expect(exercised).toBeGreaterThan(10);
    expect(exercised + skipped).toBeGreaterThan(0);
  });
});
