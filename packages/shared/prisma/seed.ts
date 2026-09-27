import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRedis, redisPrefix } from "@escaperoom/kit/redis";
import { createStorage } from "@escaperoom/kit/storage";
import { Prisma } from "../generated/client/client";
import { createPrismaClient } from "../src/db";
import { invalidatePublishedRoomListingCache } from "../src/services/catalog-listing";

// `packages/shared/.env` (dev-env.sh) no trae REDIS_URL, solo REDIS_PREFIX
// (E-13 lo comparten todos los worktrees vía prefijo, no vía URL propia):
// hace falta para poder invalidar el cache del catálogo (ADR-027) al final
// del seed, igual que la URL de storage de más abajo — mismo valor fijo de
// dev que `infra/README.md`, no es un secreto.
process.env.REDIS_URL ??= "redis://:redis_dev_only@localhost:56380";

// El seed escribe directo a Postgres (DIRECT_URL): tras `migrate reset` los
// ENUMs se recrean con OIDs nuevos y el pooler (PgBouncer) puede tener planes
// cacheados → "cache lookup failed for type".
const prisma = createPrismaClient({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  max: 1,
});

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../../docs/reference/roompackage-rey-aldric.v1.json");
const seedAssetsDir = path.resolve(here, "../../../docs/reference/seed-assets");

/**
 * Portada e introducción de la sala del fixture (SOLO dev, nunca producción,
 * como `devRoomsCount` más abajo): se guardan como bytes fijos en
 * `docs/reference/seed-assets/` y se suben al bucket de dev
 * (SeaweedFS, infra/README.md — credenciales y bucket fijos, no
 * worktree-specific) en vez de al fixture JSON compartido por decenas de
 * tests de otros paquetes, que se queda intacto.
 */
const devStorage = process.env.NODE_ENV === "production" ? null : createStorage({
  STORAGE_PROVIDER: "s3",
  STORAGE_BUCKET: "escaperoom-assets",
  STORAGE_REGION: "us-east-1",
  STORAGE_ENDPOINT: "http://localhost:9002",
  STORAGE_ACCESS_KEY_ID: "minioadmin",
  STORAGE_SECRET_ACCESS_KEY: "minioadmin",
});

const MAIN_ROOM_INTRO_TEXT =
  "Hace veinte años, el rey Aldric fue traicionado por su propio hermano, el mago Malrec, " +
  "que le arrebató el alma y la selló en un relicario oculto en las profundidades del " +
  "castillo. Esta noche, sin motivo aparente, las viejas defensas han despertado. Cruzaréis " +
  "el Salón del Trono, descenderéis a la Bodega de los Vinos Encantados y os adentraréis en " +
  "las Catacumbas, donde el relicario aguarda entre sombras y magia antigua. Tenéis 60 " +
  "minutos antes de que el sello se cierre para siempre: el destino del rey Aldric —y quizá " +
  "el vuestro— está en vuestras manos.";

/**
 * Sube una portada de `seed-assets/` y devuelve su `coverImageKey`, o `null`
 * sin storage de dev (o si el storage está inalcanzable, p. ej. CI sin
 * SeaweedFS levantado: el seed no debe romperse por un servicio externo
 * opcional, solo sembrar la sala sin portada).
 */
async function seedCoverImageKey(roomId: string, fileName: string): Promise<string | null> {
  if (!devStorage) return null;
  const bytes = readFileSync(path.join(seedAssetsDir, fileName));
  const key = `rooms/${roomId}/cover.jpg`;
  try {
    await devStorage.putObject({ key, body: bytes, contentType: "image/jpeg" });
    return key;
  } catch (error) {
    console.warn(`⚠️  No se pudo subir la portada de seed (${fileName}) al storage de dev, se sigue sin ella:`, error);
    return null;
  }
}

type RoomPackageFixture = {
  meta: { title: string; theme: string; version: string };
};

const ID = {
  admin: "seed-admin",
  creator: "seed-creator",
  adminAccount: "00000000-0000-0000-0000-000000000101",
  creatorAccount: "00000000-0000-0000-0000-000000000102",
  orgAccount: "00000000-0000-0000-0000-000000000103",
  org: "seed-org",
  member: "seed-member",
  room: "00000000-0000-0000-0000-000000000301",
} as const;

/**
 * Tramos iniciales de specs/02 §3.2 (precio por jugador en céntimos). `update`
 * vacío: re-sembrar nunca reescribe un tramo existente (no se altera el histórico).
 */
const PRICING_TIERS = [
  {
    id: "00000000-0000-0000-0000-000000000401",
    minPlayers: 1,
    maxPlayers: 15,
    priceCentsPerPlayer: 100,
  },
  {
    id: "00000000-0000-0000-0000-000000000402",
    minPlayers: 16,
    maxPlayers: 50,
    priceCentsPerPlayer: 90,
  },
  {
    id: "00000000-0000-0000-0000-000000000403",
    minPlayers: 51,
    maxPlayers: 150,
    priceCentsPerPlayer: 75,
  },
  {
    id: "00000000-0000-0000-0000-000000000404",
    minPlayers: 151,
    maxPlayers: null,
    priceCentsPerPlayer: 60,
  },
] as const;

