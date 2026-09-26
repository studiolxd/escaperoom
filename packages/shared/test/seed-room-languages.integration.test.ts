import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/client";
import { createPrismaClient } from "../src/db";
import {
  ANONYMOUS_ACTOR,
  createCatalogService,
  createInMemoryRoomPackageRepository,
  createPrismaPublishedRoomListing,
} from "../src/services";
import type { RoomPackage } from "../src/schemas";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI hay Postgres (ver E-14), así que
// corre; en local, con la infra levantada:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test seed-room-languages
//
// E-23 (revisión de la coordinadora sobre la PR original): el seed
// (`prisma/seed.ts`) crea la sala del Rey Aldric y las 50 salas de
// desarrollo con `prisma.room.upsert`/`roomVersion.upsert` DIRECTO, sin pasar
// por `insertVersion` (el paso de publicación real). Antes de
// `trgRoomVersionSyncLanguages` (20260926190000) eso dejaba `room.languages`
// vacío para toda sala sembrada — invisibles para cualquier filtro de idioma
// del catálogo en CUALQUIER entorno nuevo (worktree, CI, e2e, `db:reset`),
// sin que ningún e2e existente lo notara (ninguno filtra el catálogo por
// idioma). Este test corre el seed REAL (subproceso, como lo haría
// `pnpm db:seed`/CI) y comprueba contra el catálogo, no contra una
// simulación en memoria de lo que "debería" pasar.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as RoomPackage;

const REY_ALDRIC_ROOM_ID = "00000000-0000-0000-0000-000000000301";

describe.skipIf(!process.env.DATABASE_URL)(
  "seed real + filtro de idioma del catálogo (integración, E-23)",
  () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
      execFileSync("pnpm", ["exec", "tsx", "prisma/seed.ts"], {
        cwd: packageRoot,
        env: process.env,
        stdio: "inherit",
      });
      prisma = createPrismaClient();
    });

    afterAll(async () => {
      if (prisma) await prisma.$disconnect();
    });

    it("el Rey Aldric sembrado aparece al filtrar el catálogo por su idioma", async () => {
      expect(fixture.meta.languages.length).toBeGreaterThan(0);
      const catalog = createCatalogService({
        rooms: createInMemoryRoomPackageRepository(fixture),
        listing: createPrismaPublishedRoomListing(prisma),
      });
      const language = fixture.meta.languages[0];
      if (!language) throw new Error("inalcanzable: ya comprobado arriba que hay al menos un idioma");
      // El seed también crea 50 salas de desarrollo con el mismo idioma y un
      // título que EMPIEZA por el del Rey Aldric (no sirve `q` para acotar a
      // una sola): se recorren todas las páginas en vez de asumir en cuál cae.
      async function collectIds(filterLanguage: string): Promise<string[]> {
        const ids: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 5; page++) {
          const result = await catalog.listRooms(ANONYMOUS_ACTOR, {
            language: filterLanguage,
            limit: 48,
            cursor,
          });
          ids.push(...result.items.map((room) => room.id));
          if (!result.nextCursor) break;
          cursor = result.nextCursor;
        }
        return ids;
      }

      expect(await collectIds(language)).toContain(REY_ALDRIC_ROOM_ID);
      // Semántica sin cambios: un idioma que la sala NO tiene la excluye.
      expect(await collectIds("xx")).not.toContain(REY_ALDRIC_ROOM_ID);
    });

    it("las salas de desarrollo del seed también tienen `room.languages` (no solo el Rey Aldric)", async () => {
      const rows = await prisma.room.findMany({
        where: { title: { contains: "sala de prueba" } },
        select: { languages: true },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.languages.length).toBeGreaterThan(0);
    });
  },
);
