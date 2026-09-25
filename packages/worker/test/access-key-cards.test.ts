// @vitest-environment node
import { UnrecoverableError } from "bullmq";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  ACCESS_KEY_ALPHABET,
  AccessKeyCardsError,
  createAccessKeyCardsService,
  createInMemoryBlobStore,
  exportStorageKey,
  type AccessKeyRow,
  type CardExportJobData,
  type EventRow,
} from "@escaperoom/shared/services";
import { processAccessKeyCardsExport } from "../src/access-key-cards";

/** Renderizar 100 tarjetas es CPU: holgura para CI con turbo en paralelo. */
const HEAVY = { timeout: 60_000 };

const EVENT = "10000000-0000-4000-8000-000000000001";
const JOB = "30000000-0000-4000-8000-000000000001";

/** Claves válidas y distintas (`AAAA-BBBB-XYCD` con el alfabeto de las claves). */
function key(i: number): AccessKeyRow {
  const a = ACCESS_KEY_ALPHABET;
  return {
    code: `AAAA-BBBB-${a[i % a.length]}${a[Math.floor(i / a.length)]}CD`,
    eventId: EVENT,
    sessionId: null,
    groupId: null,
    email: null,
    keyType: "batch",
    status: "active",
    singleUse: true,
    requireConfirmation: false,
    regeneratedFrom: null,
    seats: 1,
    redeemedCount: 0,
    sentAt: null,
    confirmedAt: null,
    activatedAt: null,
    usedAt: null,
    expiresAt: null,
    createdAt: new Date("2026-06-01T10:00:00Z"),
  };
}

const keys = Array.from({ length: 100 }, (_, i) => key(i));

const event = {
  id: EVENT,
  organizerId: "autora",
  roomVersionId: "20000000-0000-4000-8000-000000000001",
  title: "Jornada",
} as EventRow;

const data: CardExportJobData = {
  eventId: EVENT,
  organizerId: "autora",
  locale: "es",
  appUrl: "https://escape.test",
  cards: keys.length,
  filter: { codes: keys.map((k) => k.code) },
};

/** Job de BullMQ mínimo que necesita `processAccessKeyCardsExport`. */
function fakeJob(overrides: Partial<CardExportJobData> = {}) {
  const updateData = vi.fn(async (next: CardExportJobData) => {
    job.data = next;
  });
  const job = { id: JOB, data: { ...data, ...overrides }, updateData };
  return job;
}

function service() {
  return createAccessKeyCardsService({
    store: {
      findEvent: async (id) => (id === EVENT ? event : null),
      findRoomMeta: async () => ({ title: "Sala", languages: ["es"], defaultLanguage: "es" }),
      listEventKeys: async (_id, { codes }) => keys.filter((k) => !codes || codes.includes(k.code)),
    },
    queue: null,
    signingSecret: null,
  });
}

describe("processAccessKeyCardsExport", () => {
  it(
    "renderiza el lote de 100 claves y sube el PDF al bucket con la clave del job",
    HEAVY,
    async () => {
      const blobs = createInMemoryBlobStore();
      const job = fakeJob();
      const result = await processAccessKeyCardsExport(service(), blobs, job);

      expect(result).toEqual({ storageKey: exportStorageKey(JOB), cards: 100 });
      const stored = blobs.objects.get(exportStorageKey(JOB))!;
      expect(stored.contentType).toBe("application/pdf");
      expect(Buffer.from(stored.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
      const pdf = await PDFDocument.load(stored.bytes);
      expect(pdf.getPageCount()).toBe(13);

      // E-8: el job terminado no conserva los códigos.
      expect(job.updateData).toHaveBeenCalledWith({ ...data, filter: { codes: null } });
      expect(job.data.filter.codes).toBeNull();
    },
  );

  it("un error de dominio no se reintenta; uno de infraestructura sí", async () => {
    const blobs = createInMemoryBlobStore();
    await expect(
      processAccessKeyCardsExport(service(), blobs, fakeJob({ organizerId: "otra" })),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const failing = {
      runExportJob: vi.fn(async () => {
        throw new Error("bucket caído");
      }),
    };
    const failingJob = fakeJob();
    const err = await processAccessKeyCardsExport(failing, blobs, failingJob).catch((e) => e);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
    expect(err).not.toBeInstanceOf(AccessKeyCardsError);
    expect((err as Error).message).toBe("bucket caído");
    // Incluso al fallar, el job no debe quedarse con los códigos.
    expect(failingJob.data.filter.codes).toBeNull();
  });
});
