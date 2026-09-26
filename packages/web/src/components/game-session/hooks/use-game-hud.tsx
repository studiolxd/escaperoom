import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { resolveIconFrame, type RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack, WorldSceneEvent } from "@escaperoom/game-runtime/phaser";
import {
  buildHintView,
  elapsedMs,
  GAME_PROTOCOL_ERRORS,
  MOVE_OUT_OF_BOUNDS,
  remainingMs,
  stepsBetween,
  toSessionSummary,
  walkSteps,
  type DeliveredHint,
  type GameClient,
  type GameEvent,
  type GameSnapshot,
} from "@escaperoom/game-runtime/session";
import { RATE_LIMITED_ERROR } from "@escaperoom/shared/error-codes";
import type { HintRequestErrorCode } from "@escaperoom/shared/hints";
import type { RoomPuzzlePublicView, SessionSummary } from "@escaperoom/shared/session";
import type {
  CombineItemsPublicView,
  SimultaneousPlatesPublicView,
  SplitCluePublicView,
} from "@escaperoom/shared/templates";
import type { CodeLockFeedback } from "@/components/puzzles/code-lock-panel";
import type { HiddenKeyFeedback } from "@/components/puzzles/hidden-key-panel";
import type { InventoryCombineFeedback } from "@/components/puzzles/inventory-panel";
import { ItemIcon } from "@/components/puzzles/item-icon";
import type { MemoryFeedback } from "@/components/puzzles/memory-panel";
import type { PipesFeedback } from "@/components/puzzles/pipes-panel";
import type { PlatesFeedback } from "@/components/puzzles/plates-panel";
import type { SlidingFeedback } from "@/components/puzzles/sliding-panel";
import type { SplitClueFeedback } from "@/components/puzzles/split-clue-panel";
import { isIntroOpen, isWorldInputEnabled } from "@/lib/playtest-state";
import type { GameSessionCanvasHandle } from "../game-session-canvas";
import { useHudLog } from "./use-hud-log";

/** Último desenlace por panel, para el feedback de cada plantilla. */
export interface PanelFeedback {
  code: CodeLockFeedback;
  hidden: HiddenKeyFeedback;
  plates: PlatesFeedback;
  sliding: SlidingFeedback;
  memory: MemoryFeedback;
  split: SplitClueFeedback;
  pipes: PipesFeedback;
}

const NO_FEEDBACK: PanelFeedback = {
  code: null,
  hidden: null,
  plates: null,
  sliding: null,
  memory: null,
  split: null,
  pipes: null,
};

/** Clave de feedback de cada plantilla con panel propio. */
const FEEDBACK_KEY: Partial<Record<string, keyof PanelFeedback>> = {
  code_lock: "code",
  hidden_key: "hidden",
  simultaneous_plates: "plates",
  sliding_puzzle: "sliding",
  memory: "memory",
  split_clue: "split",
  pipes: "pipes",
};

/** Errores de protocolo con texto propio (specs/11 §7); el resto, genérico. */
export const KNOWN_ERRORS = new Set<string>([
  ...Object.values(GAME_PROTOCOL_ERRORS),
  MOVE_OUT_OF_BOUNDS,
  RATE_LIMITED_ERROR,
]);

const HINT_ERRORS = new Set<string>(["unknown_puzzle", "no_more_tiers", "insufficient_hints"]);

export interface UseGameHudOptions {
  model: RuntimeModel;
  pack?: RoomScenePack;
  client: GameClient;
  snapshot: GameSnapshot;
  handleRef: RefObject<GameSessionCanvasHandle | null>;
  sceneRoomRef: RefObject<string>;
  /**
   * Indicadores de depuración propios del playtest (F-5): registra también
   * cada inspección y combinación, no solo los desenlaces del servidor.
   */
  debugLog?: boolean;
}

/**
 * F-5: el resto de la máquina de estados del HUD — diálogos, panel de
 * puzzle/pistas, inventario, menú contextual, registro y resumen — a partir
 * únicamente del `GameSnapshot`/`GameEvent` del `GameClient` (specs/11 §4). No
 * distingue red de local: el mismo hook vale para la partida y el playtest
 * (`createLocalGameClient`).
 */
