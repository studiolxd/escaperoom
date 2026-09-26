// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  addRoomLanguage,
  findLobbyRoomId,
  readRoomIntro,
  roomPackageToDoc,
  setRoomIntro,
  setSubRoomKind,
  useRoomPackage,
} from "@escaperoom/editor";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Y from "yjs";
import es from "../../messages/es.json";
import {
  RoomLobbyIntroDialog,
  type LobbyPreviewRenderProps,
} from "../../src/components/room-editor/room-lobby-intro-dialog";
import { readReyAldricRoomPackageJson } from "../../src/lib/room-preview-fixture";

const fixture = loadRoomPackage(readReyAldricRoomPackageJson());
const VIDEO_REF = "media:3f1c1b8e-2d7a-4a57-9c1f-6f5f0b4c2a11";
const VTT_REF = "media:0b8f6a3e-54a1-4c3e-8a0e-9d2b7c1f4e22";

/** XHR mínimo: informa de progreso a mitad y termina con 200 en el siguiente tick. */
class FakeXhr {
  static requests: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
  /** Si está, el PUT no termina hasta que se resuelve (para ver la barra de progreso). */
  static hold: Promise<void> | null = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  private request = { method: "", url: "", headers: {} as Record<string, string> };
  open(method: string, url: string) {
    this.request = { method, url, headers: {} };
  }
  setRequestHeader(name: string, value: string) {
    this.request.headers[name] = value;
  }
  abort() {
    this.onabort?.();
  }
  send() {
    FakeXhr.requests.push(this.request);
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
      void (FakeXhr.hold ?? Promise.resolve()).then(() => {
        this.status = 200;
        this.onload?.();
      });
    }, 0);
  }
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url.endsWith("/intro-media/video") && init?.method === "POST") {
    return ok({ assetId: "asset-1", uploadUrl: "https://s3.test/put", headers: { "x-amz": "1" } });
  }
  if (url.endsWith("/intro-media/video/asset-1/complete")) return ok({ ref: VIDEO_REF });
  if (url.includes("/intro-media/subtitles?lang=")) return ok({ ref: VTT_REF });
  if (url.includes("/intro-media/url?ref=")) {
    const ref = new URL(url, "http://localhost").searchParams.get("ref");
    return ok({ url: `https://s3.test/get/${ref}` });
  }
  return new Response("{}", { status: 404 });
});

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  FakeXhr.requests = [];
  FakeXhr.hold = null;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({
  doc,
  onEditLobby,
  renderPreview,
  uploadsEnabled = true,
}: {
  doc: Y.Doc;
  onEditLobby: (id: string) => void;
  renderPreview?: (props: LobbyPreviewRenderProps) => null;
  uploadsEnabled?: boolean;
}) {
  const pkg = useRoomPackage(doc);
  return createElement(RoomLobbyIntroDialog, {
    roomId: "room-1",
    doc,
    pkg,
    uploadsEnabled,
    onEditLobby,
    renderPreview,
  });
}

function setup(options: { uploadsEnabled?: boolean } = {}) {
  const doc = roomPackageToDoc(fixture);
  const onEditLobby = vi.fn();
  const renderPreview = vi.fn((props: LobbyPreviewRenderProps) => {
    void props;
    return null;
  });
  render(
    createElement(
      NextIntlClientProvider,
      { locale: "es", messages: es, children: null },
      createElement(Harness, { doc, onEditLobby, renderPreview, ...options }),
    ),
  );
  return { doc, onEditLobby, renderPreview, user: userEvent.setup() };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Lobby e introducción" }));
  return screen.findByRole("dialog");
}

