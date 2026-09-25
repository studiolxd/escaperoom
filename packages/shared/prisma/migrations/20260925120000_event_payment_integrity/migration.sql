-- Auditoría 2026-09-24, bloque de pagos (B-1, B-11, B-16).
--
-- B-11: `event.config` (JSONB) se leía y reescribía entero desde el
-- servicio (read-modify-write); la única condición de `updateEvent` era
-- `status = expected`, así que un `PATCH /api/events/:id` concurrente con
-- `startCheckout` (o con el webhook liquidando el pago) podía perder la
-- escritura del otro sin que ninguno lo notara. `version` añade concurrencia
-- optimista real: cada escritura exige también `version = esperado` y la
-- incrementa; si alguien más escribió primero, `updateEvent` devuelve null y
-- el servicio recarga y reintenta/rechaza según el caso, en vez de pisar.
ALTER TABLE "event" ADD COLUMN "version" integer NOT NULL DEFAULT 1;

-- B-16: nada impedía comprar dos veces la sala (una `purchase` `succeeded`
-- por compra, sin índice único) ni que el propio autor la comprara. El
-- guard de "ya no vuelvas a cobrar" vivía solo en `findOwnedPurchase`
-- (lectura antes de escribir): dos `POST /api/purchases/room-checkout`
-- concurrentes podían colar dos compras `succeeded` de la misma versión
-- para el mismo usuario. Igual que `uxPurchaseStripePi`, el índice es
-- parcial (solo cuando de verdad hay algo que proteger).
CREATE UNIQUE INDEX "uxPurchaseOwnedRoom" ON "purchase"("userId", "roomVersionId")
  WHERE "purchaseType" = 'room' AND status = 'succeeded';
