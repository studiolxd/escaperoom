import { LOCALES } from "@escaperoom/config/locales";
import {
  ANONYMOUS_ACTOR,
  CARD_LOCALES,
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
  type Actor,
  type PricingTierRow,
  type DpaGate,
} from "@escaperoom/shared/services";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { createAccessKeyCardsHandlers } from "../src/server/rest/access-key-cards";

/** DPA de la organización en regla: la puerta de 5.11 se prueba en `organizations.test.ts`. */
const DPA_SIGNED: DpaGate = { requireDpa: async () => {} };

/** Renderizar 100 tarjetas es CPU: holgura para CI con turbo en paralelo. */
const HEAVY = { timeout: 60_000 };

/**
 * PDF de tarjetas-clave (ticket 5.7, specs/13 §9) por REST: export síncrono
 * (<50), job asíncrono con URL firmada, rechazo de enlaces manipulados o
 * caducados y acceso solo del organizador. Stores, cola y bucket en memoria.
 */

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");
const APP_URL = "https://escape.test";

type ErrorJson = { error: { code: string } };
type StatusJson = {
  jobId: string;
  status: string;
  cards: number;
  downloadUrl: string | null;
  expiresAt: string | null;
};

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

async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text: text as string };
}

async function setup(players: number) {
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
  const event = await events.createEvent(author, {
    roomVersionId: VERSION,
    title: "Jornada de empresa",
    maxSimultaneousSessions: 2,
    groupingMode: "random",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: players,
  });
  const { keys } = await accessKeys.activateEvent(author, event.id);

  const queue = createInMemoryCardExportQueue({ now });
  const blobs = createInMemoryBlobStore();
  const cards = createAccessKeyCardsService({
    store: createInMemoryAccessKeyCardStore({
      events: eventStore,
      keys: keyStore,
      rooms: {
        [VERSION]: { title: "El tesoro del Rey Aldric", languages: ["es"], defaultLanguage: "es" },
      },
    }),
    queue,
    signingSecret: "secreto-de-test",
    now,
  });
  const actors: Record<string, Actor> = { autora: author, otra: other };
  const handlers = createAccessKeyCardsHandlers({
    cards,
    blobs,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
    appUrl: APP_URL,
  });
  const headers = (user?: string) => ({
    "content-type": "application/json",
    ...(user ? { "x-test-user": user } : {}),
  });

  return {
    codes: keys.map((k) => k.code),
    queue,
    runWorker: () => queue.runPending((jobId, data) => cards.runExportJob(jobId, data, blobs)),
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    exportPdf: (user?: string, body?: unknown) =>
      handlers.postExportPdf(
        new Request(`${APP_URL}/api/events/${event.id}/access-keys/export-pdf`, {
          method: "POST",
          headers: headers(user),
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: event.id }) },
      ),
    status: (jobId: string, user?: string) =>
      handlers.getExport(
        new Request(`${APP_URL}/api/exports/${jobId}`, { headers: headers(user) }),
        {
          params: Promise.resolve({ jobId }),
        },
      ),
    download: (url: string) => {
      const jobId = new URL(url).pathname.split("/")[3]!;
      return handlers.getDownload(new Request(url), { params: Promise.resolve({ jobId }) });
    },
  };
}

describe("POST /api/events/:id/access-keys/export-pdf", () => {
  it("10 claves → PDF síncrono válido con 10 tarjetas y los códigos en el texto", async () => {
    const t = await setup(10);
    const res = await t.exportPdf("autora");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename=".+\.pdf"$/);
    expect(res.headers.get("x-access-key-cards")).toBe("10");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");

    const { pages, text } = await pdfText(bytes);
    expect(pages).toBe(2);
    for (const code of t.codes) expect(text).toContain(code);
    expect(text.split("CLAVE DE ACCESO").length - 1).toBe(10);
  });

  it("no organizador → 403; sin sesión → 401; cuerpo inválido → 400/422", async () => {
    const t = await setup(10);
    expect((await t.exportPdf("otra")).status).toBe(403);
    expect(((await (await t.exportPdf("otra")).json()) as ErrorJson).error.code).toBe("FORBIDDEN");
    expect((await t.exportPdf()).status).toBe(401);
    expect((await t.exportPdf("autora", { codes: ["nada"] })).status).toBe(422);
    expect((await t.exportPdf("autora", { extra: true })).status).toBe(422);
  });
});

