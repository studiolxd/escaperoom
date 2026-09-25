import type { Actor } from "./actor";
import { requireUser } from "./common";

/**
 * Ledger de créditos de plataforma (ticket 4.9, specs/14 §4, specs/15 §2). El
 * esquema (`creditAccount`/`creditMovement` + la función SQL
 * `applyCreditMovement`) ya está migrado (0004_credits); este servicio es la
 * única lógica de dominio por encima de esa función — resuelve la cuenta del
 * actor (personal u organización) y traduce el `CHECK "balanceCredits" >= 0`
 * en un error de dominio legible.
 *
 * La compra de créditos (Stripe) es de los tickets 5.1/5.2, fuera de alcance
 * aquí: este servicio solo cubre el **consumo**.
 */

export type CreditMovementType = "purchase" | "consumption" | "refund" | "adjustment";

export type CreditAccountRow = {
  id: string;
  userId: string | null;
  organizationId: string | null;
  balanceCredits: bigint;
};

export type ApplyMovementInput = {
  accountId: string;
  type: CreditMovementType;
  /** Con signo: positivo = ingreso, negativo = consumo. */
  amountCredits: bigint;
  referenceType: string | null;
  referenceId: string | null;
  metadata?: Record<string, unknown>;
  createdBy: string | null;
};

/** Puerto de persistencia del ledger (ADR-022). */
export interface CreditAccountStore {
  /** La cuenta del actor (organización activa, o personal si no hay una). La crea con saldo 0 si no existe. */
  ensureAccountForActor(actor: Actor): Promise<CreditAccountRow>;
  getAccount(accountId: string): Promise<CreditAccountRow | null>;
  /**
   * Aplica un movimiento con `applyCreditMovement` (transaccional). Lanza
   * `InsufficientCreditsError` si el `CHECK "balanceCredits" >= 0` aborta la
   * transacción (consumo mayor que el saldo).
   */
  applyMovement(input: ApplyMovementInput): Promise<bigint>;
}

export type CreditErrorCode = "UNAUTHORIZED" | "INSUFFICIENT_CREDITS";

export class CreditError extends Error {
  readonly code: CreditErrorCode;
  constructor(code: CreditErrorCode, message: string) {
    super(message);
    this.name = "CreditError";
    this.code = code;
  }
}

/** Alias por compatibilidad con el nombre que usan los llamantes (mensaje con saldo). */
export class InsufficientCreditsError extends CreditError {
  readonly balanceCredits: bigint;
  readonly requiredCredits: bigint;
  constructor(balanceCredits: bigint, requiredCredits: bigint) {
    super(
      "INSUFFICIENT_CREDITS",
      `Saldo insuficiente: hacen falta ${requiredCredits} créditos y solo hay ${balanceCredits}`,
    );
    this.balanceCredits = balanceCredits;
    this.requiredCredits = requiredCredits;
  }
}

function requireSession(actor: Actor): void {
  requireUser(actor, CreditError);
}

export function createCreditsService(deps: { store: CreditAccountStore }) {
  const { store } = deps;

  return {
    /** Saldo de la cuenta del actor (la crea con saldo 0 si es la primera vez que se consulta). */
    async getBalance(actor: Actor): Promise<bigint> {
      requireSession(actor);
      const account = await store.ensureAccountForActor(actor);
      return account.balanceCredits;
    },

    /** `true` si la cuenta del actor puede pagar `amountCredits` ahora mismo. */
    async hasSufficientBalance(actor: Actor, amountCredits: bigint): Promise<boolean> {
      requireSession(actor);
      const account = await store.ensureAccountForActor(actor);
      return account.balanceCredits >= amountCredits;
    },

    /**
     * Consume créditos de la cuenta del actor. Atómico: si el saldo no llega,
     * no se escribe ni el movimiento ni el nuevo saldo (el `CHECK` aborta la
     * transacción entera) y se lanza `InsufficientCreditsError`.
     */
    async consume(
      actor: Actor,
      amountCredits: bigint,
      opts: { referenceType: string; referenceId: string; metadata?: Record<string, unknown> },
    ): Promise<{ accountId: string; balanceAfter: bigint }> {
      requireSession(actor);
      if (amountCredits <= 0n) {
        throw new CreditError("INSUFFICIENT_CREDITS", "El importe a consumir debe ser positivo");
      }
      const account = await store.ensureAccountForActor(actor);
      if (account.balanceCredits < amountCredits) {
        throw new InsufficientCreditsError(account.balanceCredits, amountCredits);
      }
      const balanceAfter = await store.applyMovement({
        accountId: account.id,
        type: "consumption",
        amountCredits: -amountCredits,
        referenceType: opts.referenceType,
        referenceId: opts.referenceId,
        metadata: opts.metadata,
        createdBy: actor.userId,
      });
      return { accountId: account.id, balanceAfter };
    },

    /** Reembolso (p. ej. una generación fallida tras haberse cobrado por error). */
    async refund(
      actor: Actor,
      amountCredits: bigint,
      opts: { referenceType: string; referenceId: string; metadata?: Record<string, unknown> },
    ): Promise<{ accountId: string; balanceAfter: bigint }> {
      requireSession(actor);
      const account = await store.ensureAccountForActor(actor);
      const balanceAfter = await store.applyMovement({
        accountId: account.id,
        type: "refund",
        amountCredits,
        referenceType: opts.referenceType,
        referenceId: opts.referenceId,
        metadata: opts.metadata,
        createdBy: actor.userId,
      });
      return { accountId: account.id, balanceAfter };
    },
  };
}

export type CreditsService = ReturnType<typeof createCreditsService>;

/** Store en memoria (tests). */
export function createInMemoryCreditAccountStore(
  opts: { newId?: () => string } = {},
): CreditAccountStore & { accounts: Map<string, CreditAccountRow> } {
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const accounts = new Map<string, CreditAccountRow>();

  function findByOwner(actor: Actor): CreditAccountRow | undefined {
    return [...accounts.values()].find((a) =>
      actor.organizationId ? a.organizationId === actor.organizationId : a.userId === actor.userId,
    );
  }

  return {
    accounts,
    async ensureAccountForActor(actor) {
      const existing = findByOwner(actor);
      if (existing) return existing;
      const row: CreditAccountRow = {
        id: newId(),
        userId: actor.organizationId ? null : actor.userId,
        organizationId: actor.organizationId,
        balanceCredits: 0n,
      };
      accounts.set(row.id, row);
      return row;
    },
    async getAccount(accountId) {
      return accounts.get(accountId) ?? null;
    },
    async applyMovement({ accountId, amountCredits }) {
      const account = accounts.get(accountId);
      if (!account) throw new Error(`Cuenta no encontrada: ${accountId}`);
      const nextBalance = account.balanceCredits + amountCredits;
      if (nextBalance < 0n) {
        throw new InsufficientCreditsError(account.balanceCredits, -amountCredits);
      }
      account.balanceCredits = nextBalance;
      return nextBalance;
    },
  };
}
