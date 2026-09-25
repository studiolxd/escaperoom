import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";
import { SEED, WEB_URL, databaseUrl } from "../support/env";
import { SAME_ORIGIN, signIn } from "../support/auth";

/**
 * `events-only-room.spec.ts` (punto h de "CTA Jugar", `docs/DEUDA.md`): una
 * sala `saleIndividual: false` + `saleEvents: true` se etiqueta "Solo para
 * eventos" y su único CTA es "Organizar un evento con esta sala" — nunca
 * "Comprar" ni "Jugar" (no hay ningún modo de venta individual). El flujo de
 * creación de evento (mínimo: título + jugadores, precio por jugador
 * visible) es el mismo para cualquier usuario con sesión, no solo el autor
 * (`events.ts createEvent`, specs/02 §3.1 corregido).
 *
 * Sin sala así en el seed (`prisma/seed.ts` solo genera salas con venta
 * individual): se inserta una directamente en Postgres, clonando el
 * `roomVersion.package` de Rey Aldric (contenido real, ya validado).
 */

let pool: Pool | undefined;
function db(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL ?? databaseUrl(), max: 1 });
  return pool;
}

async function seedEventsOnlyRoom(): Promise<{ roomId: string; roomVersionId: string }> {
  const client = db();
  const { rows: authorRows } = await client.query<{ id: string }>(
    `select id from "user" where email = $1`,
    [SEED.creatorEmail],
  );
  const authorId = authorRows[0]?.id;
  if (!authorId) throw new Error(`sin usuario creador (${SEED.creatorEmail}) en la base de e2e`);

  const { rows: sourceRows } = await client.query<{ package: unknown; assetsHash: string }>(
    `select package, "assetsHash" from "roomVersion" where "roomId" = $1 order by "publishedAt" desc limit 1`,
    [SEED.reyAldricRoomId],
  );
  const source = sourceRows[0];
  if (!source) throw new Error("sin roomVersion de Rey Aldric para clonar en la base de e2e");

  const roomId = randomUUID();
  const title = "Sala solo para eventos (E2E)";
  await client.query(
    `insert into room (id, "authorId", title, status, "saleIndividual", "saleEvents", "priceCents")
     values ($1, $2, $3, 'published', false, true, null)`,
    [roomId, authorId, title],
  );
  const roomPackage = { ...(source.package as Record<string, unknown>) };
  const meta = roomPackage.meta as Record<string, unknown>;
  roomPackage.meta = { ...meta, id: roomId, title };
  const { rows: versionRows } = await client.query<{ id: string }>(
    `insert into "roomVersion" (id, "roomId", semver, package, "assetsHash", "publishedBy")
     values ($1, $2, '1.0.0', $3, $4, $5) returning id`,
    [randomUUID(), roomId, JSON.stringify(roomPackage), `${source.assetsHash}:e2e-events-only`, authorId],
  );
  return { roomId, roomVersionId: versionRows[0]!.id };
}

test("sala solo para eventos: badge + 'Organizar un evento con esta sala', sin Comprar ni Jugar @smoke", async ({
  page,
  context,
}) => {
  const { roomId, roomVersionId } = await seedEventsOnlyRoom();

  await test.step("ficha de la sala: badge y único CTA de organizar evento", async () => {
    await page.goto(`rooms/${roomId}`);
    // Badge en la cabecera y precio en la ficha de datos: ambos dicen "Solo
    // para eventos" (puntos h/j), así que se comprueba que aparece al menos
    // una vez en vez de un único match exacto.
    await expect(page.getByText("Solo para eventos").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Comprar" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Jugar/u })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Organizar un evento con esta sala" })).toBeVisible();
  });

  await test.step("sin sesión: el CTA lleva a iniciar sesión, no directo al formulario", async () => {
    await page.getByRole("link", { name: "Organizar un evento con esta sala" }).click();
    await expect(page).toHaveURL(new RegExp(`roomVersionId=${roomVersionId}`, "u"));
    await expect(page.getByRole("heading", { name: /organizar/iu })).toHaveCount(0);
  });

  await test.step("con sesión (cualquier usuario, no solo el autor): formulario con precio visible", async () => {
    await signIn(context, "invitada-eventos@e2e.local");
    // Cuenta recién creada: acepta los términos vigentes por API (no es lo
    // que este test cubre) para no toparse con el interstitial de
    // reaceptación al navegar a una página real (#154).
    await context.request.post(`${WEB_URL}/api/legal/terms-acceptance`, { headers: SAME_ORIGIN });
    await page.goto(`events/new?roomVersionId=${roomVersionId}`);
    await expect(page.getByLabel(/título del evento/iu)).toBeVisible();
    await expect(page.getByText(/precio por jugador/iu)).toBeVisible();
  });
});
