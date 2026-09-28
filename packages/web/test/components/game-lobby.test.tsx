// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { loadRuntimeModel, toPublicRuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type {
  GameClient,
  GamePlayerSnapshot,
  GameSnapshot,
} from "@escaperoom/game-runtime/session";
import { withLobbyRoom } from "@escaperoom/shared/schemas";
import { cleanup, render, screen } from "@testing-library/react";
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

/** Encargo retratos: fixture mínima con dos personajes (uno con portrait, otro sin). */
const pack = {
  baseUrl: "https://cdn.example/pack",
  manifest: {
    avatars: [
      { id: "caballero-m", label: { es: { text: "Caballero" } }, portrait: "retrato-caballero-m" },
      { id: "mago-f", label: { es: { text: "Maga" } } },
      { id: "arquero-m", label: { es: { text: "Arquero" } } },
    ],
  },
} as unknown as RoomScenePack;

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
    organizerControlsStart: false,
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
  it("lobby → introducción → entrando → mapa", () => {
    const waiting = player();
    expect(lobbyStageOf("lobby", waiting, true, false)).toBe("lobby");
    expect(lobbyStageOf("starting", waiting, true, false)).toBe("intro");
    expect(lobbyStageOf("starting", waiting, true, true)).toBe("entering");
    expect(lobbyStageOf("starting", waiting, false, false)).toBe("entering");
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
    organizerControlsStart: false,
    onSelectCharacter: vi.fn(),
    onToggleReady: vi.fn(),
    onStart: vi.fn(),
    onKick: vi.fn(),
    copied: false,
    onCopyInvite: vi.fn(),
  };

  it("cabecera con el título de la sala", () => {
    renderIntl(createElement(LobbyPanel, { ...baseProps, players: [player()], self: player() }));
    expect(screen.getByText(model.meta.title)).toBeInTheDocument();
  });

  it("X persona(s) de N según los jugadores conectados", () => {
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        players: [player()],
        self: player(),
      }),
    );
    expect(screen.getByText("1 persona de 8")).toBeInTheDocument();
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

  it("encargo retratos: selector de personaje con el pack — elegir uno llama a onSelectCharacter y quita el «Listo» quien lo hace", async () => {
    const user = userEvent.setup();
    const onSelectCharacter = vi.fn();
    const bruno = player({
      id: "p2",
      name: "Bruno",
      isHost: false,
      isSelf: false,
      characterId: "mago-f",
      tint: "#00ff00",
    });
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        pack,
        onSelectCharacter,
        players: [player(), bruno],
        self: player(),
      }),
    );
    // El propio personaje (caballero-m) muestra el propio nombre debajo.
    expect(screen.getByTestId("character-occupant-caballero-m")).toHaveTextContent("Ana");
    // El de Bruno (mago-f) está ocupado: deshabilitado y con su nombre.
    const magoOption = screen.getByTestId("character-option-mago-f");
    expect(magoOption).toBeDisabled();
    expect(magoOption).toHaveAccessibleName("Bruno ya tiene este personaje");
    expect(screen.getByTestId("character-occupant-mago-f")).toHaveTextContent("Bruno");

    await user.click(magoOption);
    expect(onSelectCharacter).not.toHaveBeenCalled();
    // Cambiar a un personaje libre sí llama al callback (el servidor decide
    // si eso quita el «Listo»; aquí solo comprobamos que la intención sale).
    await user.click(screen.getByTestId("character-option-arquero-m"));
    expect(onSelectCharacter).toHaveBeenCalledWith("arquero-m");
    // Pulsar el propio (caballero-m, ya elegido) otra vez lo libera.
    await user.click(screen.getByTestId("character-option-caballero-m"));
    expect(onSelectCharacter).toHaveBeenCalledWith("");
  });

  it("el anfitrión debe confirmarse él mismo antes de poder empezar", async () => {
    const user = userEvent.setup();
    const onToggleReady = vi.fn();
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        onToggleReady,
        players: [player()],
        self: player(),
      }),
    );
    expect(screen.getByTestId("lobby-host-not-ready")).toBeInTheDocument();
    expect(screen.queryByTestId("game-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lobby-start-force")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("lobby-ready"));
    expect(onToggleReady).toHaveBeenCalledWith(true);
  });

  it("sin personaje elegido, «¡Vamos!» está deshabilitado", async () => {
    const user = userEvent.setup();
    const onToggleReady = vi.fn();
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        onToggleReady,
        pack,
        players: [player({ characterId: "" })],
        self: player({ characterId: "" }),
      }),
    );
    const button = screen.getByTestId("lobby-ready");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onToggleReady).not.toHaveBeenCalled();
  });

  it("anfitrión sin personaje: el aviso es «Elige un personaje», no «Confirma tu participación»", () => {
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        pack,
        players: [player({ characterId: "" })],
        self: player({ characterId: "" }),
      }),
    );
    expect(screen.getByTestId("lobby-host-not-ready")).toHaveTextContent(
      es.Game.lobby.chooseCharacterFirst,
    );
  });

  it("invitado sin personaje: el aviso es «Elige un personaje», no «Esperando al anfitrión»", () => {
    const host = player({ characterId: "caballero-m" });
    const guest = player({ id: "p2", name: "Bruno", isHost: false, isSelf: true, characterId: "" });
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        isHost: false,
        pack,
        players: [host, guest],
        self: guest,
      }),
    );
    expect(screen.getByTestId("lobby-waiting-host")).toHaveTextContent(
      es.Game.lobby.chooseCharacterFirst,
    );
  });

  it("invitado con personaje pero sin confirmar: el aviso pide confirmar, no esperar al anfitrión", () => {
    const host = player({ characterId: "caballero-m" });
    const guest = player({
      id: "p2",
      name: "Bruno",
      isHost: false,
      isSelf: true,
      characterId: "mago-f",
      ready: false,
    });
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        isHost: false,
        pack,
        players: [host, guest],
        self: guest,
      }),
    );
    expect(screen.getByTestId("lobby-guest-not-ready")).toHaveTextContent(
      es.Game.lobby.hostMustConfirm,
    );
  });

  it("«Empezar sin esperar» salta la confirmación de los demás, no la del anfitrión", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const hostReady = player({ ready: true });
    const guest = player({ id: "p2", name: "Bruno", isHost: false, isSelf: false, ready: false });
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        onStart,
        players: [hostReady, guest],
        self: hostReady,
      }),
    );
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

    const guest = player({ id: "p2", isHost: false, ready: true });
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

  it('"inicio conjunto": con organizerControlsStart, el anfitrión no ve "Empezar"', () => {
    const ready = player({ ready: true });
    renderIntl(
      createElement(LobbyPanel, {
        ...baseProps,
        organizerControlsStart: true,
        players: [ready],
        self: ready,
      }),
    );
    expect(screen.queryByTestId("game-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lobby-start-force")).not.toBeInTheDocument();
    expect(screen.getByTestId("lobby-waiting-organizer")).toHaveTextContent(
      "Esperando a que el organizador inicie la partida…",
    );
  });
});

