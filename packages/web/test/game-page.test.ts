import { Client } from "@colyseus/sdk";
import { createGameServer } from "@escaperoom/colyseus-server";
import {
  createLocalGameClient,
  createNetworkGameClient,
  type GameClient,
  type GameSnapshot,
} from "@escaperoom/game-runtime/session";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import { GameSessionShell } from "../src/components/game-session/game-session-shell";
import { deepMergeMessages, type Messages } from "../src/i18n/messages";
import { buildGameModel } from "../src/lib/game-model";
import { joinGameRoom } from "../src/lib/game-net";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";
import { freePort } from "./helpers/free-port";

// ---------------------------------------------------------------------------
// Página de partida en red (fase 2) renderizada fuera de Next: la página SSR
// (formulario de entrada, modelo sin soluciones) y el shell de juego pintado a
// partir del estado sincronizado —con el cliente local y con uno de red
// contra una `GameRoom` real—, en los 6 locales.
// ---------------------------------------------------------------------------

const MESSAGES: Record<string, Messages> = Object.fromEntries(
  Object.entries({ es, en, fr, de, nl, pt }).map(([locale, messages]) => [
    locale,
    deepMergeMessages(es, messages),
  ]),
);

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async (options: string | { locale?: string; namespace: string }) => {
    const namespace = typeof options === "string" ? options : options.namespace;
    const locale = typeof options === "string" ? "es" : (options.locale ?? "es");
    return createTranslator({
      locale,
      messages: MESSAGES[locale] ?? es,
      namespace: namespace as never,
    });
  },
}));
// El selector de idioma y el `Link` de la pantalla de resultados usan el router
// de Next, que aquí no existe.
vi.mock("@/components/i18n/locale-switcher", () => ({ LocaleSwitcher: () => null }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children?: unknown }) =>
    createElement("a", { href }, children as never),
}));

const { default: PlayPage } = await import("../src/app/[locale]/(play)/play/page");

const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
const LOCK_CODES = roomPackage.puzzles.flatMap((puzzle) =>
  puzzle.type === "code_lock" ? [puzzle.code] : [],
);

function render(element: ReactElement, locale = "es"): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: MESSAGES[locale],
      timeZone: "UTC",
      children: element,
    }),
  );
}

/** Texto traducido tal y como sale en el HTML (React escapa `'`, `&`…). */
function tr(locale: string, key: string, namespace = "Game"): string {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale]!,
    namespace: namespace as never,
  });
  return (t as (key: string) => string)(key)
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#x27;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shell(
  client: GameClient,
  locale = "es",
  status: "connected" | "disconnected" = "connected",
) {
  const { model, pack } = buildGameModel(roomPackage, locale);
  return render(
    createElement(GameSessionShell, {
      model,
      pack,
      client,
      connection: { status, onRetry: () => undefined },
      inviteUrl: "https://escape.example/es/play?room=abc",
    }),
    locale,
  );
}

describe("página /[locale]/play (SSR)", () => {
  it.each(["es", "en", "fr", "de", "nl", "pt"])(
    "renderiza el formulario de entrada traducido (%s)",
    async (locale) => {
      const element = await PlayPage({
        params: Promise.resolve({ locale }),
        searchParams: Promise.resolve({}),
      });
      const html = render(element, locale);
      expect(html).toContain('data-testid="game-join"');
      expect(html).toContain(tr(locale, "join.create"));
      expect(html).toContain(tr(locale, "join.nameLabel"));
    },
  );

  it("con ?room=<id> ofrece unirse a esa partida; un id raro se ignora", async () => {
    const join = render(
      await PlayPage({
        params: Promise.resolve({ locale: "es" }),
        searchParams: Promise.resolve({ room: "AbC123_x" }),
      }),
    );
    expect(join).toContain(tr("es", "join.join"));
    const weird = render(
      await PlayPage({
        params: Promise.resolve({ locale: "es" }),
        searchParams: Promise.resolve({ room: "../../etc" }),
      }),
    );
    expect(weird).toContain(tr("es", "join.create"));
  });

  it("el modelo que viaja al navegador no lleva códigos ni soluciones", () => {
    const serialized = JSON.stringify(buildGameModel(roomPackage, "es"));
    for (const code of LOCK_CODES) expect(serialized).not.toContain(`"${code}"`);
    for (const key of ["solution", "seed", "pairs", "recipes", "fragments", "witness"]) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });
});

describe("GameSessionShell a partir del estado sincronizado", () => {
  it("lobby: el anfitrión ve «Empezar», jugadores, conexión e invitación", () => {
    const client = createLocalGameClient(roomPackage, { tickMs: false, name: "Ana" });
    const html = shell(client);
    expect(html).toContain('data-phase="lobby"');
    expect(html).toContain('data-testid="game-start"');
    expect(html).toContain(tr("es", "lobby.start"));
    expect(html).toContain("Ana (" + tr("es", "lobby.you") + ")");
    expect(html).toContain('data-status="connected"');
    expect(html).toContain(tr("es", "lobby.invite"));
    client.dispose();
  });

  it("en juego: sala, cronómetro, inventario e indicador de desconexión con reintento", () => {
    const client = createLocalGameClient(roomPackage, { tickMs: false, name: "Ana" });
    client.startGame();
    client.interact("cuadro-aurelio");
    const html = shell(client, "en", "disconnected");
    expect(html).toContain('data-phase="playing"');
    expect(html).toContain('data-testid="game-timer"');
    expect(html).toContain("Salón del Trono");
    expect(html).toContain('data-status="disconnected"');
    expect(html).toContain(tr("en", "connection.retry"));
    // El inventario pinta el nombre del ítem del modelo, no su id.
    expect(html).toContain(buildGameModel(roomPackage, "en").model.itemsById["llave-bronce"]!.name);
    expect(html).not.toContain('data-testid="game-start"');
    client.dispose();
  });

  describe("con un cliente de red contra una GameRoom real", () => {
    let server: ReturnType<typeof createGameServer>;
    let url: string;

    beforeAll(async () => {
      const port = await freePort();
      server = createGameServer();
      await server.listen(port);
      url = `ws://localhost:${port}`;
    });

    afterAll(async () => {
      await server.gracefullyShutdown(false);
    });

    it("pinta jugadores y fase desde el room state; el invitado espera al anfitrión", async () => {
      const hostRoom = await joinGameRoom(
        new Client(url),
        { kind: "game", packageId: "room-rey-aldric" },
        "Ana",
      );
      const guestRoom = await joinGameRoom(
        new Client(url),
        { kind: "game", roomId: hostRoom.roomId },
        "Bruno",
      );
      const guest = createNetworkGameClient(guestRoom);
      await new Promise<void>((resolve) => {
        const check = (snapshot: GameSnapshot) => {
          if (snapshot.players.length === 2) {
            off();
            resolve();
          }
        };
        const off = guest.subscribe(check);
        check(guest.getSnapshot());
      });

      const html = shell(guest, "fr");
      expect(html).toContain('data-phase="lobby"');
      expect(html).toContain("Ana · " + tr("fr", "lobby.host"));
      expect(html).toContain("Bruno (" + tr("fr", "lobby.you") + ")");
      expect(html).toContain(tr("fr", "lobby.waitingHost"));
      expect(html).not.toContain('data-testid="game-start"');
      // El chat de la partida (2.1) también sale en el idioma del jugador.
      expect(html).toContain(tr("fr", "empty", "Chat"));

      guest.dispose();
      await guestRoom.leave(true);
      await hostRoom.leave(true);
    });
  });
});
