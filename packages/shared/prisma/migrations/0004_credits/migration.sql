-- 0004_credits — ledger de créditos (specs/14 §4)
CREATE TABLE credit_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users(id),
  organization_id  uuid REFERENCES organizations(id),
  balance_credits  bigint NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_exactly_one_owner CHECK (
    (user_id IS NOT NULL)::int + (organization_id IS NOT NULL)::int = 1
  )
);
CREATE UNIQUE INDEX ux_credit_accounts_user ON credit_accounts(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_credit_accounts_org  ON credit_accounts(organization_id) WHERE organization_id IS NOT NULL;
CREATE TRIGGER trg_credit_accounts_updated_at BEFORE UPDATE ON credit_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE credit_movements (
  id               bigserial PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES credit_accounts(id),
  movement_type    credit_movement_type NOT NULL,
  amount_credits   bigint NOT NULL,             -- positivo = ingreso, negativo = consumo
  balance_after    bigint NOT NULL,
  reference_type   text,                        -- 'audio_generation' | 'stripe_payment' | 'manual_adjustment'
  reference_id     text,                        -- audio: '{dialogId|hintId}:{locale}'
  metadata         jsonb NOT NULL DEFAULT '{}',
  created_by       uuid REFERENCES users(id),   -- null = sistema
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_credit_movements_account ON credit_movements(account_id, created_at DESC);

-- El saldo NUNCA se escribe directo: siempre vía función transaccional.
CREATE OR REPLACE FUNCTION apply_credit_movement(
  p_account_id uuid, p_type credit_movement_type, p_amount bigint,
  p_reference_type text, p_reference_id text, p_metadata jsonb, p_created_by uuid
) RETURNS bigint AS $$
DECLARE v_new_balance bigint;
BEGIN
  UPDATE credit_accounts SET balance_credits = balance_credits + p_amount
    WHERE id = p_account_id
    RETURNING balance_credits INTO v_new_balance;
  INSERT INTO credit_movements(account_id, movement_type, amount_credits, balance_after,
    reference_type, reference_id, metadata, created_by)
    VALUES (p_account_id, p_type, p_amount, v_new_balance, p_reference_type, p_reference_id, p_metadata, p_created_by);
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;
