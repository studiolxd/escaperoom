import { expect, test, type Browser } from "@playwright/test";
import {
  ROOM_NAMES,
  UiPlayer,
  readSplitFragments,
  solveCanal,
  solveMemory,
  solveMural,
  submitSymbols,
} from "../support/game";

/**
 * `game.reyaldric.spec.ts` (specs/22 §3.3): contraparte con navegador del E2E
 * de protocolo (`colyseus-server/test/e2e.reyaldric.spec.ts`). Dos
 * `BrowserContext` — dos jugadores reales — se unen a la misma partida de
 * `/play` y completan la ruta crítica de 14 pasos
 * (`docs/reference/rey-aldric-notas-diseno.md`) **solo con clics** en la UI:
 * lista de objetos, menú de acciones, inventario y paneles de puzle. Termina
 * con la pantalla de resultados «¡Victoria!» en ambos navegadores.
 *
 * Dos tests:
 * - `@smoke` (subset de PR, §3.4; un fallo bloquea el merge): unirse por el
 *   link de invitación, empezar y resolver el Salón del Trono (pasos 1–6)
 *   hasta cruzar juntos a la Bodega. Cubre protocolo, WebSocket real, menú,
 *   inventario, candado y placas simultáneas en ≈1 min.
 * - ruta completa (nightly): los 14 pasos hasta la victoria (≈4 min a ritmo
 *   de persona por los límites por mensaje de la `GameRoom`).
 */

async function newPlayer(browser: Browser, name: string): Promise<UiPlayer> {
  const context = await browser.newContext();
  return new UiPlayer(await context.newPage(), name);
}

/** Pasos comunes: partida por invitación, inicio y Salón del Trono (pasos 1–6) → Bodega. */
async function playThroneRoom(a: UiPlayer, b: UiPlayer): Promise<void> {
  await test.step("Ana crea la partida y Bruno entra con el link de invitación", async () => {
    await a.page.goto("play");
    await a.enterName();
    await expect(a.page).toHaveURL(/[?&]room=/u);
    await b.page.goto(a.page.url());
    await b.enterName();
    await expect(a.page.getByTestId("game-players")).toContainText("Bruno");
    await expect(b.page.getByTestId("game-players")).toContainText("Ana");
  });

  await test.step("la anfitriona empieza: intro y fase de juego para los dos", async () => {
    await expect(b.page.getByTestId("game-start")).toHaveCount(0);
    await a.page.getByTestId("game-start").click();
    for (const player of [a, b]) {
      await expect(player.session).toHaveAttribute("data-phase", "playing");
      await expect(player.page.getByTestId("game-dialog")).toHaveAttribute("data-intro", "true");
      await player.closeDialog();
      await player.dismissDialogsWhenBlocking();
    }
  });

  await test.step("Salón del Trono (pasos 1–6)", async () => {
    // 1. Inspeccionar el cuadro → llave de bronce
    await a.inspect("cuadro-aurelio");
    await a.expectItems("Llave de bronce");
    // 2. Abrir el armario con la llave → yesquero + vela
    await a.useItemOn("armario", "Llave de bronce");
    await a.expectItems("Yesquero", "Vela");
    // 3. Combinar yesquero + vela → antorcha
    await a.combine(["Yesquero", "Vela"], "Antorcha encendida");
    // 4. Encender el brasero con la antorcha → dígito 3
    await a.inspect("brasero");
    // 5. Candado del arca «4732» → cáliz + pergamino
    await a.openPanel("arca-candado");
    await a.typeCode("4732");
    await a.expectItems("Cáliz real", "Pergamino de los vinos");
    // 6. Placas simultáneas: cada jugador sobre una placa → puerta de la bodega
    await a.openPanel("puerta-bodega");
    await b.openPanel("puerta-bodega");
    await a.page.getByRole("button", { name: "Placa placa-izq" }).click();
    await b.page.getByRole("button", { name: "Placa placa-der" }).click();
    for (const player of [a, b]) {
      await player.goTo(ROOM_NAMES.bodega);
    }
  });
}

// Cada test abre sus propios contextos (jugadores, organizador, pestañas):
// se cierran siempre, también si falla, para no dejar partidas vivas que
// resten CPU al siguiente.
test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

test("Rey Aldric: 2 jugadores se unen y abren la bodega por clics (pasos 1–6) @smoke", async ({
  browser,
}) => {
  const a = await newPlayer(browser, "Ana");
  const b = await newPlayer(browser, "Bruno");
  await playThroneRoom(a, b);
  for (const player of [a, b]) {
    await expect(player.page.getByTestId("game-object-mural-vendimia")).toBeVisible();
  }
});

test("Rey Aldric: 2 jugadores completan la sala por clics y ven la victoria", async ({
  browser,
}) => {
  // Ritmo de persona (límites por mensaje de la GameRoom): ~4 min de partida.
  test.setTimeout(420_000);
  const a = await newPlayer(browser, "Ana");
  const b = await newPlayer(browser, "Bruno");
  await playThroneRoom(a, b);

  await test.step("Bodega (pasos 7–11)", async () => {
    // 7. Mural deslizante 3×3 → compartimento → llave de plata
    await b.openPanel("mural-vendimia");
    await solveMural(b);
    await b.expectItems("Llave de plata");
    // 8. Examinar la llave de plata (receta de un ingrediente) → llave de oro
    await b.combine(["Llave de plata"], "Llave de oro");
    await b.expectItems("Llave de plata", "Llave de oro");
    // 9. Cáliz en la ranura del mural (lore) y recuperarlo
    await a.inspect("mural-ranura");
    await a.expectItems("Cáliz real");
    // 10. Memoria de copas, por turnos entre los dos
    await a.openPanel("mesa-catas");
    await b.openPanel("mesa-catas");
    await solveMemory([a, b]);
    await a.expectSolvedAtLeast(5);
    // 11. Mirillas: cada uno ve media pista; se la «dicen» y Bruno la teclea
    await a.openPanel("mirilla-a");
    await b.openPanel("mirilla-b");
    const halfA = await readSplitFragments(a);
    const halfB = await readSplitFragments(b);
    expect(Object.keys(halfA).length).toBeLessThan(4);
    expect(Object.keys(halfB).length).toBeLessThan(4);
    const symbols = [0, 1, 2, 3].map((index) => halfA[index] ?? halfB[index]!);
    await submitSymbols(b, symbols);
    // La reja se abre: `puzzle_solved` cierra el panel de los dos.
    for (const player of [a, b]) {
      await player.goTo(ROOM_NAMES.catacumbas);
    }
  });

  await test.step("Catacumbas (pasos 12–14) y victoria", async () => {
    // 12. Canal de tuberías: la compuerta se abre con la llave de oro
    await b.openPanel("canal-entrada");
    await solveCanal(b);
    // 13. Vasijas (dígito 8) y sarcófago (recuerdo del código)
    await a.inspect("vasijas");
    await a.inspect("sarcofago");
    // 14. Sello final «4538» → relicario → victoria (tras el `delay` de 4 s)
    await a.openPanel("relicario");
    await a.typeCode("4538");
    for (const player of [a, b]) {
      await player.stopDismissingDialogs();
      const results = player.page.getByRole("dialog", { name: "Resultados" });
      await expect(results).toBeVisible({ timeout: 30_000 });
      await expect(results.getByTestId("results-outcome")).toHaveText("¡Victoria!");
      await expect(player.session).toHaveAttribute("data-phase", "ended");
    }
  });
});
