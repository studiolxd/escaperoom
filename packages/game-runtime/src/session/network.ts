import type { RoomPuzzlePublicView } from "@escaperoom/shared/session";
import { Emitter } from "./emitter";
import {
  CHAT_PROTOCOL_MESSAGE,
  GAME_PROTOCOL,
  MEDIA_PROTOCOL,
  PROTOCOL_ERROR_MESSAGE,
} from "./protocol";
import { toGameSnapshot, type GameRoomStateLike } from "./snapshot";
import type { GameClient, GameEndStats, GameEvent, GameSnapshot } from "./types";

/**
 * Vista estructural de una `Room` de `@colyseus/sdk` (o del cliente de
 * `@colyseus/testing`): lo único que necesita el adaptador. Así el runtime no
 * depende del SDK y los tests pueden usar el cliente real sin navegador.
 */
export interface GameRoomConnection<S = GameRoomStateLike> {
  readonly sessionId: string;
  readonly state: S;
  send(type: string, payload?: unknown): void;
  onStateChange: ((callback: (state: S) => void) => unknown) & {
    remove?: (callback: (state: S) => void) => void;
  };
  onMessage<T = unknown>(type: string, callback: (payload: T) => void): () => void;
  leave(consented?: boolean): Promise<unknown>;
}

export interface NetworkGameClient extends GameClient {
  /** Suelta los listeners sin salir de la room (la conexión la gestiona web). */
  dispose(): void;
}

type Payload = Record<string, unknown>;

/**
 * Cliente de red contra la `GameRoom`/`PlaytestRoom` (specs/11): refleja el
 * room state sincronizado en `GameSnapshot`, reenvía los mensajes del servidor
 * como `GameEvent` tipados y traduce cada intención a su mensaje del protocolo
 * —el mismo que habla el E2E de 2.12—. No valida nada: el servidor decide.
 */