describe("<GameSessionShell> — lobby, introducción y entrada al mapa", () => {
  const textIntro: IntroModel = { kind: "text", text: "Érase una vez el rey Aldric…" };

  it("en el lobby pinta la sala de espera y oculta objetos e inventario", () => {
    const client = makeClient(makeSnapshot());
    renderIntl(createElement(GameSessionShell, { model, client, intro: textIntro }));
    expect(screen.getByTestId("game-session")).toHaveAttribute("data-stage", "lobby");
    expect(screen.getByTestId("game-lobby")).toBeInTheDocument();
    expect(screen.queryByTestId("game-open-inventory")).not.toBeInTheDocument();
    expect(screen.queryByTestId("game-intro")).not.toBeInTheDocument();
  });

  it("tras «Empezar»: introducción de texto, «Continuar» y enter_map inmediato, sin cuenta atrás", async () => {
    const user = userEvent.setup();
    const client = makeClient(makeSnapshot({ phase: "starting" }));
    renderIntl(createElement(GameSessionShell, { model, client, intro: textIntro }));

    expect(screen.getByTestId("game-intro-text")).toHaveTextContent("Érase una vez el rey Aldric…");
    expect(client.enterMap).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("game-intro-continue"));

    // Sin cuenta atrás de por medio: cerrar la introducción manda enter_map
    // ya mismo, y el fundido (mismo `EntryFade` de la introducción) se queda
    // hasta que el servidor confirme `inMap`.
    expect(client.enterMap).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("game-intro")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-entry-fade")).toBeInTheDocument();
  });

  it("sin introducción: fundido y enter_map inmediato, sin cuenta atrás", () => {
    const client = makeClient(makeSnapshot({ phase: "starting" }));
    renderIntl(createElement(GameSessionShell, { model, client, intro: null }));
    expect(screen.queryByTestId("game-intro")).not.toBeInTheDocument();
    expect(screen.getByTestId("game-entry-fade")).toBeInTheDocument();
    expect(client.enterMap).toHaveBeenCalledTimes(1);
  });

  it("texto con narración: reproductor bajo el texto que arranca solo", () => {
    const client = makeClient(makeSnapshot({ phase: "starting" }));
    const intro: IntroModel = { ...textIntro, audioUrl: "https://bucket.example/intro.mp3" };
    renderIntl(createElement(GameSessionShell, { model, client, intro }));
    const audio = screen.getByTestId("game-intro-audio") as HTMLAudioElement;
    expect(audio).toHaveAttribute("controls");
    expect(audio.autoplay).toBe(true);
    expect(audio).toHaveAttribute("src", "https://bucket.example/intro.mp3");
    const text = screen.getByTestId("game-intro-text");
    expect(text.compareDocumentPosition(audio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
