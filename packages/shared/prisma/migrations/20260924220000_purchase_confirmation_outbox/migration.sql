-- E-11: outbox mínimo para el email de confirmación de compra (PR #114).
--
-- El webhook de Stripe encola el envío en Redis (mail.purchase-confirmation)
-- justo después de liquidar el pago. Si Redis está caído en ese instante
-- exacto, "enqueue" devuelve null y el email nunca se manda, sin que quede
-- rastro más allá de un log. `confirmationSentAt` es la marca de verdad en
-- Postgres (se pone cuando el worker entrega el email, no cuando se encola):
-- un barrido periódico (packages/worker/src/purchase-confirmation-outbox.ts)
-- reencola cualquier compra/evento pagado que lleve más de un margen de
-- gracia sin ella, así un Redis caído al encolar no pierde el email.
ALTER TABLE "purchase" ADD COLUMN "confirmationSentAt" timestamptz;
ALTER TABLE "event" ADD COLUMN "confirmationSentAt" timestamptz;

-- Backfill (revisión de PR #119): sin esto, TODA compra succeeded / evento
-- pagado histórico (anteriores a #114, que nunca recibieron el email, o
-- posteriores, que ya lo recibieron vía #114 pero sin marcador) entrarían de
-- golpe en el barrido al desplegar y recibirían el email de confirmación de
-- nuevo. Se marcan como ya confirmados: solo lo que se liquide DESPUÉS de
-- esta migración puede caer en el outbox.
UPDATE "purchase"
SET "confirmationSentAt" = now()
WHERE "purchaseType" IN ('room', 'room_license')
  AND status = 'succeeded'
  AND "confirmationSentAt" IS NULL;

UPDATE "event"
SET "confirmationSentAt" = now()
WHERE (config -> 'payment' ->> 'status') = 'paid'
  AND "confirmationSentAt" IS NULL;
