// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { nextjsInitMock, nodeInitMock } = vi.hoisted(() => ({
  nextjsInitMock: vi.fn(),
  nodeInitMock: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ init: nextjsInitMock }));
vi.mock("@sentry/node", () => ({ init: nodeInitMock }));

import { initNextjsSentry } from "../src/observability/sentry-nextjs";
import { initNodeSentry } from "../src/observability/sentry-node";
import { createInstrumentation } from "../src/observability/instrumentation";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

describe("initNextjsSentry", () => {
  it("queda deshabilitado sin SENTRY_DSN", () => {
    vi.stubEnv("SENTRY_DSN", "");
    initNextjsSentry();
    expect(nextjsInitMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, dsn: "" }),
    );
  });

  it("se habilita con SENTRY_DSN y sube el sample rate fuera de producción", () => {
    vi.stubEnv("SENTRY_DSN", "https://example.test/1");
    vi.stubEnv("NODE_ENV", "development");
    initNextjsSentry();
    expect(nextjsInitMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, tracesSampleRate: 1, sendDefaultPii: false }),
    );
  });

  it("baja el sample rate en producción", () => {
    vi.stubEnv("SENTRY_DSN", "https://example.test/1");
    vi.stubEnv("NODE_ENV", "production");
    initNextjsSentry();
    expect(nextjsInitMock).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.2 }),
    );
  });
});

describe("initNodeSentry", () => {
  it("queda deshabilitado sin dsn", () => {
    initNodeSentry({ dsn: undefined });
    expect(nodeInitMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("se habilita con dsn y activa Sentry.logger", () => {
    initNodeSentry({ dsn: "https://example.test/1" });
    expect(nodeInitMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, enableLogs: true, sendDefaultPii: false }),
    );
  });
});

describe("createInstrumentation", () => {
  it("carga la config de servidor en runtime nodejs", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    const loadServerConfig = vi.fn().mockResolvedValue(undefined);
    const loadEdgeConfig = vi.fn().mockResolvedValue(undefined);
    const { register } = createInstrumentation({ loadServerConfig, loadEdgeConfig });
    await register();
    expect(loadServerConfig).toHaveBeenCalledOnce();
    expect(loadEdgeConfig).not.toHaveBeenCalled();
  });

  it("carga la config de edge en runtime edge", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const loadServerConfig = vi.fn().mockResolvedValue(undefined);
    const loadEdgeConfig = vi.fn().mockResolvedValue(undefined);
    const { register } = createInstrumentation({ loadServerConfig, loadEdgeConfig });
    await register();
    expect(loadEdgeConfig).toHaveBeenCalledOnce();
    expect(loadServerConfig).not.toHaveBeenCalled();
  });

  it("dispara onDevBoot en desarrollo sin bloquear el registro", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
    const loadServerConfig = vi.fn().mockResolvedValue(undefined);
    const loadEdgeConfig = vi.fn().mockResolvedValue(undefined);
    const onDevBoot = vi.fn().mockResolvedValue(undefined);
    const { register } = createInstrumentation({ loadServerConfig, loadEdgeConfig, onDevBoot });
    await register();
    expect(onDevBoot).toHaveBeenCalledOnce();
  });
});
