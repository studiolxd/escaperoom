-- 0007_purchases — compras, pagos e idempotencia de webhooks (specs/14 §7)
CREATE TABLE purchases (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users(id),
  purchase_type             purchase_type NOT NULL,
  room_version_id           uuid REFERENCES room_versions(id),   -- 'room' | 'room_license'
  event_id                  uuid REFERENCES events(id),          -- 'event_credits'
  resulting_room_id         uuid REFERENCES rooms(id),           -- fork completado (licencia/regalo)
  amount_cents              int NOT NULL,
  currency                  char(3) NOT NULL DEFAULT 'EUR',
  platform_fee_cents        int NOT NULL DEFAULT 0,
  creator_share_cents       int,
  stripe_payment_intent_id  text,                                -- null si amount = 0 (regalo)
  stripe_transfer_id        text,                                -- payout al creador vía Connect
  status                    purchase_status NOT NULL DEFAULT 'pending',
  play_session_started_at   timestamptz,                         -- B2C: una partida
  play_session_colyseus_id  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_purchase_target CHECK (
    (purchase_type IN ('room','room_license') AND room_version_id IS NOT NULL AND event_id IS NULL)
    OR (purchase_type = 'event_credits' AND event_id IS NOT NULL AND room_version_id IS NULL)
    OR (purchase_type = 'platform_credits' AND room_version_id IS NULL AND event_id IS NULL)
  ),
  CONSTRAINT chk_purchases_paid_needs_stripe CHECK (
    amount_cents = 0 OR stripe_payment_intent_id IS NOT NULL
  )
);
CREATE INDEX ix_purchases_user ON purchases(user_id, created_at DESC);
CREATE UNIQUE INDEX ux_purchases_stripe_pi ON purchases(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE stripe_webhook_events (
  id          text PRIMARY KEY,                  -- event.id de Stripe
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
