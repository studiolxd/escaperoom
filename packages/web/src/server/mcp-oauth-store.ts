import { randomUUID } from "node:crypto";
import type { OAuthStore } from "@escaperoom/mcp-server";

/** Lo mínimo del delegado Prisma de `verification` que usa el almacén. */
export type VerificationDelegate = {
  findFirst(args: {
    where: { identifier: string; expiresAt: { gt: Date } };
    orderBy: { createdAt: "desc" };
  }): Promise<{ id: string; value: string } | null>;
  create(args: {
    data: { id: string; identifier: string; value: string; expiresAt: Date };
  }): Promise<unknown>;
  deleteMany(args: { where: { identifier: string } | { id: string } }): Promise<{ count: number }>;
};

/** Prefijo de las filas del OAuth del MCP en `verification`. */
export const MCP_OAUTH_IDENTIFIER_PREFIX = "mcp-oauth:";

/**
 * Almacén del OAuth del MCP (ticket 4.7) sobre la tabla `verification` de
 * Better Auth: clave → valor JSON con caducidad, que es justo su forma
 * (`identifier`, `value`, `expiresAt`, con índice por `identifier`). Así no
 * hace falta migración. Los tokens llegan ya hasheados desde el proveedor;
 * nunca se guardan en claro.
 */
export function createPrismaOAuthStore(
  verification: VerificationDelegate,
  now: () => Date = () => new Date(),
): OAuthStore {
  const identifier = (key: string) => `${MCP_OAUTH_IDENTIFIER_PREFIX}${key}`;
  const find = (key: string) =>
    verification.findFirst({
      where: { identifier: identifier(key), expiresAt: { gt: now() } },
      orderBy: { createdAt: "desc" },
    });

  return {
    async put(key, value, expiresAt) {
      await verification.deleteMany({ where: { identifier: identifier(key) } });
      await verification.create({
        data: {
          id: randomUUID(),
          identifier: identifier(key),
          value: JSON.stringify(value),
          expiresAt,
        },
      });
    },
    async get<T>(key: string) {
      const row = await find(key);
      return row ? (JSON.parse(row.value) as T) : null;
    },
    async take<T>(key: string) {
      const row = await find(key);
      if (!row) return null;
      // Solo quien borra la fila se queda el valor: un código no se canjea dos veces.
      const { count } = await verification.deleteMany({ where: { id: row.id } });
      return count === 1 ? (JSON.parse(row.value) as T) : null;
    },
    async delete(key) {
      await verification.deleteMany({ where: { identifier: identifier(key) } });
    },
  };
}
