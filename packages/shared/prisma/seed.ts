import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../generated/client";

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
  admin: "00000000-0000-0000-0000-000000000001",
  creator: "00000000-0000-0000-0000-000000000002",
  adminAccount: "00000000-0000-0000-0000-000000000101",
  creatorAccount: "00000000-0000-0000-0000-000000000102",
  orgAccount: "00000000-0000-0000-0000-000000000103",
  org: "00000000-0000-0000-0000-000000000201",
  room: "00000000-0000-0000-0000-000000000301",
} as const;

async function main() {
  const fixtureRaw = readFileSync(fixturePath, "utf8");
  const roomPackage = JSON.parse(fixtureRaw) as RoomPackageFixture;
  const assetsHash = createHash("sha256").update(fixtureRaw).digest("hex");

  await prisma.users.upsert({
    where: { id: ID.admin },
    update: {},
    create: {
      id: ID.admin,
      email: "admin@escaperoom.local",
      display_name: "Admin",
      is_admin: true,
      is_moderator: true,
    },
  });

  await prisma.users.upsert({
    where: { id: ID.creator },
    update: {},
    create: {
      id: ID.creator,
      email: "creador@escaperoom.local",
      display_name: "Creador de ejemplo",
    },
  });

  await prisma.credit_accounts.upsert({
    where: { id: ID.adminAccount },
    update: {},
    create: { id: ID.adminAccount, user_id: ID.admin, balance_credits: 100_000n },
  });

  await prisma.credit_accounts.upsert({
    where: { id: ID.creatorAccount },
    update: {},
    create: { id: ID.creatorAccount, user_id: ID.creator, balance_credits: 50_000n },
  });

  await prisma.organizations.upsert({
    where: { id: ID.org },
    update: {},
    create: { id: ID.org, name: "Organización de ejemplo", owner_user_id: ID.creator },
  });

  await prisma.organization_members.upsert({
    where: { organization_id_user_id: { organization_id: ID.org, user_id: ID.creator } },
    update: {},
    create: { organization_id: ID.org, user_id: ID.creator, org_role: "owner" },
  });

  await prisma.credit_accounts.upsert({
    where: { id: ID.orgAccount },
    update: {},
    create: { id: ID.orgAccount, organization_id: ID.org, balance_credits: 0n },
  });

  await prisma.rooms.upsert({
    where: { id: ID.room },
    update: {},
    create: {
      id: ID.room,
      author_id: ID.creator,
      title: roomPackage.meta.title,
      status: "published",
      sale_individual: true,
      sale_events: true,
      price_cents: 299,
    },
  });

  await prisma.room_versions.upsert({
    where: { room_id_semver: { room_id: ID.room, semver: roomPackage.meta.version } },
    update: { package: roomPackage as never, assets_hash: assetsHash },
    create: {
      room_id: ID.room,
      semver: roomPackage.meta.version,
      package: roomPackage as never,
      assets_hash: assetsHash,
      changelog: "Versión inicial (seed)",
      published_by: ID.creator,
    },
  });

  console.log(`Seed OK: admin + creador + sala "${roomPackage.meta.title}" publicada`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
