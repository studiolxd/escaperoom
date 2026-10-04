import { expect, test } from "@playwright/test";
import { SEED } from "../support/env";
import { rotateCameraUntilVisible, UiPlayer } from "../support/game";

/**
 * `game.reyaldric-3d.spec.ts` (encargo 7.10b, specs/27 §11-§12): de humo, un jugador. «La Maldición
 * del Rey Aldric (3D)» (gratis, del seed) se juega en el navegador con el runtime 3D, en modo
 * sustitución (`PACKS_ROOT` apunta a una carpeta vacía, `scripts/serve.ts`: sin modelos, el runtime
 * pinta cajas). Se resuelve el PRIMER paso de la ruta crítica del validador para un jugador
 * (`p-llave-cuadro`: inspeccionar el cuadro revela la llave del suelo, que se recoge) y se comprueba
 * con `data-solved-puzzles` que el servidor lo da por resuelto. Los puzles cooperativos y el resto
 * de la ruta ya los cubre el E2E 2D (`game.reyaldric.spec.ts`): la lógica es la misma.
 */
test("Rey Aldric 3D: se llega al mapa 3D y se resuelve el primer puzle de la ruta crítica", async ({ page }) => {
  const player = new UiPlayer(page, "Invitada");

  await test.step("ficha de la sala → «Jugar gratis» → nombre", async () => {
    await page.goto(`rooms/${SEED.reyAldric3dRoomId}`);
    await expect(page.getByRole("heading", { name: "La Maldición del Rey Aldric (3D)" })).toBeVisible();
    await page.getByRole("button", { name: "Jugar gratis" }).first().click();
    await expect(page).toHaveURL(/\/play\/room\//u);
    await player.enterName();
  });

  await test.step("lobby → empezar → mapa 3D", async () => {
    await player.markReady();
    await page.getByTestId("game-start").click();
    await player.enterMapAfterStart();
    await player.dismissDialogsWhenBlocking();
    await expect(page.locator("[data-dimension='3d']")).toBeVisible();
    await expect(player.session).toHaveAttribute("data-solved-puzzles", "0");
  });

  await test.step("Salón del Trono: el cuadro esconde la llave de bronce (p-llave-cuadro)", async () => {
    await rotateCameraUntilVisible(page, "cuadro-aurelio");
    await player.inspect("cuadro-aurelio");
    await rotateCameraUntilVisible(page, "llave-bronce-suelo");
    await player.pickUp("llave-bronce-suelo");
    await player.expectItems("Llave de bronce");
    await player.expectSolvedAtLeast(1);
  });
});
