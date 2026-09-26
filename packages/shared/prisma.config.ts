import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 ya no carga `.env` por su cuenta (antes sí, buscándolo junto a
 * `schema.prisma`) ni admite `url`/`directUrl` en el bloque `datasource` del
 * schema (P1012): ambas cosas se mueven aquí. `scripts/dev-env.sh` sigue
 * escribiendo `packages/shared/.env` con `DATABASE_URL`/`DIRECT_URL` propios
 * por worktree (ticket 0.12) — hay que cargarlo explícitamente para que
 * `prisma migrate`/`prisma generate`/`prisma db seed`/`prisma studio` lo vean.
 * En CI no existe ese `.env`: las variables ya llegan puestas por el propio
 * workflow, así que la carga es opcional (no truena si falta el fichero).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    // Antes en package.json → `prisma.seed`, que Prisma 7 ya no lee.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrate y las migraciones "shadow" hablan siempre directo con
    // Postgres, nunca a través de PgBouncer (el pooler en modo transacción
    // no es compatible con el DDL de las migraciones ni con las sentencias
    // preparadas que usa el motor de esquema). El cliente en tiempo de
    // ejecución usa su propio adaptador (`createPrismaClient`, en
    // `src/db/index.ts`), que sí puede ir por `DATABASE_URL`/PgBouncer.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
