import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  CreditError,
  InsufficientCreditsError,
  createCreditsService,
  createInMemoryCreditAccountStore,
  type Actor,
} from "../src/services";

const ana: Actor = { userId: "user-ana", organizationId: null, role: "member" };
const orgMember: Actor = { userId: "user-carla", organizationId: "org-1", role: "member" };

function setup() {
  const store = createInMemoryCreditAccountStore();
  const credits = createCreditsService({ store });
  return { store, credits };
}

describe("credits", () => {
  it("crea la cuenta con saldo 0 la primera vez que se consulta", async () => {
    const { credits } = setup();
    await expect(credits.getBalance(ana)).resolves.toBe(0n);
  });

  it("rechaza a un actor anónimo", async () => {
    const { credits } = setup();
    await expect(credits.getBalance(ANONYMOUS_ACTOR)).rejects.toThrow(CreditError);
    await expect(credits.consume(ANONYMOUS_ACTOR, 1n, { referenceType: "x", referenceId: "y" })).rejects.toThrow(
      CreditError,
    );
  });

  it("consume créditos y actualiza el saldo", async () => {
    const { store, credits } = setup();
    const account = await store.ensureAccountForActor(ana);
    account.balanceCredits = 10n;

    const { balanceAfter } = await credits.consume(ana, 3n, {
      referenceType: "audio_generation",
      referenceId: "dialog-1:es",
    });

    expect(balanceAfter).toBe(7n);
    await expect(credits.getBalance(ana)).resolves.toBe(7n);
  });

  it("falla con InsufficientCreditsError si el saldo no llega, sin tocar el saldo", async () => {
    const { store, credits } = setup();
    const account = await store.ensureAccountForActor(ana);
    account.balanceCredits = 2n;

    await expect(
      credits.consume(ana, 3n, { referenceType: "audio_generation", referenceId: "dialog-1:es" }),
    ).rejects.toThrow(InsufficientCreditsError);

    await expect(credits.getBalance(ana)).resolves.toBe(2n);
  });

  it("hasSufficientBalance no cobra nada", async () => {
    const { store, credits } = setup();
    const account = await store.ensureAccountForActor(ana);
    account.balanceCredits = 5n;

    await expect(credits.hasSufficientBalance(ana, 5n)).resolves.toBe(true);
    await expect(credits.hasSufficientBalance(ana, 6n)).resolves.toBe(false);
    await expect(credits.getBalance(ana)).resolves.toBe(5n);
  });

  it("carga a la cuenta de la organización activa, no a la personal", async () => {
    const { store, credits } = setup();
    const personal = await store.ensureAccountForActor({ ...orgMember, organizationId: null });
    personal.balanceCredits = 100n;
    const org = await store.ensureAccountForActor(orgMember);
    org.balanceCredits = 4n;

    const { accountId, balanceAfter } = await credits.consume(orgMember, 4n, {
      referenceType: "audio_generation",
      referenceId: "dialog-1:es",
    });

    expect(accountId).toBe(org.id);
    expect(balanceAfter).toBe(0n);
    expect(personal.balanceCredits).toBe(100n);
  });

  it("refund suma créditos a la cuenta", async () => {
    const { store, credits } = setup();
    const account = await store.ensureAccountForActor(ana);
    account.balanceCredits = 1n;

    const { balanceAfter } = await credits.refund(ana, 5n, {
      referenceType: "audio_generation",
      referenceId: "dialog-1:es",
    });

    expect(balanceAfter).toBe(6n);
  });
});
