import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  CHARACTERS_PER_CREDIT,
  calculateAudioGenerationCost,
  createAudioGenerationService,
  createFakeElevenLabsClient,
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  createInMemoryCreditAccountStore,
  createCreditsService,
  type Actor,
} from "../src/services";

const ana: Actor = { userId: "user-ana", organizationId: null, role: "member" };

let seq = 0;
function setup(opts: { elevenlabsFails?: boolean; balance?: bigint } = {}) {
  const creditStore = createInMemoryCreditAccountStore();
  const credits = createCreditsService({ store: creditStore });
  const audioStore = createInMemoryAudioAssetStore();
  const blobs = createInMemoryAudioBlobStore();
  const elevenlabs = createFakeElevenLabsClient({
    fail: opts.elevenlabsFails ? () => true : undefined,
  });
  const service = createAudioGenerationService({
    elevenlabs,
    credits,
    store: audioStore,
    blobs,
    config: { voiceId: "voice-default" },
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  });
  return { creditStore, credits, audioStore, blobs, elevenlabs, service };
}

async function grant(creditStore: ReturnType<typeof createInMemoryCreditAccountStore>, actor: Actor, amount: bigint) {
  const account = await creditStore.ensureAccountForActor(actor);
  account.balanceCredits = amount;
}

describe("calculateAudioGenerationCost", () => {
  it("redondea hacia arriba con un mínimo de 1 crédito", () => {
    expect(calculateAudioGenerationCost(1)).toBe(1);
    expect(calculateAudioGenerationCost(CHARACTERS_PER_CREDIT)).toBe(1);
    expect(calculateAudioGenerationCost(CHARACTERS_PER_CREDIT + 1)).toBe(2);
    expect(calculateAudioGenerationCost(CHARACTERS_PER_CREDIT * 3)).toBe(3);
  });

  it("lanza si el texto está vacío", () => {
    expect(() => calculateAudioGenerationCost(0)).toThrow(RangeError);
  });
});

describe("audio-generation: preview", () => {
  it("sintetiza y devuelve bytes sin cobrar ni almacenar", async () => {
    const { creditStore, service, elevenlabs, audioStore } = setup();
    await grant(creditStore, ana, 10n);

    const result = await service.preview(ana, { text: "Hola creador" });

    expect(result.costCredits).toBe(1);
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(elevenlabs.calls).toHaveLength(1);
    await expect(creditStore.ensureAccountForActor(ana)).resolves.toMatchObject({
      balanceCredits: 10n,
    });
    await expect(audioStore.listByOwner(ana.userId)).resolves.toHaveLength(0);
  });

  it("falla con INSUFFICIENT_CREDITS sin llamar a ElevenLabs si no hay saldo", async () => {
    const { creditStore, service, elevenlabs } = setup();
    await grant(creditStore, ana, 0n);

    await expect(service.preview(ana, { text: "x".repeat(CHARACTERS_PER_CREDIT + 1) })).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
    });
    expect(elevenlabs.calls).toHaveLength(0);
  });

  it("rechaza a un actor anónimo", async () => {
    const { service } = setup();
    await expect(service.preview(ANONYMOUS_ACTOR, { text: "hola" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("valida el texto vacío", async () => {
    const { creditStore, service } = setup();
    await grant(creditStore, ana, 10n);
    await expect(service.preview(ana, { text: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("audio-generation: confirm", () => {
  it("cobra créditos SOLO tras generar, subir y dar de alta el audio (pending)", async () => {
    const { creditStore, service, blobs, audioStore } = setup();
    await grant(creditStore, ana, 10n);

    const result = await service.confirm(ana, { text: "Hola creador", referenceId: "dialog-1:es" });

    expect(result.costCredits).toBe(1);
    expect(result.balanceAfter).toBe(9n);
    expect(result.ref).toBe(`upload:${result.asset.id}`);
    expect(result.asset.status).toBe("pending");
    expect(result.asset.source).toBe("ai_generated");
    expect(result.asset.generationText).toBe("Hola creador");
    expect(blobs.objects.has(result.asset.storageKey)).toBe(true);
    await expect(audioStore.findAsset(result.asset.id)).resolves.not.toBeNull();
  });

  it("no cobra nada ni almacena si ElevenLabs falla", async () => {
    const { creditStore, service, blobs, audioStore } = setup({ elevenlabsFails: true });
    await grant(creditStore, ana, 10n);

    await expect(service.confirm(ana, { text: "Hola", referenceId: "dialog-1:es" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });

    await expect(creditStore.ensureAccountForActor(ana)).resolves.toMatchObject({ balanceCredits: 10n });
    expect(blobs.objects.size).toBe(0);
    await expect(audioStore.listByOwner(ana.userId)).resolves.toHaveLength(0);
  });

  it("falla con INSUFFICIENT_CREDITS si no hay saldo, sin llamar a ElevenLabs", async () => {
    const { creditStore, service, elevenlabs } = setup();
    await grant(creditStore, ana, 0n);

    await expect(
      service.confirm(ana, { text: "x".repeat(CHARACTERS_PER_CREDIT + 1), referenceId: "dialog-1:es" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    expect(elevenlabs.calls).toHaveLength(0);
  });

  it("deshace la subida si el cobro falla en el último instante (carrera de saldo)", async () => {
    const { creditStore, service, blobs, audioStore } = setup();
    const account = await creditStore.ensureAccountForActor(ana);
    account.balanceCredits = 2n;

    // Simula que otra generación concurrente agota el saldo justo antes del cobro.
    const originalConsume = creditStore.applyMovement.bind(creditStore);
    creditStore.applyMovement = async (input) => {
      account.balanceCredits = 0n;
      return originalConsume(input);
    };

    await expect(
      service.confirm(ana, { text: "x".repeat(CHARACTERS_PER_CREDIT + 1), referenceId: "dialog-1:es" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });

    expect(blobs.objects.size).toBe(0);
    await expect(audioStore.listByOwner(ana.userId)).resolves.toHaveLength(0);
  });

  it("valida el referenceId", async () => {
    const { creditStore, service } = setup();
    await grant(creditStore, ana, 10n);
    await expect(service.confirm(ana, { text: "hola", referenceId: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
