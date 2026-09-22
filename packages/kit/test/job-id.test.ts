// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../src/logger", () => ({ logger: mocks.logger }));

import { JOB_ID_SEPARATOR, isValidJobId, jobIdProblem, safeJobId } from "../src/queue/job-id";

/** La rama de producción registra en vez de lanzar: hay que poder verla. */
const inProduction = async (fn: () => void) => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    fn();
    await vi.waitFor(() => expect(mocks.logger.error).toHaveBeenCalled());
  } finally {
    vi.unstubAllEnvs();
  }
};

describe("jobIdProblem", () => {
  it("detecta los dos puntos, que son el separador de claves de BullMQ", () => {
    expect(jobIdProblem("drain:org_1")).toMatch(/":"/);
    expect(isValidJobId("drain:org_1")).toBe(false);
  });

  it("detecta un id entero, reservado para los ids que genera BullMQ", () => {
    expect(jobIdProblem("42")).toMatch(/entero/);
  });

  it("detecta el id vacío", () => {
    expect(jobIdProblem("")).toMatch(/vacío/);
  });

  it("da por bueno lo que BullMQ acepta", () => {
    expect(jobIdProblem("drain-org_1")).toBeNull();
    expect(isValidJobId("drain-29123456")).toBe(true);
  });
});

describe("safeJobId", () => {
  afterEach(() => vi.clearAllMocks());

  it("une las partes con el separador que BullMQ admite", () => {
    expect(JOB_ID_SEPARATOR).toBe("-");
    expect(safeJobId("drain", "org_1")).toBe("drain-org_1");
    expect(safeJobId("drain", 29_123_456)).toBe("drain-29123456");
  });

  it("revienta en desarrollo y en los tests si una parte lleva ':'", () => {
    expect(() => safeJobId("drain", "org:1")).toThrow(/jobId inválido/);
  });

  it("revienta si una parte viene vacía: el id dejaría de ser único", () => {
    expect(() => safeJobId("drain", "")).toThrow(/jobId inválido/);
  });

  it("en producción no rompe la petición: repara el id y lo registra", async () => {
    await inProduction(() => {
      const id = safeJobId("drain", "org:1");
      expect(id).toBe("drain-org-1");
      expect(isValidJobId(id)).toBe(true);
    });
  });

  it("en producción también repara un id que sería un entero", async () => {
    await inProduction(() => {
      const id = safeJobId(42);
      expect(isValidJobId(id)).toBe(true);
    });
  });
});