describe("<RoomLobbyIntroDialog> — lobby", () => {
  it("sin lobby diseñado: estado «Por defecto» y crea la sala de espera con el tamaño indicado", async () => {
    const { doc, onEditLobby, user } = setup();
    const dialog = await open(user);
    expect(within(dialog).getByText("Por defecto")).toBeInTheDocument();

    const cols = within(dialog).getByLabelText("Ancho (celdas)");
    const rows = within(dialog).getByLabelText("Alto (celdas)");
    await user.clear(cols);
    await user.type(cols, "7");
    await user.clear(rows);
    await user.type(rows, "5");
    await user.click(within(dialog).getByRole("button", { name: "Crear sala de espera" }));

    expect(findLobbyRoomId(doc)).toBe("lobby");
    expect(onEditLobby).toHaveBeenCalledWith("lobby");
  });

  it("rechaza un tamaño fuera de rango sin escribir", async () => {
    const { doc, user } = setup();
    const dialog = await open(user);
    const cols = within(dialog).getByLabelText("Ancho (celdas)");
    await user.clear(cols);
    await user.type(cols, "1");
    await user.click(within(dialog).getByRole("button", { name: "Crear sala de espera" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/entre 3 y/);
    expect(findLobbyRoomId(doc)).toBeUndefined();
  });

  it("con lobby diseñado: estado «Diseñado», editar lleva al lienzo y se puede desmarcar", async () => {
    const { doc, onEditLobby, user } = setup();
    act(() => setSubRoomKind(doc, "catacumbas", "lobby"));
    const dialog = await open(user);
    expect(within(dialog).getByText("Diseñado")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Editar en el lienzo" }));
    expect(onEditLobby).toHaveBeenCalledWith("catacumbas");

    const reopened = await open(user);
    await user.click(within(reopened).getByRole("button", { name: "Quitar tipo lobby" }));
    expect(findLobbyRoomId(doc)).toBeUndefined();
    expect(within(reopened).getByText("Por defecto")).toBeInTheDocument();
  });

  it("marca una habitación existente como sala de espera", async () => {
    const { doc, onEditLobby, user } = setup();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("combobox", { name: /habitación existente/i }));
    await user.click(
      await screen.findByRole("option", { name: "La Bodega de los Vinos Encantados" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Usar como sala de espera" }));
    expect(findLobbyRoomId(doc)).toBe("bodega");
    expect(onEditLobby).toHaveBeenCalledWith("bodega");
  });

  it("previsualiza el lobby por defecto (generado) con el renderizador del runtime", async () => {
    const { renderPreview, user } = setup();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Previsualizar lobby" }));
    expect(renderPreview).toHaveBeenCalled();
    const props = renderPreview.mock.calls.at(-1)![0];
    expect(props.roomId).toBe("lobby");
    expect(props.model.subroomsById.lobby).toBeDefined();
    // La habitación inicial sigue siendo la del fixture.
    expect(props.model.subroomsById[fixture.map.rooms[0]!.id]).toBeDefined();
  });

  it("previsualiza el lobby diseñado", async () => {
    const { doc, renderPreview, user } = setup();
    act(() => setSubRoomKind(doc, "bodega", "lobby"));
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Previsualizar lobby" }));
    expect(renderPreview.mock.calls.at(-1)![0].roomId).toBe("bodega");
  });
});

describe("<RoomLobbyIntroDialog> — introducción", () => {
  it("texto: se activa con el radio y se escribe en el campo localizado", async () => {
    const { doc, user } = setup();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: "Texto" }));
    expect(readRoomIntro(doc)).toEqual({ type: "text", text: { es: { text: "" } } });

    await user.type(within(dialog).getByRole("tabpanel"), "Bienvenidos");
    expect(readRoomIntro(doc)).toEqual({ type: "text", text: { es: { text: "Bienvenidos" } } });

    await user.click(within(dialog).getByRole("radio", { name: "Sin introducción" }));
    expect(readRoomIntro(doc)).toBeUndefined();
  });

  it("vídeo: sube con progreso por PUT presignado, lo guarda y lo previsualiza con subtítulos", async () => {
    const { doc, user } = setup();
    act(() => addRoomLanguage(doc, "en"));
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: "Vídeo" }));
    expect(within(dialog).getByText(/Aún no hay vídeo/)).toBeInTheDocument();

    const file = new File(["video"], "intro.mp4", { type: "video/mp4" });
    await user.upload(within(dialog).getByLabelText(/^Vídeo \(mp4/), file);

    await waitFor(() => expect(readRoomIntro(doc)).toEqual({ type: "video", video: VIDEO_REF }));
    expect(FakeXhr.requests).toEqual([
      { method: "PUT", url: "https://s3.test/put", headers: { "x-amz": "1" } },
    ]);
    const [, startInit] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(startInit?.body))).toEqual({
      filename: "intro.mp4",
      contentType: "video/mp4",
      byteSize: file.size,
    });

    const video = await within(dialog).findByLabelText("Vista previa del vídeo de introducción");
    expect(video).toHaveAttribute("src", `https://s3.test/get/${VIDEO_REF}`);
    expect(video).not.toHaveAttribute("autoplay");

    const vtt = new File(["WEBVTT\n"], "en.vtt", { type: "text/vtt" });
    await user.upload(within(dialog).getByLabelText("Subtítulos en inglés"), vtt);
    await waitFor(() =>
      expect(readRoomIntro(doc)).toEqual({
        type: "video",
        video: VIDEO_REF,
        subtitles: { en: VTT_REF },
      }),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("subtitles?lang=en"))).toBe(
      true,
    );
    await waitFor(() => {
      const track = within(dialog)
        .getByLabelText("Vista previa del vídeo de introducción")
        .querySelector("track");
      expect(track).toHaveAttribute("srclang", "en");
    });

    await user.click(within(dialog).getByRole("button", { name: "Quitar subtítulos en inglés" }));
    expect(readRoomIntro(doc)).toEqual({ type: "video", video: VIDEO_REF });
  });

  it("muestra la barra de progreso durante la subida", async () => {
    const { user } = setup();
    let release = () => {};
    FakeXhr.hold = new Promise((resolve) => (release = resolve));
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: "Vídeo" }));
    const file = new File(["video"], "intro.webm", { type: "video/webm" });
    await user.upload(within(dialog).getByLabelText(/^Vídeo \(mp4/), file);
    expect(
      await within(dialog).findByRole("progressbar", { name: "Progreso de la subida del vídeo" }),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText("Subiendo vídeo… 50 %")).toBeInTheDocument();
    act(() => release());
    await waitFor(() => expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument());
  });

  it("rechaza en cliente un vídeo que no es mp4/webm, sin llamar a la API", async () => {
    const { doc, user } = setup();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: "Vídeo" }));
    const input = within(dialog).getByLabelText(/^Vídeo \(mp4/);
    // `accept` filtra el selector de ficheros; se prueba el control igualmente.
    input.removeAttribute("accept");
    await user.upload(input, new File(["x"], "intro.mov", { type: "video/quicktime" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("El vídeo debe ser mp4 o webm.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readRoomIntro(doc)).toBeUndefined();
  });

  it("sin servidor (modo local) la subida está deshabilitada", async () => {
    const { user } = setup({ uploadsEnabled: false });
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: "Vídeo" }));
    expect(within(dialog).getByLabelText(/^Vídeo \(mp4/)).toBeDisabled();
    expect(within(dialog).getByText(/no está disponible en este modo/)).toBeInTheDocument();
  });

  it("refleja una introducción de vídeo ya guardada (p. ej. desde el MCP)", async () => {
    const { doc, user } = setup();
    act(() => setRoomIntro(doc, { type: "video", video: VIDEO_REF }));
    const dialog = await open(user);
    expect(within(dialog).getByRole("radio", { name: "Vídeo" })).toBeChecked();
    expect(
      await within(dialog).findByLabelText("Vista previa del vídeo de introducción"),
    ).toBeInTheDocument();
  });
});
