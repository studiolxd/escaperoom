-- E-11: outbox mínimo para el email de confirmación de compra (PR #114).
--
-- El webhook de Stripe encola el envío en Redis (mail.purchase-confirmation)
-- justo después de liquidar el pago; si Redis está caído en ese instante
-- exacto, "enqueue" devuelve null y el email nunca se manda, sin que quede
-- rastro más allá de un log. `confirmationSentAt` es la marca de verdad en
-- Postgres (se pone cuando el worker entrega el email, no cuando se encola):
-- un barrido periódico (packages/worker/src/purchase-confirmation-outbox.ts)
-- reencola cualquier compra/evento pagado que lleve más de un margen de
-- gracia sin ella, así un Redis caído al encolar no pierde el email.
ALTER TABLE "purchase" ADD COLUMN "confirmationSentAt" timestamptz;
ALTER TABLE "event" ADD COLUMN "confirmationSentAt" timestamptz;
