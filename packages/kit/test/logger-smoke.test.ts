import { describe, expect, it, vi } from "vitest";

// Humo: la entrada real del logger (pino incluido, sin dobles) no debe lanzar
// ni al importarse ni al escribir. Es lo que garantiza que un proceso sin
// infraestructura (worker, mcp-server, tests) pueda usarlo tal cual.
import { logger } from "../src/logger/index";

describe("logger (humo, pino real)", () => {
  it("importa y escribe en todos los niveles sin lanzar", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => {
        logger.debug({ detail: true }, "verbose");
        logger.info("hello");
        logger.warn({ retryAfter: 30 }, "rate limited");
        logger.error(new Error("boom"), "something failed");
        logger.fatal({ reason: "oom" }, "dead");
      }).not.toThrow();
    } finally {
      debug.mockRestore();
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
