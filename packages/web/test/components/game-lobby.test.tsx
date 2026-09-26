// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { loadRuntimeModel, toPublicRuntimeModel } from "@escaperoom/game-runtime";
import type {
  GameClient,
  GamePlayerSnapshot,
  GameSnapshot,
} from "@escaperoom/game-runtime/session";
import { withLobbyRoom } from "@escaperoom/shared/schemas";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { LobbyPanel } from "../../src/components/game-session/components/lobby-panel";
import { GameSessionShell } from "../../src/components/game-session/game-session-shell";
import { lobbyStageOf } from "../../src/components/game-session/hooks/use-lobby-flow";
import type { IntroModel } from "../../src/lib/intro-model";
import { readReyAldricRoomPackageJson } from "../../src/lib/room-preview-fixture";

/**
 * Encargo lobby-diseño: interfaz de la sala de espera (cabecera, jugadores,
 * «Listo», anfitrión, expulsar, empezar/forzar), introducción (texto y vídeo
 * con subtítulos) y 3-2-1 sin botón de saltar que acaba en `enter_map`.
 */

vi.mock("../../src/components/game-session/game-session-canvas", () => ({
  default: () => null,
}));

const model = toPublicRuntimeModel(
  loadRuntimeModel(JSON.stringify(withLobbyRoom(JSON.parse(readReyAldricRoomPackageJson())))),
);

function player(overrides: Partial<GamePlayerSnapshot> = {}): GamePlayerSnapshot {
  return {
    id: "p1",
    name: "Ana",
    x: 5,
    y: 5,
    roomId: "lobby",
    tint: "#ffffff",
    characterId: "caballero-m",
    connected: true,
    ready: false,
    inMap: false,
    isHost: true,
    isSelf: true,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<GameSnapshot> = {}, self = player()): GameSnapshot {
  return {
    selfId: self.id,
    phase: "lobby",
    result: "",
    roomPackageId: model.meta.id,
    roomPackageVersion: "1",
    hostId: "p1",
    clock: 0,
    startedAt: 0,
    endsAt: 0,
    players: [self],
    self,
    objects: {},
    puzzles: {},
    inventory: [],
    inventories: {},
    flags: {},
    chat: [],
    ...overrides,
  };
}

function makeClient(snapshot: GameSnapshot): GameClient {
  return {
    selfId: snapshot.selfId,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    onEvent: () => () => {},
    leave: async () => {},
    startGame: vi.fn(),
    setReady: vi.fn(),
    enterMap: vi.fn(),
    kick: vi.fn(),
    move: vi.fn(),
    interact: vi.fn(),
    useItem: vi.fn(),
    combine: vi.fn(),
    openPuzzle: vi.fn(),
    closePuzzle: vi.fn(),
    attempt: vi.fn(),
    setPlate: vi.fn(),
    requestSplitView: vi.fn(),
    requestHint: vi.fn(),
    selectCharacter: vi.fn(),
    sendChat: vi.fn(),
    requestMediaToken: vi.fn(),
  };
}

function renderIntl(element: ReactElement) {
  return render(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("lobbyStageOf", () => {
  it("lobby → introducción → 3-2-1 → mapa", () => {
    const waiting = player();
    expect(lobbyStageOf("lobby", waiting, true, false)).toBe("lobby");
    expect(lobbyStageOf("starting", waiting, true, false)).toBe("intro");
    expect(lobbyStageOf("starting", waiting, true, true)).toBe("countdown");
    expect(lobbyStageOf("starting", waiting, false, false)).toBe("countdown");
    expect(lobbyStageOf("playing", player({ inMap: true }), true, false)).toBe("map");
  });

  it("quien llega tarde ve la introducción; quien reconecta en el mapa, no", () => {
    expect(lobbyStageOf("playing", player(), true, false)).toBe("intro");
    expect(lobbyStageOf("playing", player({ inMap: true }), true, false)).toBe("map");
    expect(lobbyStageOf("ended", player(), true, false)).toBe("map");
    expect(lobbyStageOf("playing", null, true, false)).toBe("map");
  });
});

describe("<LobbyPanel>", () => {
  const baseProps = {
    meta: model.meta,
    isHost: true,
    onSelectCharacter: vi.fn(),
    onToggleReady: vi.fn(),
    onStart: vi.fn(),
    onKick: vi.fn(),
    copied: false,
    onCopyInvite: vi.fn(),
  };

  it("cabecera con título, dificultad, duración y jugadores mín.–máx.", () => {
    renderIntl(createElement(LobbyPanel, { ...baseProps, players: [player()], self: player() }));
    expect(screen.getByText(model.meta.title)).toBeInTheDocument();
    expect(screen.getByText("Dificultad media")).toBeInTheDocument();
    expect(screen.getByTestId("lobby-duration")).toHaveTextContent("60 min");
    expect(screen.getByText("1–4 jugadores")).toBeInTheDocument();
  });

  it("sala sin duración: «Sin límite de tiempo»", () => {
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        meta: { ...model.meta, timeLimitMinutes: null },
        players: [player()],
        self: player(),
      }),
    );
    expect(screen.getByTestId("lobby-duration")).toHaveTextContent("Sin límite de tiempo");
  });

  it("lista de jugadores con «Listo», anfitrión y expulsar (con confirmación)", async () => {
    const user = userEvent.setup();
    const onKick = vi.fn();
    const bruno = player({ id: "p2", name: "Bruno", isHost: false, isSelf: false, ready: true });
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        onKick,
        players: [player(), bruno],
        self: player(),
      }),
    );
    expect(screen.getByTestId("lobby-player-p1")).toHaveTextContent("Ana (tú) · anfitrión");
    expect(screen.getByTestId("lobby-ready-p2")).toBeInTheDocument();
    expect(screen.queryByTestId("lobby-ready-p1")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("game-kick-p2"));
    expect(onKick).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("game-kick-confirm-p2"));
    expect(onKick).toHaveBeenCalledWith("p2");
  });

  it("«Listo» y «Empezar igualmente» con confirmación si faltan «Listo»", async () => {
    const user = userEvent.setup();
    const onToggleReady = vi.fn();
    const onStart = vi.fn();
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        onToggleReady,
        onStart,
        players: [player()],
        self: player(),
      }),
    );
    await user.click(screen.getByTestId("lobby-ready"));
    expect(onToggleReady).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("game-start")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("lobby-start-force"));
    await user.click(screen.getByTestId("lobby-start-force-confirm"));
    expect(onStart).toHaveBeenCalledWith(true);
  });

  it("todos «Listo»: el anfitrión ve «Empezar»; un invitado espera", () => {
    const ready = player({ ready: true });
    const { unmount } = renderIntl(
      createElement(LobbyPanel, { ...baseProps, players: [ready], self: ready }),
    );
    expect(screen.getByTestId("game-start")).toBeInTheDocument();
    unmount();

    const guest = player({ id: "p2", isHost: false });
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        isHost: false,
        players: [player({ isSelf: false }), guest],
        self: guest,
      }),
    );
    expect(screen.queryByTestId("game-start")).not.toBeInTheDocument();
    expect(screen.getByText("Esperando a que el anfitrión empiece…")).toBeInTheDocument();
  });

  it("por debajo del mínimo no se ofrece empezar", () => {
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        meta: { ...model.meta, players: { min: 2, max: 4 } },
        players: [player({ ready: true })],
        self: player({ ready: true }),
      }),
    );
    expect(screen.getByTestId("lobby-below-minimum")).toBeInTheDocument();
    expect(screen.queryByTestId("game-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lobby-start-force")).not.toBeInTheDocument();
  });
});

