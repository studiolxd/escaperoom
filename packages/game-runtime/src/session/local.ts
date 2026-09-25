import { filterChatText } from "@escaperoom/shared/chat";
import type { EngineResult } from "@escaperoom/shared/engine";
import type { PuzzleDefinition, RoomPackage } from "@escaperoom/shared/schemas";
import {
  createRoomSession,
  type RoomPuzzleActionResult,
  type RoomSession,
} from "@escaperoom/shared/session";
import { PLACEHOLDER_CHARACTER_ID } from "../pack";
import { Emitter } from "./emitter";
import { GAME_MAX_STEP_CELLS, GAME_PROTOCOL_ERRORS, MOVE_OUT_OF_BOUNDS } from "./protocol";
import { emptyGameSnapshot } from "./snapshot";
import type { GameAttempt, GameClient, GameEvent, GameSnapshot } from "./types";

/**
 * Cliente **local** (playtest sin servidor, specs/09 §3 y tests): emula en
 * proceso la `GameRoom` de `@escaperoom/colyseus-server` sobre el mismo
 * `RoomSession` de `shared`, con los mismos mensajes y desenlaces, para que la
 * UI sea idéntica en red y en local. Aquí el paquete completo vive en el
 * navegador —por eso solo se usa donde ya estaba (previsualización de
 * desarrollo) o en tests—; la partida real va siempre por red.
 */

export interface LocalGameClientOptions {
  /** Id del jugador local (por defecto `p1`). */
  playerId?: string;
  name?: string;
  tint?: string;
  characterId?: string;
  /** Límite de la partida en segundos (por defecto 3600, como la `GameRoom`). */
  timeLimitSec?: number;
  /** Idioma de los textos de pista. */
  locale?: string;
  /** Reloj de pared en ms (inyectable en tests). */
  now?: () => number;
  /** Cadencia del reloj de la partida; `false` = solo con `tick()` manual. */
  tickMs?: number | false;
}

export interface LocalGameClient extends GameClient {
  /** Avanza el reloj lógico (timers, `delay` de la victoria). */
  tick(): void;
  dispose(): void;
}

const LOCAL_TICK_MS = 250;
const DOOR_REACH = 2;

/** Desenlaces de plantilla que no son un error del jugador (igual que la `GameRoom`). */
const OK_OUTCOMES = new Set([
  "correct",
  "solved",
  "moved",
  "rotated",
  "opened",
  "flipped",
  "match",
  "mismatch",
  "turn_ended",
  "revealed",
  "activated",
  "deactivated",
]);

const ATTEMPT_ERRORS: Record<string, string> = {
  wrong: "wrong_code",
  unavailable: "not_available",
  already_solved: "already_resolved",
  already_revealed: "already_resolved",
};

