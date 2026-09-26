import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/client/client";

const DEFAULT_POOL_MAX = 10;

export type CreatePrismaClientOptions = {
  /** Por defecto, `DATABASE_URL` (en CI/producción va a través de PgBouncer). */
  connectionString?: string;
  /**
   * Tamaño máximo del pool `pg` de este proceso. Por defecto,
   * `DB_POOL_MAX` o, si falta, {@link DEFAULT_POOL_MAX}. Cada proceso (web,
   * worker, colyseus-server, editor-sync) fija el suyo en su `.env` — ver
   * `infra/README.md`.
   */
  max?: number;
};

/**
 * Único punto de creación del cliente Prisma (ADR-015). Prisma 7 no trae
 * motor de Rust: el adaptador `@prisma/adapter-pg` monta su propio pool
 * `pg`, así que cada proceso que llama a esto controla su propio `max`
 * (antes, con el engine embebido, el límite de conexiones no era explícito
 * por proceso).
 */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  const max = options.max ?? Number(process.env.DB_POOL_MAX ?? DEFAULT_POOL_MAX);
  const adapter = new PrismaPg({ connectionString, max });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * Perezoso a propósito: NO se construye al importar este módulo, sino al
 * primer acceso real. `packages/worker/src/main.ts` importa `prisma` de
 * forma estática arriba del fichero, antes de cargar
 * `packages/shared/.env`/`packages/worker/.env` (su `loadLocalEnv()`, más
 * abajo en el mismo fichero) — con el motor de Rust anterior no importaba
 * (no se conectaba hasta la primera query), pero el adaptador construye su
 * pool `pg` con la `connectionString` que tenga en ese momento, así que
 * crearlo al importar fijaría `DATABASE_URL` a `undefined` para siempre.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, prop) {
    return Reflect.has(getPrisma() as object, prop);
  },
});

export * from "../../generated/client/client";
