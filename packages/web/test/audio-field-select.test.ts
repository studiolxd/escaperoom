// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ensureLocalizedField, initRoomLanguages, setEntryAudio } from "@escaperoom/editor";
import { AUDIO_LIBRARY, libraryAudioRef, libraryTrackTitle } from "@escaperoom/shared/audio";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import es from "../messages/es.json";
import { AudioSourceSelect, LocalizedAudioField, type AudioUploadSummary } from "../src/components/editor/audio-field";

/**
 * Radix Select monta su popover con Portal y necesita estas APIs, ausentes en
 * jsdom (specs Popper/scroll): sin ellas `userEvent.click` en el trigger no
 * abre el listbox.
 */
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function renderIntl(element: ReactElement) {
  return render(createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }));
}

const UPLOADS: AudioUploadSummary[] = [
  {
    ref: "upload:0f8fad5b-d9cb-469f-a165-70867728950e",
    originalFilename: "narrador.mp3",
    status: "pending",
    rejectionReason: null,
  },
  {
    ref: "upload:7c9e6679-7425-40de-944b-e07fc1f90ae7",
    originalFilename: "voz-famosa.mp3",
    status: "rejected",
    rejectionReason: "Voz de un tercero",
  },
];

describe("<LocalizedAudioField> — selector de audio (Select de shadcn)", () => {
  it("muestra el audio del idioma activo y marca los idiomas con audio", async () => {
    const user = userEvent.setup();
    const doc = new Y.Doc();
    initRoomLanguages(doc, ["es", "en"], "es");
    const text = ensureLocalizedField(doc, "dialogs", "intro", { es: { text: "Hola" } });
    setEntryAudio(doc, "dialogs", "intro", "es", libraryAudioRef("music-dungeon-ambience"));

    renderIntl(
      createElement(LocalizedAudioField, {
        text,
        languages: ["es", "en"],
        defaultLanguage: "es",
        label: "Audio del diálogo",
        library: AUDIO_LIBRARY,
        uploads: UPLOADS,
      }),
    );

    const esTab = screen.getByRole("tab", { name: "es" });
    expect(esTab).toHaveAttribute("data-has-audio", "true");
    expect(screen.getByRole("tab", { name: "en" })).not.toHaveAttribute("data-has-audio");

    // El valor seleccionado ya se ve en el trigger, cerrado, sin abrir el popover.
    const track = AUDIO_LIBRARY.find((t) => t.id === "music-dungeon-ambience")!;
    expect(screen.getByRole("combobox")).toHaveTextContent(libraryTrackTitle(track, "es"));
    expect(screen.getByTestId("audio-credits")).toHaveTextContent("Licencia CC0-1.0");

    await user.click(screen.getByRole("combobox"));
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Biblioteca · Música")).toBeInTheDocument();
    const rejectedOption = within(listbox).getByRole("option", {
      name: /voz-famosa\.mp3 \(rechazado\)/,
    });
    expect(rejectedOption).toHaveAttribute("aria-disabled", "true");
  });
});

describe("<AudioSourceSelect>", () => {
  it("avisa de que un audio pendiente no se puede publicar y muestra el motivo de un rechazo", () => {
    const { rerender } = renderIntl(
      createElement(AudioSourceSelect, {
        value: UPLOADS[0]!.ref,
        onChange: () => undefined,
        library: AUDIO_LIBRARY,
        uploads: UPLOADS,
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Pendiente de moderación");

    rerender(
      createElement(NextIntlClientProvider, {
        locale: "es",
        messages: es,
        children: createElement(AudioSourceSelect, {
          value: UPLOADS[1]!.ref,
          onChange: () => undefined,
          library: AUDIO_LIBRARY,
          uploads: UPLOADS,
        }),
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Rechazado en moderación: Voz de un tercero");
  });
});
