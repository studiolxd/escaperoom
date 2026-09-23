import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "../generated/client";

// El seed escribe directo a Postgres (DIRECT_URL): tras `migrate reset` los
// ENUMs se recrean con OIDs nuevos y el pooler (PgBouncer) puede tener planes
// cacheados → "cache lookup failed for type".
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../../docs/reference/roompackage-rey-aldric.v1.json");

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

  await prisma.room.upsert({
    where: { id: ID.room },
    update: {},
    create: {
      id: ID.room,
      authorId: ID.creator,
      title: roomPackage.meta.title,
      status: "published",
      saleIndividual: true,
      saleEvents: true,
      priceCents: 299,
    },
  });

  await prisma.roomVersion.upsert({
    where: { roomId_semver: { roomId: ID.room, semver: roomPackage.meta.version } },
    update: { package: roomPackage as unknown as Prisma.InputJsonValue, assetsHash },
    create: {
      roomId: ID.room,
      semver: roomPackage.meta.version,
      package: roomPackage as unknown as Prisma.InputJsonValue,
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

  console.log(
    `Seed OK: admin + creador + sala "${roomPackage.meta.title}" publicada + ${PRICING_TIERS.length} tramos de precio`,
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
