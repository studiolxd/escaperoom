// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";

function renderIntl(element: ReactElement) {
  return render(createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }));
}

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

    renderIntl(createElement(MediaOverlay));

    expect(liveKitRoomProps).toHaveBeenCalled();
    const props = liveKitRoomProps.mock.calls.at(-1)![0] as { audio: unknown; video: unknown };
    expect(props.audio).toBe(false);
    expect(props.video).toBe(false);

    useMediaStore.getState().reset();
  });
});

describe("MediaOverlay — callbacks estables para LiveKitRoom", () => {
  beforeEach(() => {
    liveKitRoomProps.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  /**
   * `useLiveKitRoom` relanza `room.connect()` cuando cambia la identidad de
   * `onError`. Si el overlay pasaba arrows inline, un SFU caído hacía alternar
   * el estado entre "error" y "disconnected" y cada re-render volvía a
   * conectar, en bucle, hasta colgar el navegador.
   */
  it("onConnected/onDisconnected/onError no cambian al re-renderizar por el estado", async () => {
    const { useMediaStore } = await import("../src/store/media-store");
    const { MediaOverlay } = await import("../src/components/game/media-overlay");

    useMediaStore.getState().setPayload({
      configured: true,
      token: "fake.token.value",
      url: "ws://localhost:7880",
      room: "escape-room-1",
      identity: "sess-1",
      role: "player",
      allowVideo: true,
      canPublish: true,
      canPublishVideo: true,
    });

    renderIntl(createElement(MediaOverlay));
    type Callbacks = { onConnected: unknown; onDisconnected: unknown; onError: unknown };
    const first = liveKitRoomProps.mock.calls.at(-1)![0] as Callbacks;

    act(() => useMediaStore.getState().setError("could not establish signal connection"));
    act(() => useMediaStore.getState().setStatus("disconnected"));

    expect(liveKitRoomProps.mock.calls.length).toBeGreaterThan(1);
    const last = liveKitRoomProps.mock.calls.at(-1)![0] as Callbacks;
    expect(last.onError).toBe(first.onError);
    expect(last.onConnected).toBe(first.onConnected);
    expect(last.onDisconnected).toBe(first.onDisconnected);

    useMediaStore.getState().reset();
  });
});
