import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  CARD_LOCALES,
  CARD_MESSAGES,
  CARDS_PER_PAGE,
  createAccessKeyCardsService,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyCardStore,
  createInMemoryAccessKeyStore,
  createInMemoryBlobStore,
  createInMemoryCardExportQueue,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  exportStorageKey,
  readExportSigningSecret,
  renderAccessKeyCardsPdf,
  resolveCardLocale,
  signExportDownload,
  SYNC_EXPORT_LIMIT,
  verifyExportDownload,
  type Actor,
  type PricingTierRow,
  type DpaGate,
} from "../src/services";

/** DPA de la organización en regla: la puerta de 5.11 se prueba en `organizations.test.ts`. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };

/** Renderizar 100 tarjetas es CPU: holgura para CI con turbo en paralelo. */
const HEAVY = { timeout: 60_000 };

/**
 * PDF de tarjetas-clave (ticket 5.7): maquetación con pdf-lib + QR, export
 * síncrono por debajo de 50 tarjetas, job asíncrono por encima y URL de
 * descarga firmada. Stores, cola y bucket en memoria.
 */

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const T0 = new Date("2026-01-01T00:00:00Z");
const VERSION = "10000000-0000-4000-8000-000000000001";
const SECRET = "secreto-de-test";
const APP_URL = "https://escape.test";

const tier: PricingTierRow = {
  id: "00000000-0000-4000-8000-000000000001",
  minPlayers: 1,
  maxPlayers: null,
  priceCentsPerPlayer: 100,
  currency: "EUR",
  activeFrom: T0,
  activeUntil: null,
  createdBy: "seed-admin",
  createdAt: T0,
};

/** Texto extraíble por página (pdf.js). */
async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string[] }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { pages: totalPages, text: text as string[] };
}

