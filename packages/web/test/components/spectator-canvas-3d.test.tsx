// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRuntimeModel } from "@escaperoom/game-runtime";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpectatorCanvas3D from "../../src/components/event-panel/spectator-canvas-3d";
import { findRepoRoot } from "../../src/lib/repo-root";

/** jsdom no tiene WebGL: el runtime 3D se sustituye por un doble. */
const runtimes = vi.hoisted(() => [] as { options: Record<string, unknown> }[]);

vi.mock("@escaperoom/game-runtime/three", () => ({
  RoomRuntime3D: class {
    options: Record<string, unknown>;
    ready = Promise.resolve();
    onObserverRoomChange = vi.fn(() => () => {});
    setObserverCamera = vi.fn();
    setPlayers = vi.fn();
    setObjectState = vi.fn();
    setBackgroundColor = vi.fn();
    destroy = vi.fn();
    constructor(_parent: HTMLElement, _model: unknown, options: Record<string, unknown>) {
      this.options = options;
      runtimes.push(this);
    }
  },
}));

const model = loadRuntimeModel(
  readFileSync(join(findRepoRoot(process.cwd()), "docs/reference/roompackage-demo-3d.v1.json"), "utf8"),
);

afterEach(() => {
  cleanup();
  runtimes.length = 0;
});

describe("<SpectatorCanvas3D>", () => {
  it("resolveCustomModelUrl sale de pack3d.customModelUrls (sin URL, undefined)", () => {
    render(
      createElement(SpectatorCanvas3D, {
        model,
        pack3d: { packId: "medieval-v1", customModelUrls: { "r2://a.glb": "https://s/a.glb" } },
        players: [],
        objects: {},
        camera: { type: "free" },
      }),
    );
    const resolve = runtimes[0]!.options.resolveCustomModelUrl as (ref: string) => string | undefined;
    expect(resolve("r2://a.glb")).toBe("https://s/a.glb");
    expect(resolve("r2://b.glb")).toBeUndefined();
  });
});
