import { afterEach, describe, expect, it } from "vitest";
import {
  FIXTURE_EVENT_RUNTIME,
  configureEventRuntime,
  getEventRuntime,
} from "../src/events/runtime";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("getEventRuntime", () => {
  afterEach(() => {
    configureEventRuntime(undefined);
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("E-4: fuera de development/test, sin store configurado, no hay fixture (null)", () => {
    process.env.NODE_ENV = "production";
    expect(getEventRuntime()).toBeNull();

    // Un despliegue real que no fija NODE_ENV tampoco debe servir el fixture
    // del Rey Aldric en vez de rechazar la room.
    delete process.env.NODE_ENV;
    expect(getEventRuntime()).toBeNull();
    process.env.NODE_ENV = "staging";
    expect(getEventRuntime()).toBeNull();
  });

  it("en development/test, sin store configurado, sirve el fixture", () => {
    process.env.NODE_ENV = "development";
    expect(getEventRuntime()).toBe(FIXTURE_EVENT_RUNTIME);
    process.env.NODE_ENV = "test";
    expect(getEventRuntime()).toBe(FIXTURE_EVENT_RUNTIME);
  });

  it("un store configurado explícitamente gana siempre a NODE_ENV", () => {
    const store = { ...FIXTURE_EVENT_RUNTIME };
    configureEventRuntime(store);
    process.env.NODE_ENV = "production";
    expect(getEventRuntime()).toBe(store);
  });
});