describe("<GameSessionShell> — lobby, introducción y 3-2-1", () => {
  const textIntro: IntroModel = { kind: "text", text: "Érase una vez el rey Aldric…" };

  it("en el lobby pinta la sala de espera y oculta objetos e inventario", () => {
    const client = makeClient(makeSnapshot());
    renderIntl(createElement(GameSessionShell, { model, client, intro: textIntro }));
    expect(screen.getByTestId("game-session")).toHaveAttribute("data-stage", "lobby");
    expect(screen.getByTestId("game-lobby")).toBeInTheDocument();
    expect(screen.queryByTestId("game-open-inventory")).not.toBeInTheDocument();
    expect(screen.queryByTestId("game-intro")).not.toBeInTheDocument();
  });

  it("tras «Empezar»: introducción de texto, «Continuar», 3-2-1 sin saltar y enter_map", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = makeClient(makeSnapshot({ phase: "starting" }));
    renderIntl(createElement(GameSessionShell, { model, client, intro: textIntro }));

    expect(screen.getByTestId("game-intro-text")).toHaveTextContent("Érase una vez el rey Aldric…");
    await user.click(screen.getByTestId("game-intro-continue"));

    expect(screen.getByTestId("game-countdown-value")).toHaveTextContent("3");
    // Sin botón de saltar.
    expect(screen.getByTestId("game-countdown").querySelector("button")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("game-countdown-value")).toHaveTextContent("2");
    expect(client.enterMap).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(client.enterMap).toHaveBeenCalledTimes(1);
  });

  it("sin introducción: directo al 3-2-1", () => {
    const client = makeClient(makeSnapshot({ phase: "starting" }));
    renderIntl(createElement(GameSessionShell, { model, client, intro: null }));
    expect(screen.queryByTestId("game-intro")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-countdown")).toBeInTheDocument();
  });

  it("vídeo con subtítulos: controles, sin autoplay y pista por idioma", () => {
    const client = makeClient(makeSnapshot({ phase: "starting" }));
    const intro: IntroModel = {
      kind: "video",
      videoUrl: "https://bucket.example/intro.mp4",
      subtitles: [
        { lang: "es", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nHola" },
        { lang: "en", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello" },
      ],
    };
    renderIntl(createElement(GameSessionShell, { model, client, intro }));
    const video = screen.getByTestId("game-intro-video") as HTMLVideoElement;
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("src", "https://bucket.example/intro.mp4");
    const tracks = video.querySelectorAll("track");
    expect([...tracks].map((track) => track.getAttribute("srclang"))).toEqual(["es", "en"]);
    expect(tracks[0]).toHaveAttribute("kind", "subtitles");
  });

  it("reconexión a mitad de partida (ya en el mapa): ni lobby ni introducción", () => {
    const inMap = player({ inMap: true, roomId: "salon-trono" });
    const client = makeClient(makeSnapshot({ phase: "playing" }, inMap));
    renderIntl(createElement(GameSessionShell, { model, client, intro: textIntro }));
    expect(screen.getByTestId("game-session")).toHaveAttribute("data-stage", "map");
    expect(screen.queryByTestId("game-intro")).not.toBeInTheDocument();
    expect(screen.queryByTestId("game-lobby")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-open-inventory")).toBeInTheDocument();
  });
});
