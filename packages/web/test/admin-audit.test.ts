import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANONYMOUS_ACTOR,
  createAudioAssetService,
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  createInMemoryPlatformSettingStore,
  createInMemoryPricingTierStore,
  createPlatformSettingsService,
  createPricingTierService,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it, vi } from "vitest";

/**
 * Auditoría de los endpoints de administración (ticket 6.3, specs/13 §11 y
 * specs/24 §6): recorre TODAS las rutas bajo `src/app/api/admin/` (sin lista a
 * mano: una ruta nueva entra sola) e invoca cada método HTTP que exporta su
 * `route.ts`, sin sesión y con una sesión sin permisos. Ninguna combinación
 * puede pasar de 401/403, ni siquiera con un cuerpo o parámetros inválidos:
 * la autorización va antes que la validación.
 *
 * Los servicios son los de dominio con stores en memoria (vía `vi.mock` del
 * composition root): se prueba la ruta de verdad, sin Postgres.
 */

const admin: Actor = { userId: "admin", organizationId: null, role: "member" };
const moderator: Actor = { userId: "mod", organizationId: null, role: "member" };
const member: Actor = { userId: "usuaria", organizationId: "org-1", role: "owner" };
const ACTORS: Record<string, Actor> = { admin, mod: moderator, usuaria: member };

vi.mock("@/server/context", () => ({
  resolveActorFromRequest: async (request: Request) =>
    ACTORS[request.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
}));

vi.mock("@/server/services", () => {
  const adminIds = [admin.userId];
  const settings = createPlatformSettingsService({
    store: createInMemoryPlatformSettingStore({ adminIds, rows: [] }),
  });
  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({ adminIds, tiers: [] }),
  });
  const audio = createAudioAssetService({
    store: createInMemoryAudioAssetStore({ moderatorIds: [moderator.userId] }),
    blobs: createInMemoryAudioBlobStore(),
  });
  return {
    getPlatformSettingsService: () => settings,
    getPricingTierService: () => pricing,
    getAudioAssetService: () => audio,
  };
});

const ADMIN_DIR = fileURLToPath(new URL("../src/app/api/admin", import.meta.url));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** `route.ts` bajo `dir`, con su ruta URL (`/api/admin/...`) y sus segmentos dinámicos. */
function findRoutes(dir: string): Array<{ file: string; url: string; params: string[] }> {
  const routes: Array<{ file: string; url: string; params: string[] }> = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      routes.push(...findRoutes(full));
    } else if (entry === "route.ts") {
      const segments = path.relative(ADMIN_DIR, dir).split(path.sep).filter(Boolean);
      routes.push({
        file: full,
        url: `/api/admin/${segments.join("/")}`,
        params: segments.flatMap((s) => (/^\[(.+)\]$/u.exec(s)?.[1] ? [s.slice(1, -1)] : [])),
      });
    }
  }
  return routes;
}

const routes = findRoutes(ADMIN_DIR);

/** Casos por método: sin cuerpo, JSON vacío y JSON que no pasaría la validación. */
const BODIES = [undefined, "{}", JSON.stringify({ value: "x", priceCentsPerPlayer: -1 })];

type Case = { route: string; method: string; user: string | null; body: string | undefined };

async function callEveryMethod(
  user: string | null,
): Promise<{ statuses: Array<Case & { status: number }> }> {
  const statuses: Array<Case & { status: number }> = [];
  for (const route of routes) {
    const mod = (await import(/* @vite-ignore */ route.file)) as Record<string, unknown>;
    for (const method of METHODS) {
      const handler = mod[method];
      if (typeof handler !== "function") continue;
      for (const body of method === "GET" || method === "DELETE" ? [undefined] : BODIES) {
        const url = route.url.replace(/\[([^\]]+)\]/gu, "00000000-0000-4000-8000-00000000000a");
        const headers = new Headers({ "content-type": "application/json" });
        if (user) headers.set("x-test-user", user);
        const request = new Request(`http://localhost${url}`, { method, headers, body });
        const params = Object.fromEntries(
          route.params.map((name) => [name, "00000000-0000-4000-8000-00000000000a"]),
        );
        const response = (await (
          handler as (r: Request, c: { params: Promise<Record<string, string>> }) => unknown
        )(request, { params: Promise.resolve(params) })) as Response;
        statuses.push({ route: route.url, method, user, body, status: response.status });
      }
    }
  }
  return { statuses };
}

describe("auditoría de /api/admin/*", () => {
  it("encuentra las rutas de admin (el recorrido no está vacío)", () => {
    const urls = routes.map((r) => r.url).sort();
    expect(urls).toEqual(
      expect.arrayContaining([
        "/api/admin/audio",
        "/api/admin/audio/[id]",
        "/api/admin/pricing-tiers",
        "/api/admin/pricing-tiers/[id]",
        "/api/admin/settings/[key]",
      ]),
    );
  });

  it("sin sesión, TODOS los métodos de TODAS las rutas responden 401", async () => {
    const { statuses } = await callEveryMethod(null);
    expect(statuses.length).toBeGreaterThanOrEqual(routes.length);
    expect(statuses.filter((s) => s.status !== 401)).toEqual([]);
  });

  it("con sesión sin `isAdmin` (aunque sea owner de una organización), 403", async () => {
    const { statuses } = await callEveryMethod("usuaria");
    expect(statuses.filter((s) => s.status !== 403)).toEqual([]);
  });

  it("el moderador solo entra en la moderación de audio; ajustes y precios siguen en 403", async () => {
    const { statuses } = await callEveryMethod("mod");
    const outside = statuses.filter((s) => !s.route.startsWith("/api/admin/audio"));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.filter((s) => s.status !== 403)).toEqual([]);
  });

  it("control: el admin sí pasa la autorización (el test detectaría un 403 fijo)", async () => {
    const { statuses } = await callEveryMethod("admin");
    const nonAudio = statuses.filter((s) => !s.route.startsWith("/api/admin/audio"));
    expect(nonAudio.some((s) => s.status !== 401 && s.status !== 403)).toBe(true);
  });
});
