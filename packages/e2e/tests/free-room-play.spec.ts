import { expect, test } from "@playwright/test";
import { SEED } from "../support/env";
import { UiPlayer } from "../support/game";

/**
 * `free-room-play.spec.ts` (punto i de "CTA Jugar", `docs/DEUDA.md`): una
 * sala realmente gratis (`priceCents: 0` + `saleIndividual: true` — la sala
 * sembrada de Rey Aldric, `SEED.reyAldricRoomId`, cumple ambas) se juega
 * **sin cuenta**: el botón "Jugar gratis" de la ficha nunca pide login, y
 * `GET /api/rooms/:roomId/free-access` emite un `gameToken` `kind: "free"`
 * que la `GameRoom` acepta sin `purchase` ni Stripe.
 */
test("sala gratis: 'Jugar gratis' sin sesión conecta a una GameRoom real @smoke", async ({
  page,
}) => {
  await test.step("ficha de la sala: 'Jugar gratis' visible sin sesión", async () => {
    // Directo por id (no por el catálogo): con 50 salas de desarrollo
    // sembradas, la posición de Rey Aldric en el listado por defecto
    // ("recientes") no está garantizada.
    await page.goto(`rooms/${SEED.reyAldricRoomId}`);
    // Nunca pide login: sin sesión, el botón está visible y habilitado.
    await expect(page.getByRole("button", { name: "Jugar gratis" })).toBeVisible();
    await expect(page.getByRole("link", { name: /inicia sesión/iu })).toHaveCount(0);
  });

  const player = new UiPlayer(page, "Invitada");
  await test.step("clic conecta a una partida real, sin pasar por login/checkout", async () => {
    await page.getByRole("button", { name: "Jugar gratis" }).click();
    await expect(page).toHaveURL(/\/play\/room\//u);
    await player.enterName();
  });
});