export function createLocalGameClient(
  roomPackage: RoomPackage,
  options: LocalGameClientOptions = {},
): LocalGameClient {
  const selfId = options.playerId ?? "p1";
  const wallNow = options.now ?? (() => Date.now());
  const createdAt = wallNow();
  const logicalNow = () => wallNow() - createdAt;
  const session: RoomSession = createRoomSession(roomPackage, {
    playerId: selfId,
    playerIds: [selfId],
    timeLimitSec: options.timeLimitSec ?? 3600,
    now: logicalNow(),
  });
  session.spawnPlayer(selfId, logicalNow());

  const snapshots = new Emitter<GameSnapshot>();
  const events = new Emitter<GameEvent>();
  const openPanels = new Set<string>();
  const chat: GameSnapshot["chat"] = [];
  let ended = false;
  let chatId = 0;
  let characterId = options.characterId ?? PLACEHOLDER_CHARACTER_ID;
  let snapshot = buildSnapshot();

  function buildSnapshot(): GameSnapshot {
    const game = session.state;
    const position = session.playerPosition(selfId);
    const self = {
      id: selfId,
      name: options.name ?? "Jugador 1",
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      roomId: position?.roomId ?? "",
      tint: options.tint ?? "#38bdf8",
      characterId,
      connected: true,
      isHost: true,
      isSelf: true,
    };
    const flags: GameSnapshot["flags"] = {};
    for (const [flag, value] of Object.entries(game.flags)) {
      if (flag === "time_remaining") continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        flags[flag] = value;
      }
    }
    const started = Boolean(game.flags.game_started);
    return {
      ...emptyGameSnapshot(selfId),
      phase: game.phase,
      result: game.result ?? "",
      roomPackageId: roomPackage.meta.id,
      roomPackageVersion: roomPackage.meta.version,
      hostId: selfId,
      clock: logicalNow(),
      startedAt: started ? game.startedAt : 0,
      endsAt:
        started && game.timeLimitSec !== undefined ? game.startedAt + game.timeLimitSec * 1000 : 0,
      players: [self],
      self,
      objects: { ...game.objectStates },
      puzzles: Object.fromEntries(
        Object.entries(game.puzzleStates).map(([id, runtime]) => [
          id,
          { state: runtime.state, attempts: runtime.attempts, solvedBy: runtime.solvedBy ?? "" },
        ]),
      ),
      inventory: [...(game.inventory[selfId] ?? [])],
      inventories: Object.fromEntries(
        Object.entries(game.inventory).map(([id, items]) => [id, [...items]]),
      ),
      flags,
      chat: [...chat],
    };
  }

  const emit = (event: GameEvent) => events.emit(event);
  const fail = (code: string, message: string) => emit({ type: "error", code, message });
  const sync = () => {
    snapshot = buildSnapshot();
    snapshots.emit(snapshot);
  };

  /** Difunde los efectos del motor como la `GameRoom` y refresca paneles/estado. */
  function publish(result: EngineResult | null | undefined): void {
    if (result) {
      for (const effect of result.effects) {
        if (effect.type === "show_dialog") emit({ type: "dialog_show", dialogId: effect.dialogId });
        else if (effect.type === "set_object_state")
          emit({ type: "object_state_changed", objectId: effect.objectId, state: effect.state });
        else if (effect.type === "unlock_door")
          emit({ type: "object_state_changed", objectId: effect.objectId, state: "open" });
        else if (effect.type === "grant_item")
          emit({ type: "item_granted", playerId: effect.playerId, itemId: effect.itemId });
      }
      for (const event of result.events) {
        if (event.type !== "on_puzzle_solved") continue;
        const def = roomPackage.puzzles.find((puzzle) => puzzle.id === event.puzzleId);
        emit({
          type: "puzzle_solved",
          puzzleId: event.puzzleId,
          solvedBy: event.playerId ?? null,
          grantsItems: def?.grantsItems ?? [],
          unlocks: def?.unlocks ?? [],
        });
      }
    }
    sync();
    for (const puzzleId of openPanels) {
      emit({ type: "puzzle_view", puzzleId, view: session.puzzleView(puzzleId, selfId) });
    }
    if (!ended && session.ended) {
      ended = true;
      emit({
        type: "game_ended",
        result: session.state.result ?? "",
        stats: session.summary(logicalNow())?.stats ?? null,
      });
    }
  }

  function playing(): boolean {
    if (session.state.phase !== "playing") {
      fail(GAME_PROTOCOL_ERRORS.invalidState, "La partida no está en juego.");
      return false;
    }
    return true;
  }

  function accessiblePuzzle(puzzleId: string): PuzzleDefinition | undefined {
    const puzzle = roomPackage.puzzles.find((candidate) => candidate.id === puzzleId);
    if (!puzzle) {
      fail(GAME_PROTOCOL_ERRORS.notAvailable, "Ese puzzle no existe.");
      return undefined;
    }
    if (
      puzzle.type !== "combine_items" &&
      session.playerPosition(selfId)?.roomId !== puzzle.roomId
    ) {
      fail(GAME_PROTOCOL_ERRORS.notAvailable, "Ese puzzle está en otra habitación.");
      return undefined;
    }
    return puzzle;
  }

  function runAttempt(
    puzzle: PuzzleDefinition,
    attempt: GameAttempt,
    now: number,
  ):
    | (RoomPuzzleActionResult<string> & { retryAfterSec?: number; revealedSymbol?: string | null })
    | null {
    const value = attempt as Record<string, unknown>;
    switch (puzzle.type) {
      case "hidden_key":
        return session.revealHiddenKey(puzzle.id, now, selfId);
      case "code_lock": {
        if (typeof value.code !== "string") return null;
        const result = session.attemptCode(puzzle.id, value.code, now, selfId);
        return {
          outcome: result.outcome,
          engine: result.engine,
          ...(result.lockedUntil !== null
            ? { retryAfterSec: Math.max(0, Math.ceil((result.lockedUntil - now) / 1000)) }
            : {}),
        };
      }
      case "sliding_puzzle":
        return typeof value.move === "number"
          ? session.moveSlidingTile(puzzle.id, value.move, now, selfId)
          : null;
      case "memory":
        return typeof value.flip === "string"
          ? session.flipMemoryCard(puzzle.id, value.flip, now, selfId)
          : null;
      case "pipes":
        if (typeof value.gate === "number")
          return session.openPipesGate(puzzle.id, value.gate, now, selfId);
        return typeof value.rotate === "number"
          ? session.rotatePipe(
              puzzle.id,
              value.rotate,
              now,
              selfId,
              typeof value.turns === "number" ? value.turns : 1,
            )
          : null;
      case "split_clue": {
        const input = Array.isArray(value.symbols)
          ? value.symbols.filter((symbol): symbol is string => typeof symbol === "string")
          : typeof value.code === "string"
            ? value.code
            : null;
        return input === null ? null : session.submitSplitClue(puzzle.id, input, now, selfId);
      }
      case "combine_items":
      case "simultaneous_plates":
        return null;
    }
  }

  const timer =
    options.tickMs === false
      ? undefined
      : setInterval(() => tick(), options.tickMs ?? LOCAL_TICK_MS);

  function tick(): void {
    if (session.state.phase === "lobby") return;
    publish(session.tick(logicalNow()));
  }

  function dispose(): void {
    if (timer) clearInterval(timer);
    snapshots.clear();
    events.clear();
  }

  return {
    selfId,
    getSnapshot: () => snapshot,
    subscribe: (listener) => snapshots.on(listener),
    onEvent: (listener) => events.on(listener),
    tick,
    dispose,
    leave: async () => dispose(),

    startGame() {
      if (session.state.phase !== "lobby") {
        fail(GAME_PROTOCOL_ERRORS.invalidState, "La partida ya ha empezado.");
        return;
      }
      publish(session.start(logicalNow()));
    },

    move(x, y, roomId) {
      if (!playing()) return;
      const current = session.playerPosition(selfId);
      if (!current) return;
      const target = roomId ?? current.roomId;
      if (target !== current.roomId) {
        const door = roomPackage.objects.find(
          (object) => object.roomId === current.roomId && object.leadsTo === target,
        );
        const near =
          door === undefined ||
          Math.hypot(door.position.x - current.x, door.position.y - current.y) <= DOOR_REACH;
        if (!near || !session.canEnterRoom(current.roomId, target)) {
          fail(GAME_PROTOCOL_ERRORS.roomLocked, "La puerta está cerrada o demasiado lejos.");
          return;
        }
        const room = roomPackage.map.rooms.find((candidate) => candidate.id === target)!;
        const spawn = room.spawnPoints[0] ?? { x: 0, y: 0 };
        publish(session.movePlayer(selfId, target, spawn.x, spawn.y, logicalNow()).engine);
        return;
      }
      const grid = roomPackage.map.rooms.find((room) => room.id === current.roomId)!.grid;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > grid.cols - 1 ||
        y > grid.rows - 1
      ) {
        fail(MOVE_OUT_OF_BOUNDS, "Movimiento rechazado por el servidor.");
        return;
      }
      if (Math.hypot(x - current.x, y - current.y) > GAME_MAX_STEP_CELLS) {
        fail(GAME_PROTOCOL_ERRORS.moveTooFast, "Movimiento rechazado por el servidor.");
        return;
      }
      publish(session.movePlayer(selfId, current.roomId, x, y, logicalNow()).engine);
    },

    interact(objectId) {
      if (!playing()) return;
      const result = session.interact(objectId, logicalNow(), selfId);
      if (result.rejected) {
        fail(GAME_PROTOCOL_ERRORS.notAvailable, result.rejected);
        return;
      }
      publish(result.engine);
    },

    useItem(itemId, objectId) {
      if (!playing()) return;
      const result = session.useItemOnObject(itemId, objectId, logicalNow(), selfId);
      if (result.rejected) {
        fail(GAME_PROTOCOL_ERRORS.notAvailable, result.rejected);
        return;
      }
      publish(result.engine);
    },

    combine(inputs, puzzleId) {
      if (!playing()) return;
      const puzzle = roomPackage.puzzles.find(
        (candidate) =>
          candidate.type === "combine_items" &&
          (puzzleId === undefined || candidate.id === puzzleId),
      );
      if (!puzzle) {
        fail(GAME_PROTOCOL_ERRORS.notAvailable, "No hay recetas en esta sala.");
        return;
      }
      const combined = session.combine(puzzle.id, inputs, logicalNow(), selfId);
      emit({
        type: "attempt_result",
        puzzleId: puzzle.id,
        ok: combined.result.outcome === "combined",
        outcome: combined.result.outcome,
        ...(combined.result.outcome === "combined" && combined.result.output
          ? { output: combined.result.output }
          : {}),
      });
      publish(combined.engine);
    },

    openPuzzle(puzzleId) {
      if (!playing()) return;
      const puzzle = accessiblePuzzle(puzzleId);
      if (!puzzle) return;
      if (session.puzzleState(puzzle.id) === "locked") {
        fail(GAME_PROTOCOL_ERRORS.notAvailable, "El puzzle aún está bloqueado.");
        return;
      }
      openPanels.add(puzzle.id);
      emit({
        type: "puzzle_view",
        puzzleId: puzzle.id,
        view: session.puzzleView(puzzle.id, selfId),
      });
    },

    closePuzzle(puzzleId) {
      openPanels.delete(puzzleId);
    },

    attempt(puzzleId, attempt) {
      if (!playing()) return;
      const puzzle = accessiblePuzzle(puzzleId);
      if (!puzzle) return;
      const outcome = runAttempt(puzzle, attempt, logicalNow());
      if (!outcome) {
        fail(GAME_PROTOCOL_ERRORS.invalidState, "Intento con forma inválida para este puzzle.");
        return;
      }
      const ok = OK_OUTCOMES.has(outcome.outcome);
      emit({
        type: "attempt_result",
        puzzleId: puzzle.id,
        ok,
        outcome: outcome.outcome,
        ...(ok ? {} : { error: ATTEMPT_ERRORS[outcome.outcome] ?? outcome.outcome }),
        ...(outcome.retryAfterSec !== undefined ? { retryAfterSec: outcome.retryAfterSec } : {}),
        ...(outcome.revealedSymbol ? { revealedSymbol: outcome.revealedSymbol } : {}),
      });
      publish(outcome.engine);
    },

    setPlate(plateId, active, puzzleId) {
      if (!playing()) return;
      const puzzle = roomPackage.puzzles.find(
        (candidate) =>
          candidate.type === "simultaneous_plates" &&
          (puzzleId === undefined || candidate.id === puzzleId) &&
          candidate.plates.some((plate) => plate.objectId === plateId),
      );
      if (!puzzle) {
        fail(GAME_PROTOCOL_ERRORS.notAvailable, "Esa placa no existe.");
        return;
      }
      const result = session.setPlate(puzzle.id, plateId, active, logicalNow(), selfId);
      emit({
        type: "attempt_result",
        puzzleId: puzzle.id,
        ok: OK_OUTCOMES.has(result.outcome),
        outcome: result.outcome,
      });
      publish(result.engine);
    },

    requestSplitView(puzzleId) {
      if (!playing()) return;
      const roomId = session.playerPosition(selfId)?.roomId;
      const puzzle = roomPackage.puzzles.find(
        (candidate) =>
          candidate.type === "split_clue" &&
          (puzzleId === undefined ? candidate.roomId === roomId : candidate.id === puzzleId),
      );
      if (!puzzle) {
        fail(GAME_PROTOCOL_ERRORS.notAvailable, "No hay ninguna pista repartida aquí.");
        return;
      }
      const view = session.splitClueView(puzzle.id, selfId);
      const fragments: Record<string, string> = {};
      view.visible.forEach((symbol, index) => {
        if (symbol !== null) fragments[String(index)] = symbol;
      });
      emit({
        type: "split_fragments",
        puzzleId: puzzle.id,
        viewpointId: view.viewpointId || null,
        fragments,
      });
    },

    selectCharacter(next) {
      // Cliente local (playtest sin servidor, un solo jugador): no hay
      // colisión posible con otro jugador, así que se acepta sin más.
      characterId = next;
      sync();
    },

    requestHint(puzzleId) {
      if (!playing()) return;
      const result = session.requestHint(puzzleId);
      if (!result.ok) {
        fail(GAME_PROTOCOL_ERRORS.notAvailable, result.error.code);
        return;
      }
      const delivered = session
        .hintView(options.locale)
        .puzzles.find((entry) => entry.puzzleId === puzzleId)
        ?.hints.at(-1);
      emit({
        type: "hint_delivered",
        puzzleId,
        tier: delivered?.tier ?? null,
        text: delivered?.text ?? null,
      });
      sync();
    },

    sendChat(text) {
      const filtered = filterChatText(text);
      if (!filtered.text) return;
      chatId += 1;
      chat.push({
        id: `local-${chatId}`,
        authorId: selfId,
        authorName: options.name ?? "Jugador 1",
        text: filtered.text,
        ts: wallNow(),
        filtered: filtered.filtered,
      });
      while (chat.length > 50) chat.shift();
      sync();
    },

    requestMediaToken(role = "player") {
      // Sin servidor no hay medios: la UI queda en «sin medios» (specs/12).
      emit({
        type: "media_token",
        payload: {
          configured: false,
          token: null,
          url: null,
          room: null,
          identity: selfId,
          role,
          allowVideo: false,
          canPublish: false,
          canPublishVideo: false,
        },
      });
    },
  };
}
