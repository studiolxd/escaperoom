import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildDefaultLobbyRoom,
  initialRoomOf,
  lobbyRoomOf,
  MAX_INTRO_TEXT_LENGTH,
  parseRoomPackage,
  safeParseRoomPackage,
  withLobbyRoom,
  type RoomPackage,
  type SubRoom,
} from "../src/schemas";
import { createRoomSession } from "../src/session";
import { validateRoomPackage, type ValidationReport } from "../src/validator";

/**
 * Sala de espera diseñable (`kind: "lobby"`) e introducción (`meta.intro`),
 * encargo lobby-diseño: helpers puros, lobby por defecto retrocompatible,
 * entrada al mapa por la habitación inicial de juego y reglas del validador.
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function clone(): RoomPackage {
  return structuredClone(reyAldric);
}

function lobby(overrides: Partial<SubRoom> = {}): SubRoom {
  return {
    id: "vestibulo",
    name: "Vestíbulo",
    kind: "lobby",
    grid: { cols: 6, rows: 5 },
    layers: [],
    decorations: [{ sprite: "barril", x: 1, y: 1 }],
    spawnPoints: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, x: n, y: 3 })),
    lighting: [],
    ...overrides,
  };
}

function structureIssues(report: ValidationReport): string[] {
  return report.checks.find((check) => check.id === "structure")!.issues.map((issue) => issue.code);
}

describe("lobby por defecto (salas sin lobby diseñado)", () => {
  it("el Rey Aldric no tiene lobby y sigue validando igual", () => {
    expect(lobbyRoomOf(reyAldric.map)).toBeUndefined();
    const report = validateRoomPackage(reyAldric);
    expect(report.checks.find((check) => check.id === "structure")!.status).toBe("ok");
  });

  it("genera uno pequeño con el suelo y los muros de la habitación inicial", () => {
    const room = buildDefaultLobbyRoom(reyAldric.map, reyAldric.meta.players.max);
    expect(room.kind).toBe("lobby");
    expect(room.id).toBe("lobby");
    expect(room.grid).toEqual({ cols: 10, rows: 8 });
    expect(room.layers.map((layer) => layer.name)).toEqual(["ground", "walls"]);
    // Suelo: todo el tile dominante del suelo del Salón del Trono (1).
    expect(room.layers[0]!.rle).toEqual(Array.from({ length: 8 }, () => [10, 1]).flat());
    // Muros: fila superior entera y columna izquierda (tile 10).
    expect(room.layers[1]!.rle.slice(0, 2)).toEqual([10, 10]);
    expect(room.layers[1]!.rle.slice(2, 6)).toEqual([1, 10, 9, 0]);
    expect(room.spawnPoints).toHaveLength(reyAldric.meta.players.max);
    for (const spawn of room.spawnPoints) {
      expect(spawn.x).toBeGreaterThanOrEqual(1);
      expect(spawn.x).toBeLessThan(10);
      expect(spawn.y).toBeLessThan(8);
    }
    expect(room.lighting.every((light) => light.type === "ambient")).toBe(true);
  });

  it("withLobbyRoom añade el lobby al final, sin tocar el paquete original", () => {
    const played = withLobbyRoom(reyAldric);
    expect(played).not.toBe(reyAldric);
    expect(reyAldric.map.rooms.some((room) => room.kind === "lobby")).toBe(false);
    expect(played.map.rooms.at(-1)?.kind).toBe("lobby");
    expect(initialRoomOf(played.map)?.id).toBe("salon-trono");
    expect(safeParseRoomPackage(played).success).toBe(true);
  });

  it("no duplica el lobby si ya hay uno diseñado", () => {
    const pkg = clone();
    pkg.map.rooms.push(lobby());
    expect(withLobbyRoom(pkg)).toBe(pkg);
  });

  it("el id generado no choca con una habitación llamada «lobby»", () => {
    const pkg = clone();
    pkg.map.rooms[1]!.id = "lobby";
    expect(buildDefaultLobbyRoom(pkg.map).id).toBe("lobby-2");
  });
});

describe("habitación inicial y RoomSession", () => {
  it("un lobby diseñado en primera posición no es la habitación inicial", () => {
    const pkg = clone();
    pkg.map.rooms.unshift(lobby());
    expect(initialRoomOf(pkg.map)?.id).toBe("salon-trono");
    const session = createRoomSession(pkg, { playerIds: ["a"] });
    session.spawnPlayer("a", 0);
    expect(session.playerPosition("a")?.roomId).toBe("salon-trono");
  });

  it("spawnPlayer puede colocar en el lobby y luego entrar al mapa", () => {
    const pkg = withLobbyRoom(clone());
    const session = createRoomSession(pkg, { playerIds: ["a"] });
    session.spawnPlayer("a", 0, "lobby");
    expect(session.playerPosition("a")?.roomId).toBe("lobby");
    session.spawnPlayer("a", 10);
    expect(session.playerPosition("a")?.roomId).toBe("salon-trono");
  });
});

describe("validador — sala de espera", () => {
  it("un lobby solo con decoración valida", () => {
    const pkg = clone();
    pkg.map.rooms.push(lobby());
    pkg.objects.push({
      id: "estatua-lobby",
      roomId: "vestibulo",
      type: "decor",
      position: { x: 2, y: 2 },
      sprite: "barril",
      states: {},
      initialState: "",
      interactable: false,
    });
    expect(structureIssues(validateRoomPackage(pkg))).toEqual([]);
  });

  it("rechaza dos lobbies y un lobby como única habitación", () => {
    const pkg = clone();
    pkg.map.rooms.push(lobby(), lobby({ id: "vestibulo-2" }));
    expect(structureIssues(validateRoomPackage(pkg))).toContain("multiple_lobby_rooms");

    const solo = clone();
    solo.map.rooms = [lobby()];
    solo.objects = [];
    solo.puzzles = [];
    solo.rules = [];
    solo.hints = [];
    expect(structureIssues(validateRoomPackage(solo))).toContain("lobby_without_game_room");
  });

  it("rechaza pruebas, puertas y objetos que den ítems en el lobby", () => {
    const pkg = clone();
    pkg.map.rooms.push(lobby());
    const puzzle = pkg.puzzles[0]!;
    puzzle.roomId = "vestibulo";
    pkg.objects.push(
      {
        id: "puerta-lobby",
        roomId: "vestibulo",
        type: "door",
        position: { x: 1, y: 1 },
        sprite: "barril",
        states: {},
        initialState: "",
        interactable: true,
        leadsTo: "salon-trono",
      },
      {
        id: "cofre-lobby",
        roomId: "vestibulo",
        type: "chest",
        position: { x: 3, y: 1 },
        sprite: "barril",
        states: {},
        initialState: "",
        interactable: true,
        inventory: [pkg.items[0]!.id],
      },
    );
    const codes = structureIssues(validateRoomPackage(pkg));
    expect(codes).toContain("lobby_has_puzzle");
    expect(codes).toContain("lobby_has_door");
    expect(codes).toContain("lobby_object_gives_items");
  });

  it("rechaza reglas que usen el lobby o sus objetos", () => {
    const pkg = clone();
    pkg.map.rooms.push(lobby());
    pkg.rules.push({
      id: "entrar-lobby",
      trigger: { type: "on_enter_room", roomId: "vestibulo" },
      conditions: [],
      actions: [{ type: "set_flag", flag: "x", value: true }],
      once: true,
      priority: 0,
    } as RoomPackage["rules"][number]);
    expect(structureIssues(validateRoomPackage(pkg))).toContain("lobby_referenced_by_rule");
  });
});

describe("validador — introducción", () => {
  it("una introducción de texto válida pasa", () => {
    const pkg = clone();
    pkg.meta.intro = { type: "text", text: { es: { text: "Érase una vez un rey…" } } };
    expect(structureIssues(validateRoomPackage(pkg))).toEqual([]);
  });

  it("rechaza texto vacío, demasiado largo o en idiomas no declarados", () => {
    const empty = clone();
    empty.meta.intro = { type: "text", text: { es: { text: "  " } } };
    expect(structureIssues(validateRoomPackage(empty))).toContain("intro_text_empty");

    const long = clone();
    long.meta.intro = {
      type: "text",
      text: { es: { text: "a".repeat(MAX_INTRO_TEXT_LENGTH + 1) } },
    };
    expect(structureIssues(validateRoomPackage(long))).toContain("intro_text_too_long");

    const foreign = clone();
    foreign.meta.intro = { type: "text", text: { es: { text: "hola" }, fr: { text: "salut" } } };
    expect(structureIssues(validateRoomPackage(foreign))).toContain("intro_language_not_declared");
  });

  it("vídeo con subtítulos en idiomas declarados pasa; en otros, no", () => {
    const pkg = clone();
    pkg.meta.intro = { type: "video", video: "media:intro", subtitles: { es: "media:subs" } };
    expect(safeParseRoomPackage(pkg).success).toBe(true);
    expect(structureIssues(validateRoomPackage(pkg))).toEqual([]);
    pkg.meta.intro.subtitles = { de: "media:subs" };
    expect(structureIssues(validateRoomPackage(pkg))).toContain("intro_language_not_declared");
  });

  it("el schema rechaza una introducción sin forma válida", () => {
    const pkg = clone() as unknown as { meta: Record<string, unknown> };
    pkg.meta.intro = { type: "audio", video: "x" };
    expect(safeParseRoomPackage(pkg).success).toBe(false);
  });
});
