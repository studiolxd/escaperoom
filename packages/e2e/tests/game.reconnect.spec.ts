import { expect, test } from "@playwright/test";
import { UiPlayer } from "../support/game";

/**
 * `game.reconnect.spec.ts` (C-2, ajuste 2026-09-25 — revisión de la
 * coordinadora sobre la PR #146): la reconexión de la `GameRoom` desnuda
 * tiene que sobrevivir no solo a una caída de red dentro de la misma pestaña
 * (ya cubierto por `game-room-reconnection.test.ts` en `colyseus-server`, sin
 * navegador), sino también a que el JUGADOR recargue la página o cierre y
 * reabra la pestaña — el caso en que se pierden los objetos JS en memoria
 * (`use-game-connection.ts`) y solo queda lo que persiste el propio navegador
 * (`lib/game-reconnect.ts`, `localStorage`).
 *
 * Usa `/dev/game-room` (retirada `/[locale]/play`, DEUDA) y no el flujo real
 * de sala gratis (`/play/room/:roomId`): cada emisión de `free-access`
 * corresponde a una `GameRoom` NUEVA (specs/13), así que ese flujo no tiene
 * forma de recuperar la partida si se pierde el `gameToken` de la pestaña —
 * justo lo que este test necesita poner a prueba. `/dev/game-room` firma un
 * `gameToken` `kind: "dev_test"` fresco en cada carga (nunca en un despliegue
 * real sin `ALLOW_DEV_SECRETS`, `isDevFallbackAllowed`), así que no depende
 * de nada persistido en el cliente para poder reconectar.
 *
 * Con un solo jugador (el motor admite partidas en solitario, specs/26):
 * anfitrión, sin depender de un segundo navegador para la aserción principal.
 */

test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

test("recargar la página a mitad de partida conserva inventario y personaje", async ({
  page,
}) => {
  const a = new UiPlayer(page, "Ana");
  await page.goto("dev/game-room");
  await a.enterName();
  await expect(page).toHaveURL(/[?&]room=/u);
  const url = page.url();

  await a.markReady();
  await page.getByTestId("game-start").click();
  await expect(a.session).toHaveAttribute("data-phase", "playing");
  await a.closeDialog();

  await a.inspect("cuadro-aurelio");
  await a.expectItems("Llave de bronce");
  await expect(page.getByTestId("game-players")).toContainText("Ana");

  await page.reload();

  // Vuelve directamente a la partida (no a la pantalla de nombre): el
  // `reconnectionToken` guardado en `localStorage` la recupera.
  await expect(a.session).toBeVisible({ timeout: 30_000 });
  await expect(a.session).toHaveAttribute("data-phase", "playing");
  await expect(page).toHaveURL(url);
  await a.expectItems("Llave de bronce");
  // Un solo jugador: si la plaza antigua no se hubiera liberado, aparecería
  // una segunda entrada "fantasma" desconectada en vez de una sola.
  const players = page.getByTestId("game-players");
  await expect(players).toContainText("Ana");
  await expect(players.locator("li")).toHaveCount(1);
});

test("cerrar la pestaña y abrir otra a mitad de partida conserva inventario y plaza", async ({
  context,
}) => {
  const firstPage = await context.newPage();
  const a = new UiPlayer(firstPage, "Ana");
  await firstPage.goto("dev/game-room");
  await a.enterName();
  await expect(firstPage).toHaveURL(/[?&]room=/u);
  const url = firstPage.url();

  await a.markReady();
  await firstPage.getByTestId("game-start").click();
  await expect(a.session).toHaveAttribute("data-phase", "playing");
  await a.closeDialog();
  await a.inspect("cuadro-aurelio");
  await a.expectItems("Llave de bronce");

  // Cierra esa pestaña (el `localStorage` del contexto sobrevive: es del
  // origen, no de la pestaña) y abre una nueva en la misma URL, como haría
  // alguien que cerró el navegador y volvió más tarde.
  await firstPage.close();
  const secondPage = await context.newPage();
  const again = new UiPlayer(secondPage, "Ana");
  await secondPage.goto(url);

  await expect(again.session).toBeVisible({ timeout: 30_000 });
  await expect(again.session).toHaveAttribute("data-phase", "playing");
  await again.expectItems("Llave de bronce");
  const players = secondPage.getByTestId("game-players");
  await expect(players.locator("li")).toHaveCount(1);
});