async function setup(opts: { players?: number; defaultLanguage?: string } = {}) {
  let clock = new Date("2026-06-01T10:00:00Z");
  const now = () => clock;
  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({ adminIds: [], tiers: [tier] }),
    now,
  });
  const eventStore = createInMemoryEventStore({
    roomVersions: [
      {
        roomVersionId: VERSION,
        roomId: "20000000-0000-4000-8000-000000000001",
        authorId: author.userId,
        roomStatus: "published",
        saleEvents: true,
      },
    ],
  });
  const events = createEventService({
    store: eventStore,
    pricing,
    payments: createFakePaymentGateway(),
    now,
  });
  const keyStore = createInMemoryAccessKeyStore({ events: eventStore });
  const accessKeys = createAccessKeyService({ store: keyStore, events, dpa: DPA_SIGNED, now });
  const players = opts.players ?? 10;
  const event = await events.createEvent(author, {
    roomVersionId: VERSION,
    title: "Jornada de Física 3.º B",
    maxSimultaneousSessions: 2,
    groupingMode: "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: players,
  });
  const activation = await accessKeys.activateEvent(author, event.id);
  const queue = createInMemoryCardExportQueue({ now });
  const blobs = createInMemoryBlobStore();
  const cardStore = createInMemoryAccessKeyCardStore({
    events: eventStore,
    keys: keyStore,
    rooms: {
      [VERSION]: {
        title: "El tesoro del Rey Aldric",
        languages: ["es", "en", "fr"],
        defaultLanguage: opts.defaultLanguage ?? "es",
      },
    },
  });
  const cards = createAccessKeyCardsService({
    store: cardStore,
    queue,
    signingSecret: SECRET,
    now,
    newJobId: () => "30000000-0000-4000-8000-000000000001",
  });
  return {
    event,
    codes: activation.keys.map((k) => k.code),
    keyStore,
    cardStore,
    cards,
    queue,
    blobs,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe("renderAccessKeyCardsPdf", () => {
  it("genera un PDF con una tarjeta por clave, 8 por página, y los códigos en el texto", async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `ABCD-EFGH-${String(2000 + i)}`);
    const bytes = await renderAccessKeyCardsPdf({
      eventTitle: "Jornada",
      roomTitle: "Sala",
      locale: "es",
      redeemPageUrl: "escape.test/es/redeem",
      createdAt: T0,
      cards: codes.map((code) => ({
        code,
        redeemUrl: `https://escape.test/es/redeem?code=${code}`,
        seats: 1,
        expiresAt: null,
      })),
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const { pages, text } = await pdfText(bytes);
    expect(pages).toBe(Math.ceil(10 / CARDS_PER_PAGE));
    const all = text.join("\n");
    for (const code of codes) expect(all).toContain(code);
    expect(all.split(CARD_MESSAGES.es.keyLabel.toUpperCase()).length - 1).toBe(10);
  });

  it("degrada caracteres fuera de WinAnsi sin romper y conserva los acentos de los 6 idiomas", async () => {
    const bytes = await renderAccessKeyCardsPdf({
      eventTitle: "Łódź 🎉 — Café",
      roomTitle: "Straße ção",
      locale: "de",
      redeemPageUrl: "escape.test/de/redeem",
      createdAt: T0,
      cards: [
        {
          code: "ABCD-EFGH-JKMN",
          redeemUrl: "https://escape.test/de/redeem?code=ABCD-EFGH-JKMN",
          seats: 5,
          expiresAt: new Date("2026-06-02T18:00:00Z"),
        },
      ],
    });
    const all = (await pdfText(bytes)).text.join("\n");
    expect(all).toContain("Café");
    expect(all).toContain("Straße ção");
    expect(all).toContain("Gültig für 5 Personen");
    expect(all).toContain("ABCD-EFGH-JKMN");
  });

  it("los textos de la tarjeta existen en los 6 locales con sus marcadores", () => {
    for (const locale of CARD_LOCALES) {
      const m = CARD_MESSAGES[locale];
      expect(m.instructions).toContain("{url}");
      expect(m.seats).toContain("{n}");
      expect(m.expires).toContain("{date}");
      expect(m.documentTitle).toContain("{title}");
      expect(m.keyLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("export de tarjetas", () => {
  it("10 claves → PDF síncrono en el idioma del evento con QR/URL de canje", async () => {
    const t = await setup({ players: 10, defaultLanguage: "en" });
    const result = await t.cards.exportCards(author, t.event.id, {}, { appUrl: APP_URL });
    expect(result.kind).toBe("pdf");
    if (result.kind !== "pdf") return;
    expect(result.cards).toBe(10);
    const { pages, text } = await pdfText(result.bytes);
    expect(pages).toBe(2);
    const all = text.join("\n");
    for (const code of t.codes) expect(all).toContain(code);
    expect(all).toContain("Jornada de Física 3.º B");
    expect(all).toContain("El tesoro del Rey Aldric");
    expect(all).toContain("escape.test/en/redeem");
    expect(all).toContain("ACCESS KEY");
  });

  it("sin `codes` omite las claves muertas; con `codes` imprime esas en su orden", async () => {
    const t = await setup({ players: 5 });
    // Mismo `createdAt` (una transacción): el orden cae en el código.
    const dead = t.keyStore.keys[0]!;
    dead.status = "used";
    const live = await t.cards.prepareSheet(author, t.event.id, {});
    expect(live.keys.map((k) => k.code)).toEqual(t.codes.filter((c) => c !== dead.code).sort());

    const picked = [t.codes[3]!, t.codes[0]!.toLowerCase().replaceAll("-", "")];
    const sheet = await t.cards.prepareSheet(author, t.event.id, { codes: picked, locale: "fr" });
    expect(sheet.keys.map((k) => k.code)).toEqual([t.codes[3], t.codes[0]]);
    expect(sheet.locale).toBe("fr");
  });

  it("rechaza claves de otro evento, formatos inválidos y eventos sin claves", async () => {
    const t = await setup({ players: 3 });
    await expect(
      t.cards.prepareSheet(author, t.event.id, { codes: ["ZZZZ-ZZZZ-ZZZZ"] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      t.cards.prepareSheet(author, t.event.id, { codes: ["no-es-clave"] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    for (const k of t.keyStore.keys) k.status = "expired";
    await expect(t.cards.prepareSheet(author, t.event.id, {})).rejects.toMatchObject({
      code: "NO_PRINTABLE_KEYS",
    });
  });

  it("solo el organizador: otro usuario → FORBIDDEN, sin sesión → UNAUTHORIZED", async () => {
    const t = await setup();
    await expect(
      t.cards.exportCards(other, t.event.id, {}, { appUrl: APP_URL }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      t.cards.exportCards(ANONYMOUS_ACTOR, t.event.id, {}, { appUrl: APP_URL }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it(
    "100 claves → job; el worker sube el PDF y el estado da una URL firmada de 24 h",
    HEAVY,
    async () => {
      const t = await setup({ players: 100 });
      const result = await t.cards.exportCards(author, t.event.id, {}, { appUrl: APP_URL });
      expect(result).toMatchObject({ kind: "job", cards: 100 });
      if (result.kind !== "job") return;

      const queued = await t.cards.getExport(author, result.jobId, { appUrl: APP_URL });
      expect(queued).toMatchObject({ status: "queued", cards: 100, downloadUrl: null });
      await expect(
        t.cards.getExport(other, result.jobId, { appUrl: APP_URL }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await t.queue.runPending((jobId, data) => t.cards.runExportJob(jobId, data, t.blobs));
      const done = await t.cards.getExport(author, result.jobId, { appUrl: APP_URL });
      expect(done.status).toBe("completed");
      const url = new URL(done.downloadUrl!);
      expect(url.pathname).toBe(`/api/exports/${result.jobId}/download`);

      const key = t.cards.verifyDownload(
        result.jobId,
        url.searchParams.get("expires"),
        url.searchParams.get("signature"),
      );
      expect(key).toBe(exportStorageKey(result.jobId));
      const pdf = await t.blobs.get(key);
      const { pages, text } = await pdfText(pdf!);
      expect(pages).toBe(Math.ceil(100 / CARDS_PER_PAGE));
      for (const code of t.codes) expect(text.join("\n")).toContain(code);

      // A las 24 h el enlace caduca y el estado pasa a `expired`.
      t.advance(24 * 60 * 60 * 1000);
      expect(() =>
        t.cards.verifyDownload(
          result.jobId,
          url.searchParams.get("expires"),
          url.searchParams.get("signature"),
        ),
      ).toThrow(expect.objectContaining({ code: "EXPORT_LINK_EXPIRED" }));
      expect((await t.cards.getExport(author, result.jobId, { appUrl: APP_URL })).status).toBe(
        "expired",
      );
    },
  );

  it(`sin cola, ${SYNC_EXPORT_LIMIT} tarjetas o más → EXPORT_UNAVAILABLE`, async () => {
    const t = await setup({ players: SYNC_EXPORT_LIMIT });
    const noQueue = createAccessKeyCardsService({
      store: t.cardStore,
      queue: null,
      signingSecret: SECRET,
    });
    await expect(
      noQueue.exportCards(author, t.event.id, {}, { appUrl: APP_URL }),
    ).rejects.toMatchObject({ code: "EXPORT_UNAVAILABLE" });
    await expect(
      t.cards.exportCards(author, t.event.id, {}, { appUrl: APP_URL }),
    ).resolves.toMatchObject({ kind: "job", cards: SYNC_EXPORT_LIMIT });
  });
});

describe("firma de la URL de descarga", () => {
  const JOB = "30000000-0000-4000-8000-000000000001";
  const exp = Math.floor(new Date("2026-06-02T10:00:00Z").getTime() / 1000);
  const now = new Date("2026-06-01T10:00:00Z").getTime();

  it("acepta la firma buena y rechaza la manipulada, la de otro job y la caducada", () => {
    const sig = signExportDownload(SECRET, JOB, exp);
    expect(verifyExportDownload(SECRET, JOB, String(exp), sig, now)).toEqual({ ok: true });
    const tampered = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyExportDownload(SECRET, JOB, String(exp), tampered, now)).toMatchObject({
      error: "BAD_SIGNATURE",
    });
    expect(verifyExportDownload(SECRET, JOB, String(exp + 3600), sig, now)).toMatchObject({
      error: "BAD_SIGNATURE",
    });
    expect(
      verifyExportDownload(SECRET, "30000000-0000-4000-8000-000000000002", String(exp), sig, now),
    ).toMatchObject({ error: "BAD_SIGNATURE" });
    expect(verifyExportDownload("otro-secreto", JOB, String(exp), sig, now)).toMatchObject({
      error: "BAD_SIGNATURE",
    });
    expect(verifyExportDownload(SECRET, JOB, String(exp), sig, exp * 1000)).toMatchObject({
      error: "EXPIRED",
    });
    expect(verifyExportDownload(SECRET, JOB, "1e9", sig, now)).toMatchObject({
      error: "MALFORMED",
    });
    expect(verifyExportDownload(SECRET, JOB, null, sig, now)).toMatchObject({ error: "MALFORMED" });
  });

  it("el secreto sale de APP_SECRET; en producción sin él no hay export asíncrono", () => {
    expect(readExportSigningSecret({ APP_SECRET: "x".repeat(32) })).toBe("x".repeat(32));
    expect(readExportSigningSecret({ NODE_ENV: "production" })).toBeNull();
    expect(readExportSigningSecret({ NODE_ENV: "development" })).toBeTruthy();
  });

  it("el idioma del evento es el por defecto de la sala si es de los 6", () => {
    expect(resolveCardLocale({ title: "", languages: ["ca", "pt"], defaultLanguage: "ca" })).toBe(
      "pt",
    );
    expect(resolveCardLocale({ title: "", languages: ["ca"], defaultLanguage: "ca" })).toBe("es");
    expect(resolveCardLocale({ title: "", languages: ["nl"], defaultLanguage: "nl" }, "de")).toBe(
      "de",
    );
  });
});
