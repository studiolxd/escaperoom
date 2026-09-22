-- 0007_purchases — compras, pagos e idempotencia de webhooks (specs/14 §7)
CREATE TABLE "purchase" (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"                  text NOT NULL REFERENCES "user"(id),
  "purchaseType"            "purchaseType" NOT NULL,
  "roomVersionId"           uuid REFERENCES "roomVersion"(id),   -- 'room' | 'room_license'
  "eventId"                 uuid REFERENCES "event"(id),         -- 'event_credits'
  "resultingRoomId"         uuid REFERENCES "room"(id),          -- fork completado
  "amountCents"             int NOT NULL,
  currency                  char(3) NOT NULL DEFAULT 'EUR',
  "platformFeeCents"        int NOT NULL DEFAULT 0,
  "creatorShareCents"       int,
  "stripePaymentIntentId"   text,                                -- null si amount = 0 (regalo)
  "stripeTransferId"        text,
  status                    "purchaseStatus" NOT NULL DEFAULT 'pending',
  "playSessionStartedAt"    timestamptz,                         -- B2C: una partida
  "playSessionColyseusId"   text,
  "createdAt"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chkPurchaseTarget" CHECK (
    ("purchaseType" IN ('room','room_license') AND "roomVersionId" IS NOT NULL AND "eventId" IS NULL)
    OR ("purchaseType" = 'event_credits' AND "eventId" IS NOT NULL AND "roomVersionId" IS NULL)
    OR ("purchaseType" = 'platform_credits' AND "roomVersionId" IS NULL AND "eventId" IS NULL)
  ),
  CONSTRAINT "chkPurchasePaidNeedsStripe" CHECK (
    "amountCents" = 0 OR "stripePaymentIntentId" IS NOT NULL
  )
);
CREATE INDEX "ixPurchaseUser" ON "purchase"("userId", "createdAt" DESC);
CREATE UNIQUE INDEX "uxPurchaseStripePi" ON "purchase"("stripePaymentIntentId")
  WHERE "stripePaymentIntentId" IS NOT NULL;

CREATE TABLE "stripeWebhookEvent" (
  id            text PRIMARY KEY,                  -- event.id de Stripe
  type          text NOT NULL,
  "receivedAt"  timestamptz NOT NULL DEFAULT now()
);
