import { Prisma, type PrismaClient } from "../../generated/client";
import type { Actor } from "./actor";
import {
  InsufficientCreditsError,
  type ApplyMovementInput,
  type CreditAccountRow,
  type CreditAccountStore,
} from "./credits";

/**
 * Postgres a veces reporta el `CHECK "balanceCredits" >= 0` (migración 0004)
 * con el código genérico `23514`; a veces con el nombre autogenerado
 * `creditAccount_balanceCredits_check` en el mensaje. Se detectan ambos.
 */
function isBalanceCheckViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as { code?: unknown; message?: unknown } | undefined;
    if (meta?.code === "23514") return true;
    const message = typeof meta?.message === "string" ? meta.message : err.message;
    return message.includes("balanceCredits");
  }
  return false;
}

function toRow(row: {
  id: string;
  userId: string | null;
  organizationId: string | null;
  balanceCredits: bigint;
}): CreditAccountRow {
  return row;
}

/** Implementación Prisma del ledger sobre `creditAccount`/`creditMovement` (migración 0004). */
export function createPrismaCreditAccountStore(prisma: PrismaClient): CreditAccountStore {
  async function findByOwner(actor: Actor) {
    return actor.organizationId
      ? prisma.creditAccount.findFirst({ where: { organizationId: actor.organizationId } })
      : prisma.creditAccount.findFirst({ where: { userId: actor.userId } });
  }

  return {
    async ensureAccountForActor(actor) {
      const existing = await findByOwner(actor);
      if (existing) return toRow(existing);
      try {
        const created = await prisma.creditAccount.create({
          data: actor.organizationId
            ? { organizationId: actor.organizationId }
            : { userId: actor.userId },
        });
        return toRow(created);
      } catch (err) {
        // Carrera con otra petición concurrente creando la misma cuenta
        // (índice único parcial `uxCreditAccountUser`/`uxCreditAccountOrg`).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const retried = await findByOwner(actor);
          if (retried) return toRow(retried);
        }
        throw err;
      }
    },

    async getAccount(accountId) {
      const row = await prisma.creditAccount.findUnique({ where: { id: accountId } });
      return row ? toRow(row) : null;
    },

    async applyMovement(input: ApplyMovementInput): Promise<bigint> {
      try {
        const rows = await prisma.$queryRaw<{ applyCreditMovement: bigint }[]>`
          SELECT "applyCreditMovement"(
            ${input.accountId}::uuid,
            ${input.type}::"creditMovementType",
            ${input.amountCredits}::bigint,
            ${input.referenceType},
            ${input.referenceId},
            ${JSON.stringify(input.metadata ?? {})}::jsonb,
            ${input.createdBy}
          ) AS "applyCreditMovement"
        `;
        return rows[0]!.applyCreditMovement;
      } catch (err) {
        if (isBalanceCheckViolation(err)) {
          const account = await prisma.creditAccount.findUnique({
            where: { id: input.accountId },
          });
          const balance = account?.balanceCredits ?? 0n;
          throw new InsufficientCreditsError(balance, -input.amountCredits);
        }
        throw err;
      }
    },
  };
}
