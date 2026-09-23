import { expect, test } from "@playwright/test";
import { SEED } from "../support/env";

/**
 * `purchase-flow.spec.ts` (specs/22 §3.3): catálogo → detalle → checkout
 * Stripe en test mode (tarjeta 4242…) → retorno → acceso concedido → jugar la
 * primera sala sin clave.
 *
 * **Saltado hasta el ticket 5.1 (Stripe):** hoy la pasarela no está conectada
 * (`payments: null`, el checkout responde 501 `PAYMENT_GATEWAY_UNAVAILABLE`).
 * El recorrido queda escrito hasta donde la web existe; al llegar 5.1 hay que
 * quitar el `fixme`, completar el paso de Stripe (con `stripe listen
 * --forward-to` en CI, specs/22 §3.2) y añadirlo al subset de PR (§3.4).
 */
test.fixme(true, "Pendiente del ticket 5.1 (checkout con Stripe en test mode)");

test("compra: catálogo → detalle → checkout Stripe → acceso → jugar sin clave", async ({
  page,
}) => {
  await test.step("catálogo y detalle de la sala", async () => {
    await page.goto("rooms");
    await page.locator(`[data-room-id="${SEED.reyAldricRoomId}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/rooms/${SEED.reyAldricRoomId}`, "u"));
  });

  await test.step("checkout de Stripe en test mode (5.1)", async () => {
    // TODO(5.1): botón de compra → Checkout de Stripe → tarjeta 4242 4242 4242 4242 →
    // retorno a la web con el acceso concedido (webhook reenviado por `stripe listen`).
    throw new Error("Sin pasarela de pago hasta 5.1");
  });

  await test.step("jugar la sala comprada sin clave", async () => {
    // TODO(5.1): entrar en la partida desde «Mis salas» y ver la fase de juego.
  });
});