async function main() {
  const fixtureRaw = readFileSync(fixturePath, "utf8");
  const roomPackage = JSON.parse(fixtureRaw) as RoomPackageFixture;
  const assetsHash = createHash("sha256").update(fixtureRaw).digest("hex");

  await prisma.user.upsert({
    where: { id: ID.admin },
    update: {},
    create: {
      id: ID.admin,
      name: "Admin",
      email: "admin@escaperoom.local",
      emailVerified: true,
      isAdmin: true,
      isModerator: true,
    },
  });

  await prisma.user.upsert({
    where: { id: ID.creator },
    update: {},
    create: {
      id: ID.creator,
      name: "Creador de ejemplo",
      email: "creador@escaperoom.local",
      emailVerified: true,
    },
  });

  await prisma.creditAccount.upsert({
    where: { id: ID.adminAccount },
    update: {},
    create: { id: ID.adminAccount, userId: ID.admin, balanceCredits: 100_000n },
  });

  await prisma.creditAccount.upsert({
    where: { id: ID.creatorAccount },
    update: {},
    create: { id: ID.creatorAccount, userId: ID.creator, balanceCredits: 50_000n },
  });

  await prisma.organization.upsert({
    where: { id: ID.org },
    update: {},
    create: { id: ID.org, name: "Organización de ejemplo", slug: "organizacion-ejemplo" },
  });

  await prisma.member.upsert({
    where: { organizationId_userId: { organizationId: ID.org, userId: ID.creator } },
    update: {},
    create: { id: ID.member, organizationId: ID.org, userId: ID.creator, role: "owner" },
  });

  await prisma.creditAccount.upsert({
    where: { id: ID.orgAccount },
    update: {},
    create: { id: ID.orgAccount, organizationId: ID.org, balanceCredits: 0n },
  });

  const mainCoverImageKey = await seedCoverImageKey(ID.room, "rey-aldric-cover.jpg");
  const mainRoomPackage = {
    ...roomPackage,
    meta: {
      ...roomPackage.meta,
      intro: { type: "text", text: { es: { text: MAIN_ROOM_INTRO_TEXT } } },
    },
  };

  await prisma.room.upsert({
    where: { id: ID.room },
    update: mainCoverImageKey ? { coverImageKey: mainCoverImageKey } : {},
    create: {
      id: ID.room,
      authorId: ID.creator,
      title: roomPackage.meta.title,
      status: "published",
      saleIndividual: true,
      saleEvents: true,
      priceCents: 0,
      coverImageKey: mainCoverImageKey,
    },
  });

  await prisma.roomVersion.upsert({
    where: { roomId_semver: { roomId: ID.room, semver: roomPackage.meta.version } },
    update: { package: mainRoomPackage as unknown as Prisma.InputJsonValue, assetsHash },
    create: {
      roomId: ID.room,
      semver: roomPackage.meta.version,
      package: mainRoomPackage as unknown as Prisma.InputJsonValue,
      assetsHash,
      changelog: "Versión inicial (seed)",
      publishedBy: ID.creator,
    },
  });

  for (const tier of PRICING_TIERS) {
    await prisma.pricingTier.upsert({
      where: { id: tier.id },
      update: {},
      create: { ...tier, currency: "EUR", createdBy: ID.admin },
    });
  }

  // Salas extra SOLO de desarrollo (nunca en producción): copias mínimas de la
  // sala del fixture, con id/título/precio distintos, para poder ver la
  // paginación del catálogo con más de una página sin depender de contenido real.
  const devRoomsCount = process.env.NODE_ENV === "production" ? 0 : 50;
  const DEV_PRICES_CENTS = [0, 500, 1000, 1500, 2000, 3000, 5000, 8000];
  for (let i = 1; i <= devRoomsCount; i++) {
    const devRoomId = `00000000-0000-0000-0000-0000000020${String(i).padStart(2, "0")}`;
    const title = `${roomPackage.meta.title} (sala de prueba ${i})`;
    const devPackage = {
      ...roomPackage,
      meta: { ...roomPackage.meta, id: devRoomId, title },
    };
    // Sala 8: portada clara (contraste de la #301, oscura) para comparar
    // botón/estrellas/tags sobre el degradado con las dos.
    const devCoverImageKey =
      i === 8 ? await seedCoverImageKey(devRoomId, "rey-aldric-cover-light.jpg") : null;
    await prisma.room.upsert({
      where: { id: devRoomId },
      update: devCoverImageKey ? { coverImageKey: devCoverImageKey } : {},
      create: {
        id: devRoomId,
        authorId: ID.creator,
        title,
        status: "published",
        saleIndividual: true,
        saleEvents: true,
        priceCents: DEV_PRICES_CENTS[i % DEV_PRICES_CENTS.length],
        coverImageKey: devCoverImageKey,
      },
    });
    await prisma.roomVersion.upsert({
      where: { roomId_semver: { roomId: devRoomId, semver: roomPackage.meta.version } },
      update: {},
      create: {
        roomId: devRoomId,
        semver: roomPackage.meta.version,
        package: devPackage as unknown as Prisma.InputJsonValue,
        assetsHash: createHash("sha256").update(`${assetsHash}:${i}`).digest("hex"),
        changelog: "Sala de desarrollo (seed)",
        publishedBy: ID.creator,
      },
    });
  }

  // El seed escribe la portada/intro directo por Prisma (no por
  // `getRoomCoverService`/`roomPublish`, que son quienes normalmente invalidan
  // el cache del catálogo tras cambiar algo visible): sin esto, `/rooms` y la
  // ficha de sala seguían sirviendo la respuesta cacheada de antes del seed
  // hasta que expirase el TTL.
  const redis = getRedis();
  const cacheStore = redis
    ? {
        get: (key: string) => redis.get(key),
        set: (key: string, value: string, ttlSeconds: number) =>
          redis.set(key, value, "EX", ttlSeconds),
      }
    : null;
  await invalidatePublishedRoomListingCache(cacheStore, redisPrefix());
  await redis?.quit();

  console.log(
    `Seed OK: admin + creador + sala "${roomPackage.meta.title}" publicada + ${PRICING_TIERS.length} tramos de precio + ${devRoomsCount} salas de desarrollo`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
