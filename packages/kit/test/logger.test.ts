import { beforeEach, describe, expect, it, vi } from "vitest";

const { pinoInstance, pinoFactory, pinoOptions } = vi.hoisted(() => {
  const pinoInstance = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  // Holder survives clearAllMocks — pino() runs once at module import,
  // before any test's beforeEach.
  type PinoOpts = {
    level?: string;
    formatters?: { log?: (obj: Record<string, unknown>) => Record<string, unknown> };
  };
  const pinoOptions: { current?: PinoOpts } = {};
  const pinoFactory = vi.fn((opts?: PinoOpts) => {
    pinoOptions.current = opts;
    return pinoInstance;
  });
  return { pinoInstance, pinoFactory, pinoOptions };
});

vi.mock("pino", () => ({ default: pinoFactory }));

import { logger } from "../src/logger/index";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logger", () => {
  it("configures pino with a formatters.log hook that scrubs sensitive keys at any depth (E-10)", () => {
    const scrubbed = pinoOptions.current?.formatters?.log?.({
      email: "a@b.example",
      user: { token: "abc", nested: { authorization: "Bearer x" } },
      items: [{ accessToken: "at" }, { ipAddress: "203.0.113.1" }],
      safe: "ok",
    });
    expect(scrubbed).toMatchObject({
      email: "[redacted]",
      user: { token: "[redacted]", nested: { authorization: "[redacted]" } },
      items: [{ accessToken: "[redacted]" }, { ipAddress: "[redacted]" }],
      safe: "ok",
    });
  });

  it("defaults the level to info outside development when LOG_LEVEL is unset", () => {
    expect(pinoOptions.current?.level).toBe("info");
  });

  it("writes structured logs with the original object and message", () => {
    logger.info({ userId: "u1" }, "did a thing");
    expect(pinoInstance.info).toHaveBeenCalledWith({ userId: "u1" }, "did a thing");
  });

  it("forwards warn and error at their levels", () => {
    logger.warn({ retryAfter: 30 }, "rate limited");
    logger.error({ path: "x" }, "boom");
    expect(pinoInstance.warn).toHaveBeenCalledWith({ retryAfter: 30 }, "rate limited");
    expect(pinoInstance.error).toHaveBeenCalledWith({ path: "x" }, "boom");
  });
});
