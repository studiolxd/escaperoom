-- 0004_credits — ledger de créditos (specs/14 §4)
CREATE TABLE "creditAccount" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"          text REFERENCES "user"(id),
  "organizationId"  text REFERENCES "organization"(id),
  "balanceCredits"  bigint NOT NULL DEFAULT 0 CHECK ("balanceCredits" >= 0),
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chkCreditAccountOwner" CHECK (
    (("userId" IS NOT NULL)::int + ("organizationId" IS NOT NULL)::int) = 1
  )
);
CREATE UNIQUE INDEX "uxCreditAccountUser" ON "creditAccount"("userId") WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "uxCreditAccountOrg"  ON "creditAccount"("organizationId") WHERE "organizationId" IS NOT NULL;
CREATE TRIGGER "trgCreditAccountUpdatedAt" BEFORE UPDATE ON "creditAccount"
  FOR EACH ROW EXECUTE FUNCTION "setUpdatedAt"();

CREATE TABLE "creditMovement" (
  id               bigserial PRIMARY KEY,
  "accountId"      uuid NOT NULL REFERENCES "creditAccount"(id),
  "movementType"   "creditMovementType" NOT NULL,
  "amountCredits"  bigint NOT NULL,             -- positivo = ingreso, negativo = consumo
  "balanceAfter"   bigint NOT NULL,
  "referenceType"  text,                        -- 'audio_generation' | 'stripe_payment' | 'manual_adjustment'
  "referenceId"    text,                        -- audio: '{dialogId|hintId}:{locale}'
  metadata         jsonb NOT NULL DEFAULT '{}',
  "createdBy"      text REFERENCES "user"(id),  -- null = sistema
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ixCreditMovementAccount" ON "creditMovement"("accountId", "createdAt" DESC);

-- El saldo NUNCA se escribe directo: siempre vía función transaccional.
CREATE OR REPLACE FUNCTION "applyCreditMovement"(
  p_account_id uuid, p_type "creditMovementType", p_amount bigint,
  p_reference_type text, p_reference_id text, p_metadata jsonb, p_created_by text
) RETURNS bigint AS $$
DECLARE v_new_balance bigint;
BEGIN
  UPDATE "creditAccount" SET "balanceCredits" = "balanceCredits" + p_amount
    WHERE id = p_account_id
    RETURNING "balanceCredits" INTO v_new_balance;
  INSERT INTO "creditMovement"("accountId", "movementType", "amountCredits", "balanceAfter",
    "referenceType", "referenceId", metadata, "createdBy")
    VALUES (p_account_id, p_type, p_amount, v_new_balance, p_reference_type, p_reference_id, p_metadata, p_created_by);
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;