describe("export asíncrono (lotes de 50 o más)", () => {
  it("100 claves → job; el worker produce un PDF descargable por URL firmada", HEAVY, async () => {
    const t = await setup(100);
    const res = await t.exportPdf("autora");
    expect(res.status).toBe(202);
    const { jobId, status, cards } = (await res.json()) as {
      jobId: string;
      status: string;
      cards: number;
    };
    expect(status).toBe("queued");
    expect(cards).toBe(100);
    expect(res.headers.get("location")).toBe(`/api/exports/${jobId}`);

    const pending = (await (await t.status(jobId, "autora")).json()) as StatusJson;
    expect(pending).toMatchObject({ status: "queued", downloadUrl: null });

    await t.runWorker();
    const done = (await (await t.status(jobId, "autora")).json()) as StatusJson;
    expect(done.status).toBe("completed");
    expect(done.downloadUrl).toMatch(
      new RegExp(`^${APP_URL}/api/exports/${jobId}/download\\?expires=\\d+&signature=`),
    );
    expect(new Date(done.expiresAt!).getTime() - new Date("2026-06-01T10:00:00Z").getTime()).toBe(
      24 * 60 * 60 * 1000,
    );

    const file = await t.download(done.downloadUrl!);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const { pages, text } = await pdfText(bytes);
    expect(pages).toBe(13);
    for (const code of t.codes) expect(text).toContain(code);
  });

  it("URL manipulada → 403 y caducada → 410", HEAVY, async () => {
    const t = await setup(60);
    const { jobId } = (await (await t.exportPdf("autora")).json()) as { jobId: string };
    await t.runWorker();
    const { downloadUrl } = (await (await t.status(jobId, "autora")).json()) as StatusJson;
    const url = new URL(downloadUrl!);

    const badSig = new URL(url);
    const sig = badSig.searchParams.get("signature")!;
    badSig.searchParams.set("signature", `${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`);
    const tampered = await t.download(badSig.toString());
    expect(tampered.status).toBe(403);
    expect(((await tampered.json()) as ErrorJson).error.code).toBe("EXPORT_LINK_INVALID");

    const longer = new URL(url);
    longer.searchParams.set("expires", String(Number(url.searchParams.get("expires")) + 86_400));
    expect((await t.download(longer.toString())).status).toBe(403);

    const unsigned = new URL(url);
    unsigned.searchParams.delete("signature");
    expect((await t.download(unsigned.toString())).status).toBe(403);

    const otherJob = url.toString().replace(jobId, "30000000-0000-4000-8000-00000000abcd");
    expect((await t.download(otherJob)).status).toBe(403);

    t.advance(24 * 60 * 60 * 1000 + 1);
    const expired = await t.download(url.toString());
    expect(expired.status).toBe(410);
    expect(((await expired.json()) as ErrorJson).error.code).toBe("EXPORT_LINK_EXPIRED");
    expect(((await (await t.status(jobId, "autora")).json()) as StatusJson).status).toBe("expired");
  });

  it("el estado del job solo lo ve el organizador que lo pidió", async () => {
    const t = await setup(50);
    const { jobId } = (await (await t.exportPdf("autora")).json()) as { jobId: string };
    expect((await t.status(jobId, "otra")).status).toBe(403);
    expect((await t.status(jobId)).status).toBe(401);
    expect((await t.status("30000000-0000-4000-8000-000000000999", "autora")).status).toBe(404);
    expect((await t.status("no-es-un-id", "autora")).status).toBe(404);
  });
});

describe("idiomas de las tarjetas", () => {
  it("son los mismos 6 locales que la UI (next-intl)", () => {
    expect([...CARD_LOCALES].sort()).toEqual([...LOCALES].sort());
  });
});
