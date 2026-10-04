// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRuntimeModel, toPublicRuntimeModel } from "@escaperoom/game-runtime";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GameSessionCanvas3D from "../../src/components/game-session/game-session-canvas-3d";
import type { GameSessionCanvasHandle } from "../../src/components/game-session/game-session-canvas";
import { findRepoRoot } from "../../src/lib/repo-root";

/** jsdom no tiene WebGL: el runtime 3D se sustituye por un doble. */
const runtimes = vi.hoisted(() => [] as FakeRuntime[]);

interface FakeRuntime {
  options: Record<string, unknown>;
  ready: Promise<void>;
  placeAvatar: ReturnType<typeof vi.fn>;
  walkTo: ReturnType<typeof vi.fn>;
  setMoveVector: ReturnType<typeof vi.fn>;
  setInputEnabled: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

vi.mock("@escaperoom/game-runtime/three", () => ({
  RoomRuntime3D: class {
    options: Record<string, unknown>;
    ready = Promise.resolve();
    avatarPose = { x: 1, y: 2, h: 0, yaw: 90 };
    avatarCell = { x: 1, y: 2 };
    placeAvatar = vi.fn();
    walkTo = vi.fn(() => true);
    setMoveVector = vi.fn();
    interactHighlighted = vi.fn(() => true);
    setInputEnabled = vi.fn();
    setBackgroundColor = vi.fn();
    onWorldEvent = vi.fn(() => () => {});
    onHighlightChange = vi.fn(() => () => {});
    destroy = vi.fn();
    constructor(_parent: HTMLElement, _model: unknown, options: Record<string, unknown>) {
      this.options = options;
      runtimes.push(this as unknown as FakeRuntime);
    }
  },
}));

const model = toPublicRuntimeModel(
  loadRuntimeModel(
    readFileSync(
      join(findRepoRoot(process.cwd()), "docs/reference/roompackage-demo-3d.v1.json"),
      "utf8",
    ),
  ),
);

afterEach(() => {
  cleanup();
  runtimes.length = 0;
});

describe("<GameSessionCanvas3D>", () => {
  it("monta RoomRuntime3D y entrega el handle cuando la sala está lista", async () => {
    const onReady = vi.fn<(handle: GameSessionCanvasHandle) => void>();
    const { container, unmount } = render(
      createElement(GameSessionCanvas3D, {
        model,
        roomId: "antesala",
        pack3d: { baseUrl: "/packs/medieval-v1", packId: "medieval-v1" },
        onEvent: vi.fn(),
        onReady,
      }),
    );

    expect(container.querySelector("[data-dimension='3d']")).not.toBeNull();
    const runtime = runtimes[0]!;
    expect(runtime.options).toMatchObject({
      initialRoomId: "antesala",
      packBaseUrl: "/packs/medieval-v1",
      packId: "medieval-v1",
      inputEnabled: false,
      emitAvatarMoves: true,
    });

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const handle = onReady.mock.calls[0]![0];
    handle.placeAvatar(3, 4, 0.5, 45);
    expect(runtime.placeAvatar).toHaveBeenCalledWith(3, 4, 0.5, 45);
    expect(handle.avatarPose?.()).toEqual({ x: 1, y: 2, h: 0, yaw: 90 });
    expect(handle.walkTo?.({ x: 1, y: 1 })).toBe(true);
    handle.setMoveVector?.({ x: 0, y: 1 });
    expect(runtime.setMoveVector).toHaveBeenCalledWith({ x: 0, y: 1 });

    unmount();
    expect(runtime.destroy).toHaveBeenCalled();
  });

  it("resolveCustomModelUrl sale de pack3d.customModelUrls (sin URL, undefined)", () => {
    render(
      createElement(GameSessionCanvas3D, {
        model,
        roomId: "antesala",
        pack3d: { packId: "medieval-v1", customModelUrls: { "r2://assets/rooms/r/a.glb": "https://s/a.glb" } },
        onEvent: vi.fn(),
      }),
    );
    const resolve = runtimes[0]!.options.resolveCustomModelUrl as (ref: string) => string | undefined;
    expect(resolve("r2://assets/rooms/r/a.glb")).toBe("https://s/a.glb");
    expect(resolve("r2://assets/rooms/r/b.glb")).toBeUndefined();
  });
});
