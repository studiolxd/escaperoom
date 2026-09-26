import { Pool } from "pg";
import { databaseUrl } from "./env";

/**
 * Pool de Postgres propio de la suite (mismo motivo que `support/auth.ts`:
 * el cliente Prisma generado no lo carga el loader ESM estricto de
 * Playwright). Usarlo solo para lo que ningún endpoint real expone —
 * comprobaciones/lecturas puntuales del test, nunca para sustituir un flujo
 * de producto.
 */
let pool: Pool | undefined;
function dbPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL ?? databaseUrl(), max: 1 });
  return pool;
}

/**
 * Id de la sala forkeada de `forkedFromRoomId` que ahora pertenece a
 * `recipientEmail` (B-10, `docs/DEUDA.md`): `POST /rooms/:roomId/gift-copy`
 * responde siempre 202 con un mensaje genérico (nunca revela si el email
 * existe ni el id del fork), así que el E2E de publicación necesita otra vía
 * para encontrar la sala que acaba de recibir el creador de la prueba — el
 * producto aún no tiene una pantalla de "mis salas"/notificación (deuda
 * aparte). Lee directo de Postgres, igual que `waitForMagicLinkToken`.
 */
export async function findGiftedRoomId(
  recipientEmail: string,
  forkedFromRoomId: string,
): Promise<string> {
  const db = dbPool();
  const { rows } = await db.query<{ id: string }>(
    `select r.id
       from room r
       join "user" u on u.id = r."authorId"
      where u.email = $1
        and r."forkedFromRoomId" = $2
      order by r."createdAt" desc
      limit 1`,
    [recipientEmail, forkedFromRoomId],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(
      `sin sala forkeada de ${forkedFromRoomId} para ${recipientEmail} (gift-copy no la creó, o el email/roomId no coinciden)`,
    );
  }
  return id;
}
