import { expect, test, type Page } from "@playwright/test";
import { SEED } from "../support/env";
import { rotateCameraUntilVisible, UiPlayer } from "../support/game";

/**
 * El jugador aparece junto a la puerta sur mirando al sur y la cámara va detrás de él (al norte),
 * así que el cuadro, 11 m al norte, no se ve. Como haría una persona: se gira la cámara 180°
 * arrastrando el ratón (0,3°/px → 600 px) y se camina con W (hacia donde mira la cámara) hasta que
 * el objeto entra en plano; después ya se puede pulsar sobre él.
 */
async function walkNorthUntilVisible(page: Page, objectId: string): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("El canvas del juego no tiene tamaño en pantalla.");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let drag = 0; drag < 5; drag += 1) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 6 });
    await page.mouse.up();
  }
  // «En plano» con margen: pegado al borde de la pantalla el clic podría fallar al moverse la cámara.
  const inView = () =>
    page.evaluate((id) => {
      const at = window.__escaperoomGame?.getObjectScreenFraction(id);
      return at !== undefined && at.x > 0.08 && at.x < 0.92 && at.y > 0.15 && at.y < 0.9;
    }, objectId);
  for (let step = 0; step < 20 && !(await inView()); step += 1) {
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(500);
    await page.keyboard.up("KeyW");
  }
  await expect.poll(inView, { message: `«${objectId}» no entra en plano` }).toBe(true);
  await page.waitForTimeout(500); // la cámara sigue al avatar con un pequeño retardo
}

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
    await walkNorthUntilVisible(page, "cuadro-aurelio");
    await player.inspect("cuadro-aurelio");
    await rotateCameraUntilVisible(page, "llave-bronce-suelo");
    await player.pickUp("llave-bronce-suelo");
    await player.expectItems("Llave de bronce");
    await player.expectSolvedAtLeast(1);
  });
});
