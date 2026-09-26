// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";
import { MediaTiles } from "../src/components/game/media-tiles";

/**
 * F-38 (auditoría 2026-09-24): el estado de mic ("🎤"/"🔇") y de "hablando"
 * (borde de color) de cada tile no tenían ningún equivalente accesible fuera
 * de un `title` (no siempre expuesto, p. ej. táctil) — deben llevar texto
 * `sr-only` sin cambiar el aspecto visible.
 */

const participant = {
  identity: "sess-1",
  name: "",
  isLocal: false,
  isMicrophoneEnabled: false,
};

vi.mock("@livekit/components-react", () => ({
  useParticipants: () => [participant],
  useTracks: () => [],
  useLocalParticipant: () => ({
    localParticipant: { setMicrophoneEnabled: vi.fn(), setCameraEnabled: vi.fn() },
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
  }),
  useIsSpeaking: () => true,
  VideoTrack: () => null,
}));

function renderIntl(element: ReactElement) {
  return render(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

afterEach(() => cleanup());

describe("<MediaTiles> — F-38", () => {
  it("expone el mic apagado y el estado de hablando con texto accesible, no solo color/emoji", () => {
    renderIntl(createElement(MediaTiles, { role: "player", canPublishVideo: true }));

    expect(screen.getByText("micrófono apagado", { selector: ".sr-only" })).toBeInTheDocument();
    expect(screen.getByText("hablando", { selector: ".sr-only" })).toBeInTheDocument();
  });
});