export function createNetworkGameClient(
  room: GameRoomConnection<GameRoomStateLike>,
): NetworkGameClient {
  const selfId = room.sessionId;
  const snapshots = new Emitter<GameSnapshot>();
  const events = new Emitter<GameEvent>();
  let snapshot = toGameSnapshot(room.state, selfId);

  const onState = (state: GameRoomStateLike) => {
    // F-4: pasa el snapshot anterior para que `toGameSnapshot` reutilice cada
    // colección (jugadores, objetos, puzzles, inventarios, flags, chat) que
    // no cambió de verdad, en vez de reconstruirla entera en cada patch.
    snapshot = toGameSnapshot(state, selfId, snapshot);
    snapshots.emit(snapshot);
  };
  room.onStateChange(onState);

  const offs: Array<() => void> = [];
  const listen = (type: string, map: (payload: Payload) => GameEvent | null) => {
    offs.push(
      room.onMessage<unknown>(type, (payload) => {
        const event = map(isRecord(payload) ? payload : {});
        if (event) events.emit(event);
      }),
    );
  };

  listen(GAME_PROTOCOL.dialogShow, (p) =>
    typeof p.dialogId === "string" ? { type: "dialog_show", dialogId: p.dialogId } : null,
  );
  listen(GAME_PROTOCOL.imageShow, (p) =>
    typeof p.image === "string"
      ? { type: "image_show", image: p.image, ...(typeof p.caption === "string" ? { caption: p.caption } : {}) }
      : null,
  );
  listen(GAME_PROTOCOL.objectStateChanged, (p) => ({
    type: "object_state_changed",
    objectId: str(p.objectId),
    state: str(p.state),
  }));
  listen(GAME_PROTOCOL.itemGranted, (p) => ({
    type: "item_granted",
    playerId: str(p.playerId),
    itemId: str(p.itemId),
  }));
  listen(GAME_PROTOCOL.puzzleSolved, (p) => ({
    type: "puzzle_solved",
    puzzleId: str(p.puzzleId),
    solvedBy: typeof p.solvedBy === "string" ? p.solvedBy : null,
    grantsItems: strings(p.grantsItems),
    unlocks: strings(p.unlocks),
  }));
  listen(GAME_PROTOCOL.gameEnded, (p) => ({
    type: "game_ended",
    result: str(p.result),
    stats: isRecord(p.stats) ? (p.stats as unknown as GameEndStats) : null,
  }));
  listen(GAME_PROTOCOL.puzzleView, (p) =>
    isRecord(p.view)
      ? {
          type: "puzzle_view",
          puzzleId: str(p.puzzleId),
          view: p.view as unknown as RoomPuzzlePublicView,
        }
      : null,
  );
  listen(GAME_PROTOCOL.attemptResult, (p) => ({
    type: "attempt_result",
    puzzleId: str(p.puzzleId),
    ok: p.ok === true,
    outcome: str(p.outcome),
    ...(typeof p.error === "string" ? { error: p.error } : {}),
    ...(typeof p.retryAfterSec === "number" ? { retryAfterSec: p.retryAfterSec } : {}),
    ...(typeof p.revealedSymbol === "string" ? { revealedSymbol: p.revealedSymbol } : {}),
    ...(typeof p.output === "string" ? { output: p.output } : {}),
  }));
  listen(GAME_PROTOCOL.splitFragments, (p) => ({
    type: "split_fragments",
    puzzleId: str(p.puzzleId),
    viewpointId: typeof p.viewpointId === "string" ? p.viewpointId : null,
    fragments: isRecord(p.fragments)
      ? Object.fromEntries(
          Object.entries(p.fragments).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {},
  }));
  listen(GAME_PROTOCOL.hintDelivered, (p) => ({
    type: "hint_delivered",
    puzzleId: str(p.puzzleId),
    tier: typeof p.tier === "number" ? p.tier : null,
    text: typeof p.text === "string" ? p.text : null,
  }));
  listen(PROTOCOL_ERROR_MESSAGE, (p) => ({
    type: "error",
    code: str(p.code) || "error",
    message: str(p.message),
    ...(typeof p.retryAfterMs === "number" ? { retryAfterMs: p.retryAfterMs } : {}),
    ...(typeof p.messageType === "string" ? { messageType: p.messageType } : {}),
  }));
  listen(MEDIA_PROTOCOL.token, (p) => ({ type: "media_token", payload: p }));

  const send = (type: string, payload: object = {}) => room.send(type, payload);

  const dispose = () => {
    room.onStateChange.remove?.(onState);
    for (const off of offs.splice(0)) off();
    snapshots.clear();
    events.clear();
  };

  return {
    selfId,
    getSnapshot: () => snapshot,
    subscribe: (listener) => snapshots.on(listener),
    onEvent: (listener) => events.on(listener),
    startGame: () => send(GAME_PROTOCOL.startGame),
    move: (x, y, roomId) => send(GAME_PROTOCOL.move, roomId ? { x, y, roomId } : { x, y }),
    interact: (objectId) => send(GAME_PROTOCOL.interact, { objectId }),
    useItem: (itemId, objectId) => send(GAME_PROTOCOL.useItem, { itemId, objectId }),
    combine: (inputs, puzzleId) =>
      send(
        GAME_PROTOCOL.combine,
        puzzleId ? { puzzleId, inputs: [...inputs] } : { inputs: [...inputs] },
      ),
    openPuzzle: (puzzleId) => send(GAME_PROTOCOL.puzzleOpen, { puzzleId }),
    closePuzzle: (puzzleId) => send(GAME_PROTOCOL.puzzleClose, { puzzleId }),
    attempt: (puzzleId, attempt) => send(GAME_PROTOCOL.puzzleAttempt, { puzzleId, attempt }),
    setPlate: (plateId, active, puzzleId) =>
      send(
        GAME_PROTOCOL.plateState,
        puzzleId ? { puzzleId, plateId, active } : { plateId, active },
      ),
    requestSplitView: (puzzleId) => send(GAME_PROTOCOL.splitView, puzzleId ? { puzzleId } : {}),
    requestHint: (puzzleId) => send(GAME_PROTOCOL.hintRequest, { puzzleId }),
    selectCharacter: (characterId) => send(GAME_PROTOCOL.selectCharacter, { characterId }),
    sendChat: (text) => send(CHAT_PROTOCOL_MESSAGE, { text }),
    requestMediaToken: (role = "player") => send(MEDIA_PROTOCOL.request, { role }),
    leave: async () => {
      dispose();
      await room.leave(true);
    },
    dispose,
  };
}

function isRecord(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
