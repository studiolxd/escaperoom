// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-3 (auditoría 2026-09-24): `LiveKitRoom` publicaba mic/cámara al conectar
 * (`audio={isPlayer} video={payload.canPublishVideo}`), sin ningún gesto del
 * usuario. Debe conectar en modo "sin publicar" siempre; el jugador activa
 * mic/cámara desde `MediaTiles` (`setMicrophoneEnabled`/`setCameraEnabled`).
 */

const liveKitRoomProps = vi.fn();

vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: Record<string, unknown>) => {
    liveKitRoomProps(props);
    return null;
  },
  RoomAudioRenderer: () => null,
}));

vi.mock("../src/components/game/media-tiles", () => ({
  MediaTiles: () => null,
}));

describe("MediaOverlay — no publica mic/cámara al conectar (F-3)", () => {
  beforeEach(() => {
    liveKitRoomProps.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("audio y video siempre en false, aunque el token permita publicar vídeo", async () => {
    const { useMediaStore } = await import("../src/store/media-store");
    const { MediaOverlay } = await import("../src/components/game/media-overlay");

    useMediaStore.getState().setPayload({
      configured: true,
      token: "fake.token.value",
      url: "wss://livekit.example",
      room: "escape-room-1",
      identity: "sess-1",
      role: "player",
      allowVideo: true,
      canPublish: true,
      canPublishVideo: true,
    });

    render(<MediaOverlay />);

    expect(liveKitRoomProps).toHaveBeenCalled();
    const props = liveKitRoomProps.mock.calls.at(-1)![0] as { audio: unknown; video: unknown };
    expect(props.audio).toBe(false);
    expect(props.video).toBe(false);

    useMediaStore.getState().reset();
  });
});