export function useGameHud({ model, pack, client, snapshot, handleRef, sceneRoomRef, debugLog }: UseGameHudOptions) {
  const t = useTranslations("Game");
  const tp = useTranslations("Playtest");
  const locale = useLocale();

  const snapshotRef = useRef<GameSnapshot>(snapshot);
  snapshotRef.current = snapshot;

  /**
   * F-43..47 punto 1: desfase entre el reloj lógico del servidor
   * (`snapshot.clock`) y el reloj del jugador, recalculado en cada snapshot
   * nuevo. `serverNow()` nunca lee `Date.now()` a secas: sirve para paneles
   * con cuenta atrás corta (placas) donde el reloj del ordenador desincronizado
   * haría que la ventana mostrada no coincidiera con la que resuelve el
   * servidor.
   */
  const clockOffsetRef = useRef(0);
  clockOffsetRef.current = snapshot.clock - Date.now();
  const serverNow = useCallback(() => Date.now() + clockOffsetRef.current, []);

  const firstRoomId = model.subrooms[0]?.id ?? "";
  const self = snapshot.self;
  const roomId = self?.roomId || firstRoomId;
  const playing = snapshot.phase === "playing";
  const isHost = snapshot.hostId !== "" && snapshot.hostId === snapshot.selfId;

  const [dialog, setDialog] = useState<{ id: string; text: string } | null>(null);
  const [imagePanel, setImagePanel] = useState<{ image: string; caption?: string } | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, RoomPuzzlePublicView>>({});
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [combineFeedback, setCombineFeedback] = useState<InventoryCombineFeedback | null>(null);
  const [feedback, setFeedback] = useState<PanelFeedback>(NO_FEEDBACK);
  const [delivered, setDelivered] = useState<DeliveredHint[]>([]);
  const [hintError, setHintError] = useState<HintRequestErrorCode | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const { log, pushLog } = useHudLog();

  const panelRef = useRef<string | null>(null);
  panelRef.current = panel;

  const combinePuzzleId = useMemo(
    () => model.puzzles.find((puzzle) => puzzle.type === "combine_items")?.id,
    [model],
  );

  const itemName = useCallback(
    (itemId: string) => model.itemsById[itemId]?.name ?? itemId,
    [model],
  );

  /**
   * F-27: nombre visible del objeto — el propio (o el del diálogo de
   * inspección) que ya resolvió el loader, o un genérico traducido; nunca el
   * `id` técnico (`armario`, `p-llave-cuadro`).
   */
  const objectName = useCallback(
    (objectId: string) => model.objectsById[objectId]?.name || tp("genericObject"),
    [model, tp],
  );

  const errorText = useCallback(
    (code: string) => (KNOWN_ERRORS.has(code) ? t(`errors.${code}`) : t("errors.generic")),
    [t],
  );

  const introOpen = isIntroOpen(dialog);
  const worldInputEnabled =
    playing &&
    isWorldInputEnabled({ introOpen, inventoryOpen, panelOpen: panel !== null }) &&
    selected === null &&
    pickerFor === null;

  // — Mensajes del servidor ————————————————————————————————————————

  const closePanel = useCallback(() => {
    const current = panelRef.current;
    if (current && current !== "hints") client.closePuzzle(current);
    setPanel(null);
  }, [client]);

  useEffect(() => {
    return client.onEvent((event: GameEvent) => {
      switch (event.type) {
        case "dialog_show": {
          const known = model.dialogsById[event.dialogId];
          setDialog({ id: event.dialogId, text: known?.text ?? event.dialogId });
          break;
        }
        case "image_show": {
          setImagePanel({ image: event.image, ...(event.caption ? { caption: event.caption } : {}) });
          break;
        }
        case "object_state_changed":
          break;
        case "item_granted": {
          const mine = event.playerId === snapshotRef.current.selfId;
          const who = snapshotRef.current.players.find((p) => p.id === event.playerId)?.name;
          pushLog(
            mine
              ? t("log.itemGranted", { item: itemName(event.itemId) })
              : t("log.itemGrantedOther", { player: who ?? "?", item: itemName(event.itemId) }),
          );
          break;
        }
        case "puzzle_solved":
          pushLog(tp("log.solved", { puzzle: event.puzzleId }));
          if (panelRef.current === event.puzzleId) {
            client.closePuzzle(event.puzzleId);
            setPanel(null);
          }
          break;
        case "puzzle_view":
          setViews((prev) => ({ ...prev, [event.puzzleId]: event.view }));
          break;
        case "attempt_result": {
          if (event.puzzleId === combinePuzzleId) {
            setCombineFeedback({
              outcome: event.outcome as InventoryCombineFeedback["outcome"],
              output: event.output ?? null,
            });
            break;
          }
          const type = model.puzzlesById[event.puzzleId]?.type;
          const key = type ? FEEDBACK_KEY[type] : undefined;
          if (key) setFeedback((prev) => ({ ...prev, [key]: event.outcome }));
          break;
        }
        case "hint_delivered":
          if (event.tier !== null && event.text !== null) {
            const hint = { puzzleId: event.puzzleId, tier: event.tier, text: event.text };
            setDelivered((prev) => [...prev, hint]);
          }
          setHintError(null);
          break;
        case "error":
          // Rate limit por mensaje de la partida (specs/11 §9, ticket 6.3): el
          // servidor descartó el mensaje. Un `move` descartado deja el avatar
          // por delante: vuelve a la posición autoritativa.
          if (
            event.code === "RATE_LIMITED" &&
            event.messageType !== undefined &&
            event.messageType !== "chat"
          ) {
            const me = snapshotRef.current.self;
            if (event.messageType === "move") {
              if (me) handleRef.current?.placeAvatar(me.x, me.y);
            } else {
              pushLog(tp("log.rateLimited"));
            }
            break;
          }
          if (event.code === "RATE_LIMITED" || event.code === "INVALID_PAYLOAD") {
            setChatError(event.message || errorText(event.code));
            break;
          }
          if (HINT_ERRORS.has(event.message)) {
            setHintError(event.message as HintRequestErrorCode);
            break;
          }
          if (
            event.code === GAME_PROTOCOL_ERRORS.moveTooFast ||
            event.code === MOVE_OUT_OF_BOUNDS
          ) {
            const me = snapshotRef.current.self;
            if (me) handleRef.current?.placeAvatar(me.x, me.y);
            break;
          }
          if (event.code === GAME_PROTOCOL_ERRORS.roomLocked) {
            const me = snapshotRef.current.self;
            if (me && sceneRoomRef.current !== me.roomId) {
              sceneRoomRef.current = me.roomId;
              handleRef.current?.showRoom(me.roomId);
              handleRef.current?.placeAvatar(me.x, me.y);
            }
            pushLog(tp("log.roomLocked"));
            break;
          }
          // Un panel que el servidor no deja abrir (bloqueado, otra sala) se cierra.
          if (
            event.code === GAME_PROTOCOL_ERRORS.notAvailable &&
            panelRef.current &&
            panelRef.current !== "hints"
          ) {
            setPanel(null);
          }
          pushLog(errorText(event.code));
          break;
        case "game_ended":
          setSummary(toSessionSummary(event.result, event.stats, snapshotRef.current));
          break;
        default:
          break;
      }
    });
  }, [client, model, combinePuzzleId, itemName, pushLog, errorText, t, tp, handleRef, sceneRoomRef]);

  // — Intenciones del jugador ————————————————————————————————————————

  /**
   * F-23: `walkSteps` manda los pasos al ritmo `AVATAR_MOVE_EMIT_MS` (100 ms
   * = el límite de `move` del servidor, 10/s) en vez de un bucle síncrono que
   * los mandaba todos de golpe — eso disparaba `RATE_LIMITED` y el "rebote"
   * del avatar (el cliente lo colocaba en el destino antes de que el
   * servidor aceptara los pasos intermedios).
   */
  const walkCancelRef = useRef<(() => void) | null>(null);

  const stopWalking = useCallback(() => {
    walkCancelRef.current?.();
    walkCancelRef.current = null;
  }, []);

  useEffect(() => stopWalking, [stopWalking]);

  /** Camina en pasos válidos hasta `target` (placas, mirillas, puertas). */
  const walkTo = useCallback(
    (target: { x: number; y: number }, onArrive?: () => void) => {
      const me = snapshotRef.current.self;
      if (!me) {
        onArrive?.();
        return;
      }
      const from = handleRef.current?.avatarCell() ?? { x: me.x, y: me.y };
      stopWalking();
      const { cancel } = walkSteps(
        stepsBetween(from, target),
        (step) => {
          client.move(step.x, step.y);
          handleRef.current?.placeAvatar(step.x, step.y);
        },
        { onDone: onArrive },
      );
      walkCancelRef.current = cancel;
    },
    [client, stopWalking, handleRef],
  );

  const openPanel = useCallback(
    (puzzleId: string, fromObjectId?: string) => {
      const puzzle = model.puzzlesById[puzzleId];
      if (!puzzle) return;
      if (puzzle.type === "combine_items") {
        setInventoryOpen(true);
        client.openPuzzle(puzzle.id);
        return;
      }
      if (puzzle.type === "split_clue") {
        const viewpoint =
          puzzle.viewpoints?.find((candidate) => candidate.objectId === fromObjectId) ??
          puzzle.viewpoints?.[0];
        if (viewpoint) walkTo(viewpoint);
      }
      setPanel(puzzle.id);
      client.openPuzzle(puzzle.id);
    },
    [client, model, walkTo],
  );

  const inspect = useCallback(
    (objectId: string) => {
      client.interact(objectId);
      if (debugLog) pushLog(tp("log.interact", { object: objectId }));
      const panelId = model.objectsById[objectId]?.panelPuzzleId;
      // El escondite de un `hidden_key` se revela al inspeccionar: sin panel.
      if (panelId && model.puzzlesById[panelId]?.type !== "hidden_key")
        openPanel(panelId, objectId);
    },
    [client, model, openPanel, debugLog, pushLog, tp],
  );

  const applyItemUse = useCallback(
    (itemId: string, objectId: string) => {
      client.useItem(itemId, objectId);
      pushLog(tp("log.useItem", { item: itemName(itemId), object: objectName(objectId) }));
    },
    [client, itemName, objectName, pushLog, tp],
  );

  const enterRoom = useCallback(
    (targetRoomId: string, doorPosition?: { x: number; y: number }) => {
      // F-23: el `move` de cruce solo se manda cuando el avatar ha llegado
      // de verdad a la puerta — `walkTo` ahora paga los pasos intermedios en
      // el tiempo (antes, un bucle síncrono los mandaba todos antes de que
      // esta función siguiera, así que mandar el cruce justo después ya
      // llegaba en orden; con el ritmo nuevo, mandarlo antes de que termine
      // de andar llegaba al servidor con el jugador aún lejos de la puerta).
      const crossDoor = () => {
        client.move(0, 0, targetRoomId);
        pushLog(
          tp("log.enterRoom", { room: model.subroomsById[targetRoomId]?.name ?? targetRoomId }),
        );
      };
      if (doorPosition) walkTo(doorPosition, crossDoor);
      else crossDoor();
    },
    [client, model, walkTo, pushLog, tp],
  );

  const onWorldEvent = useCallback(
    (event: WorldSceneEvent) => {
      if (event.type === "interact") {
        setSelected(event.objectId);
      } else if (event.type === "use-item") {
        setSelected(null);
        setPickerFor(null);
        applyItemUse(event.itemId, event.objectId);
      } else if (event.type === "enter-room") {
        // La escena ya muestra la sala nueva; el servidor confirma o corrige.
        sceneRoomRef.current = event.roomId;
        enterRoom(event.roomId);
      } else if (event.type === "avatar-move") {
        const me = snapshotRef.current.self;
        if (snapshotRef.current.phase === "playing" && me && event.roomId === me.roomId) {
          client.move(event.x, event.y);
        }
      }
    },
    [client, applyItemUse, enterRoom, sceneRoomRef],
  );

  const togglePlate = useCallback(
    (puzzleId: string, plateObjectId: string, active: boolean) => {
      const puzzle = model.puzzlesById[puzzleId];
      const plate = puzzle?.plates?.find((candidate) => candidate.objectId === plateObjectId);
      const spawn = model.subroomsById[roomId]?.spawns[0];
      const target = active ? plate : spawn;
      if (target) walkTo(target);
    },
    [model, roomId, walkTo],
  );

  const placePlatesBridge = useCallback(
    (puzzleId: string) => {
      const bridge = model.puzzlesById[puzzleId]?.soloBridgeItemId;
      const view = views[puzzleId] as SimultaneousPlatesPublicView | undefined;
      const free = view?.plates.find((plate) => !plate.active);
      if (bridge && free) client.useItem(bridge, free.objectId);
    },
    [client, model, views],
  );

  const placeMirror = useCallback(
    (puzzleId: string) => {
      const puzzle = model.puzzlesById[puzzleId];
      const view = views[puzzleId] as SplitCluePublicView | undefined;
      const viewpoint = view?.viewpointId || puzzle?.viewpoints?.[0]?.objectId;
      if (puzzle?.soloBridgeItemId && viewpoint) client.useItem(puzzle.soloBridgeItemId, viewpoint);
    },
    [client, model, views],
  );

  const openInventory = useCallback(() => {
    if (introOpen || !playing) return;
    setSelected(null);
    setPickerFor(null);
    if (panelRef.current) closePanel();
    setInventoryOpen(true);
    if (combinePuzzleId) client.openPuzzle(combinePuzzleId);
  }, [client, introOpen, playing, closePanel, combinePuzzleId]);

  const closeInventory = useCallback(() => {
    setInventoryOpen(false);
    if (combinePuzzleId) client.closePuzzle(combinePuzzleId);
  }, [client, combinePuzzleId]);

  const combine = useCallback(
    (inputs: readonly string[]) => {
      if (!combinePuzzleId) return;
      client.combine(inputs, combinePuzzleId);
      if (debugLog) pushLog(tp("log.combine", { input: inputs.join(" + ") }));
    },
    [client, combinePuzzleId, debugLog, pushLog, tp],
  );

  /** F-4: referencia estable — junto al `messages` incremental, evita repintar `ChatWindow` (memoizada). */
  const sendChat = useCallback(
    (text: string) => {
      setChatError(null);
      client.sendChat(text);
    },
    [client],
  );

  const closeDialog = useCallback(() => setDialog(null), []);

  const copyInvite = useCallback(
    async (inviteUrl: string | null | undefined) => {
      if (!inviteUrl) return;
      try {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        setCopied(false);
      }
    },
    [],
  );

  // — Derivados ——————————————————————————————————————————————————

  const currentRoom = model.subroomsById[roomId];
  const roomObjects = (currentRoom?.objects ?? []).filter((object) => object.interactable);
  const openDoors = (currentRoom?.objects ?? []).filter(
    (object) => object.leadsTo !== undefined && snapshot.objects[object.id] === "open",
  );
  const hintView = useMemo(
    () => buildHintView(model.hints ?? [], delivered, locale),
    [model, delivered, locale],
  );
  const hintPuzzleId =
    (model.hints ?? []).find((hint) => model.puzzlesById[hint.puzzleId]?.roomId === roomId)
      ?.puzzleId ?? model.hints?.[0]?.puzzleId;
  const activePuzzle = panel && panel !== "hints" ? model.puzzlesById[panel] : undefined;
  const activeView = activePuzzle ? views[activePuzzle.id] : undefined;
  const combineView = combinePuzzleId
    ? (views[combinePuzzleId] as CombineItemsPublicView | undefined)
    : undefined;
  const remaining = remainingMs(snapshot);
  // Ticket duración-salas: sin cuenta atrás (sala sin duración), el HUD
  // muestra el tiempo transcurrido — nunca "00:00" ni nada. Mismo estilo del
  // badge, solo cambia el contenido.
  const elapsed = remaining === null ? elapsedMs(snapshot) : null;
  const selectedObject = selected ? model.objectsById[selected] : undefined;
  const solvedCount = Object.values(snapshot.puzzles).filter((p) => p.state === "solved").length;
  const renderItemIcon = useCallback(
    (itemId: string, size?: number) => (
      <ItemIcon
        frame={resolveIconFrame(pack?.manifest, model.itemsById[itemId]?.icon ?? "")}
        baseUrl={pack?.baseUrl}
        name={itemName(itemId)}
        size={size}
      />
    ),
    [pack, model, itemName],
  );

  return {
    t,
    tp,
    roomId,
    currentRoom,
    playing,
    isHost,
    introOpen,
    worldInputEnabled,
    remaining,
    elapsed,
    serverNow,
    selectedObject,
    dialog,
    setDialog,
    closeDialog,
    imagePanel,
    setImagePanel,
    panel,
    setPanel,
    closePanel,
    inventoryOpen,
    openInventory,
    closeInventory,
    combineFeedback,
    combineView,
    feedback,
    hintError,
    hintView,
    hintPuzzleId,
    chatError,
    log,
    pushLog,
    selected,
    setSelected,
    pickerFor,
    setPickerFor,
    draggingItem,
    setDraggingItem,
    summary,
    copied,
    copyInvite,
    combinePuzzleId,
    combine,
    activePuzzle,
    activeView,
    roomObjects,
    openDoors,
    solvedCount,
    itemName,
    objectName,
    renderItemIcon,
    inspect,
    applyItemUse,
    openPanel,
    enterRoom,
    walkTo,
    onWorldEvent,
    togglePlate,
    placePlatesBridge,
    placeMirror,
    sendChat,
  };
}
