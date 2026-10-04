import { expect, test, type Page } from "@playwright/test";
import { SEED } from "../support/env";
import { UiPlayer } from "../support/game";

/**
 * Al cruzar, la cámara (detrás del avatar) queda pegada a un muro de la cámara, que es pequeña, y
 * el trono no se ve: como haría una persona, se arrastra el ratón para girarla hasta verlo.
 */
async function rotateCameraUntilVisible(page: Page, objectId: string): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("El canvas del juego no tiene tamaño en pantalla.");
  for (let turn = 0; turn < 12; turn += 1) {
    const fraction = await page.evaluate(
      (id) => window.__escaperoomGame?.getObjectScreenFraction(id) ?? null,
      objectId,
    );
    if (fraction && fraction.x > 0.1 && fraction.x < 0.9 && fraction.y > 0.1 && fraction.y < 0.9) {
      return;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
}

/**
 * `game.demo3d.spec.ts` (encargo 7.6): la «Sala de pruebas 3D» (gratis, del seed) se juega en el
 * navegador con el runtime 3D y se completa por clics. `PACKS_ROOT` apunta a una carpeta vacía
 * (`scripts/serve.ts`), así que no hay modelos y el runtime pinta cajas (modo sustitución).
 *
 * Ruta: encender el brasero (inspeccionarlo) → candado del arca con 314 (llave de la cámara) →
 * usar la llave en la puerta → cruzar a la cámara → inspeccionar el trono → victoria.
 */
test("sala de pruebas 3D: se completa por clics y se ve la victoria", async ({ page }) => {
  const player = new UiPlayer(page, "Invitada");

  await test.step("ficha de la sala → «Jugar gratis» → nombre", async () => {
    await page.goto(`rooms/${SEED.demo3dRoomId}`);
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
  });

  await test.step("antesala: brasero, candado del arca y llave", async () => {
    await player.inspect("brasero");
    await player.openPanel("arca");
    await player.typeCode("314");
    await player.expectItems("Llave de la cámara");
  });

  await test.step("la llave abre la puerta y se cruza a la cámara", async () => {
    await player.useItemOn("puerta", "Llave de la cámara");
    // La llave se consume al abrir: la puerta ya está abierta cuando desaparece del inventario.
    await expect(page.getByTestId("game-inventory")).not.toContainText("Llave de la cámara");
    await player.goTo("puerta");
  });

  await test.step("cámara: el trono termina la partida con victoria", async () => {
    await player.stopDismissingDialogs();
    await rotateCameraUntilVisible(page, "trono");
    await player.inspect("trono");
    const results = page.getByRole("dialog", { name: "Resultados" });
    await expect(results).toBeVisible({ timeout: 30_000 });
    await expect(results.getByTestId("results-outcome")).toHaveText("¡Victoria!");
    await expect(player.session).toHaveAttribute("data-phase", "ended");
  });
});
