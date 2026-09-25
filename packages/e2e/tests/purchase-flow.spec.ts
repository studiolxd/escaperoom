import { expect, test } from "@playwright/test";
import { SEED } from "../support/env";

/**
 * `purchase-flow.spec.ts` (specs/22 §3.3): catálogo → detalle → checkout
 * Stripe en test mode (tarjeta 4242…) → retorno → acceso concedido → jugar la
 * primera sala sin clave.
 *
 * **Sigue saltado (auditoría 2026-09-24, B-27):** el ticket 5.1 ya está
 * cableado — `BuyRoomButton` (#157) llama a `POST /api/purchases/room-checkout`
 * y `GET /api/rooms/:roomId/access` (B-4) concede el acceso tras el pago — el
 * recorrido de dominio existe de punta a punta. Lo que sigue faltando es
 * infraestructura de CI, no código de producto: este worktree no tiene
 * `STRIPE_SECRET_KEY` de test ni un proceso `stripe listen --forward-to` que
 * reenvíe `checkout.session.completed` al webhook (specs/22 §3.2), y no es
 * algo que un agente pueda aprovisionar (credenciales de Stripe como secreto
 * de CI). Añadir un "gateway falso" que se salte Stripe de verdad crearía una
 * ruta de confirmación de pago sin pasar por Stripe dentro del código de
 * producción — justo el tipo de superficie que esta auditoría de seguridad
 * está cerrando en otros hallazgos — así que no se ha hecho aquí. Al
 * aprovisionar las credenciales de test en CI: quitar el `fixme`, completar
 * el paso de Stripe y añadirlo al subset de PR (§3.4).
 */
test.fixme(true, "Pendiente de credenciales Stripe de test en CI (stripe listen --forward-to)");

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
