import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/client";
import { createPrismaClient } from "../src/db";
import { createPrismaRoomPublishStore } from "../src/services/room-publish-prisma-store";
import type { RoomPackage } from "../src/schemas";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno (igual que catalog-prisma.integration.test.ts):
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test catalog-listing-index
//
// E-23 (auditoría 2026-09-24): el catálogo filtraba por idioma con un índice
// GIN sobre `roomVersion.package` ENTERO que la consulta real nunca llegaba a
// usar (el filtro se aplicaba sobre la salida ya materializada del
// `DISTINCT ON`). Se sustituyó por `room.languages` (denormalizado en el
// publish) + `ixRoomLanguages`. Este test comprueba: (1) el esquema tiene el
// índice nuevo y ya no el viejo, (2) `insertVersion` (el paso real de
// publicación, `room-publish-prisma-store.ts`) escribe `room.languages`, y
// (3) el plan de la consulta del catálogo ya no depende de escanear
// `package` para filtrar por idioma.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as RoomPackage;

const TAG = `itidx${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.DATABASE_URL)("índice de idiomas del catálogo (integración)", () => {
  let prisma: PrismaClient;
  const authorId = `${TAG}-autor`;
  let roomId: string;

  beforeAll(async () => {
    prisma = createPrismaClient();
    await prisma.user.create({ data: { id: authorId, name: "autor", email: `${authorId}@test.local` } });
    const room = await prisma.room.create({
      data: { authorId, title: `${TAG} sala`, status: "draft" },
    });
    roomId = room.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.roomVersion.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { id: authorId } });
    await prisma.$disconnect();
  });

  it("el esquema tiene `ixRoomLanguages` (gin) y ya no `ixRoomVersionPackage`", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename IN ('room', 'roomVersion') AND indexname LIKE 'ix%'`;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get("ixRoomVersionPackage")).toBeUndefined();
    expect(byName.get("ixRoomLanguages")).toMatch(/USING gin \("?languages"?\)/);
  });

  it("`insertVersion` (publish real) denormaliza `room.languages` desde `meta.languages`", async () => {
    const store = createPrismaRoomPublishStore(prisma);
    const pkg: RoomPackage = {
      ...fixture,
      meta: { ...fixture.meta, title: `${TAG} sala`, languages: ["es", "fr"], defaultLanguage: "es" },
    };
    await store.withRoomLock(roomId, async (tx) => {
      await tx.insertVersion({
        roomId,
        semver: "1.0.0",
        package: pkg,
        assetsHash: "sha256:test",
        changelog: null,
        publishedBy: authorId,
      });
      await tx.markPublished(roomId);
    });

    const row = await prisma.room.findUniqueOrThrow({ where: { id: roomId }, select: { languages: true } });
    expect(row.languages).toEqual(["es", "fr"]);
  });

  it("el plan del catálogo filtra por idioma sobre `room`, no sobre `roomVersion.package`", async () => {
    const plan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
      EXPLAIN (FORMAT TEXT)
      WITH latest AS (
        SELECT DISTINCT ON (v."roomId") v.id, v."roomId", v."publishedAt", v.package
          FROM "roomVersion" v
          JOIN "room" r ON r.id = v."roomId"
         WHERE r.status = 'published' AND r."deletedAt" IS NULL
           AND r."languages" @> ARRAY['es']::text[]
         ORDER BY v."roomId", v."publishedAt" DESC
      )
      SELECT latest."roomId" FROM latest`;
    const text = plan.map((row) => row["QUERY PLAN"]).join("\n");
    // Ya no hay ningún filtro de contención JSONB sobre `package`: el
    // criterio de idioma vive entero en `room.languages`.
    expect(text).not.toMatch(/package @>/);
    expect(text).toMatch(/languages @>/);
  });
});
