"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { resolveIconFrame, type RuntimeModel, type RuntimePuzzle } from "@escaperoom/game-runtime";
import type { RoomScenePack, WorldSceneEvent } from "@escaperoom/game-runtime/phaser";
import {
  buildHintView,
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
import type { HintRequestErrorCode } from "@escaperoom/shared/hints";
import type { RoomPuzzlePublicView, SessionSummary } from "@escaperoom/shared/session";
import type {
  CodeLockPublicView,
  CombineItemsPublicView,
  HiddenKeyPublicView,
  MemoryPublicView,
  PipesPuzzlePublicView,
  SimultaneousPlatesPublicView,
  SlidingPuzzlePublicView,
  SplitCluePublicView,
} from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChatWindow } from "@/components/chat/chat-panel";
import { ResultsScreen } from "@/components/game/results-screen";
import { HintPanel } from "@/components/hints/hint-panel";
import { CodeLockPanel, type CodeLockFeedback } from "@/components/puzzles/code-lock-panel";
import { HiddenKeyPanel, type HiddenKeyFeedback } from "@/components/puzzles/hidden-key-panel";
import {
  InventoryPanel,
  type InventoryCombineFeedback,
} from "@/components/puzzles/inventory-panel";
import { ItemIcon } from "@/components/puzzles/item-icon";
import { MemoryPanel, type MemoryFeedback } from "@/components/puzzles/memory-panel";
import { PipesPanel, type PipesFeedback } from "@/components/puzzles/pipes-panel";
import { PlatesPanel, type PlatesFeedback } from "@/components/puzzles/plates-panel";
import { SlidingPanel, type SlidingFeedback } from "@/components/puzzles/sliding-panel";
import { SplitCluePanel, type SplitClueFeedback } from "@/components/puzzles/split-clue-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { formatDuration } from "@/lib/session-format";
import { INTRO_DIALOG_ID, isIntroOpen, isWorldInputEnabled } from "@/lib/playtest-state";
import { CharacterPicker } from "./character-picker";
import { ConnectionBadge } from "./connection-badge";
import type { GameSessionCanvasHandle } from "./game-session-canvas";
import type { GameConnectionStatus } from "./use-game-connection";

const GameSessionCanvas = dynamic(() => import("./game-session-canvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-slate-950" />,
});

/** Último desenlace por panel, para el feedback de cada plantilla. */
interface PanelFeedback {
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
const FEEDBACK_KEY: Partial<Record<RuntimePuzzle["type"], keyof PanelFeedback>> = {
  code_lock: "code",
  hidden_key: "hidden",
  simultaneous_plates: "plates",
  sliding_puzzle: "sliding",
  memory: "memory",
  split_clue: "split",
  pipes: "pipes",
};

/** Errores de protocolo con texto propio (specs/11 §7); el resto, genérico. */
const KNOWN_ERRORS = new Set<string>([
  ...Object.values(GAME_PROTOCOL_ERRORS),
  MOVE_OUT_OF_BOUNDS,
  "RATE_LIMITED",
]);

/**
 * ¿Se puede reflejar este estado en la escena? El room state también lleva los
 * objetos sin estados declarados (decoración interactuable, `""`), que la
 * escena no sabe pintar.
 */
function declaresState(model: RuntimeModel, objectId: string, state: string): boolean {
  return Boolean(state) && (model.objectsById[objectId]?.states.includes(state) ?? false);
}

const HINT_ERRORS = new Set<string>(["unknown_puzzle", "no_more_tiers", "insufficient_hints"]);

export interface GameSessionShellProps {
  /** Modelo público de la sala (sin soluciones), calculado en servidor. */
  model: RuntimeModel;
  pack?: RoomScenePack;
  /** Fuente de estado: la `GameRoom` por red (o la emulación local). */
  client: GameClient;
  /** Estado de la conexión de red y reintento; sin él, la barra no se muestra. */
  connection?: { status: GameConnectionStatus; onRetry: () => void };
  /** Link para invitar a más jugadores a esta partida. */
  inviteUrl?: string | null;
  /** Título de la cabecera (por defecto, el de la sala). */
  title?: string;
  subtitle?: string;
  exitHref?: string;
  /** Sala gratis sin cuenta (punto i, "CTA Jugar"): CTA de login en `ResultsScreen`. */
  signInHref?: string;
  /** Capas extra sobre el canvas (p. ej. el overlay de voz/webcam). */
  children?: ReactNode;
}

/**
 * Partida en red (fase 2): Phaser + paneles React de las 8 plantillas pintados
 * **solo** a partir del estado sincronizado (`GameSnapshot`) y de las vistas
 * públicas que manda el servidor (`puzzle_view`), con cada intención enviada
 * como mensaje del protocolo (specs/11 §4). El cliente nunca recibe ni calcula
 * soluciones: el modelo que llega es el del runtime (sin códigos) y cada panel
 * refleja el desenlace (`attempt_result`) que decide el servidor.
 *
 * Posición autoritativa: el avatar local envía su posición (`move`, ≈10/s) y
 * se recoloca cuando el servidor lo corrige (spawn, cruce de sala o rechazo);
 * placas y mirillas dependen de esa posición, así que sus paneles colocan al
 * jugador encima de la placa o tras la mirilla caminando en pasos válidos.
 */
export function GameSessionShell({
  model,
  pack,
  client,
  connection,
  inviteUrl,
  title,
  subtitle,
  exitHref,
  signInHref,
  children,
}: GameSessionShellProps) {
  const t = useTranslations("Game");
  const tp = useTranslations("Playtest");
  const locale = useLocale();

  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const snapshotRef = useRef<GameSnapshot>(snapshot);
  snapshotRef.current = snapshot;

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
  const [log, setLog] = useState<Array<{ id: number; text: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRef = useRef<GameSessionCanvasHandle | null>(null);
  /** Habitación que muestra la escena (puede adelantarse al servidor al cruzar). */
  const sceneRoomRef = useRef(roomId);
  /** Última habitación autoritativa del jugador local. */
  const serverRoomRef = useRef<string | null>(null);
  const appliedObjectsRef = useRef<Record<string, string>>({});
  const panelRef = useRef<string | null>(null);
  panelRef.current = panel;
  const logIdRef = useRef(0);
  /**
   * F-35: el listener global de teclado se registra una sola vez (más abajo)
   * y lee estos refs al pulsar, en vez de re-registrarse en cada cambio de
   * `dialog`/`pickerFor`/`selected`/`inventoryOpen` (varias veces por
   * interacción).
   */
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const pickerForRef = useRef(pickerFor);
  pickerForRef.current = pickerFor;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const inventoryOpenRef = useRef(inventoryOpen);
  inventoryOpenRef.current = inventoryOpen;

  const combinePuzzleId = useMemo(
    () => model.puzzles.find((puzzle) => puzzle.type === "combine_items")?.id,
    [model],
  );

  const pushLog = useCallback((text: string) => {
    logIdRef.current += 1;
    const entry = { id: logIdRef.current, text };
    setLog((prev) => [entry, ...prev].slice(0, 12));
  }, []);

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

  // — Estado sincronizado → escena ————————————————————————————————————

  // Objetos: aplica cualquier estado nuevo (también al unirse a mitad de partida).
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    for (const [objectId, state] of Object.entries(snapshot.objects)) {
      if (appliedObjectsRef.current[objectId] === state) continue;
      appliedObjectsRef.current[objectId] = state;
      if (declaresState(model, objectId, state)) handle.setObjectState(objectId, state);
    }
  }, [model, snapshot.objects]);

  // Otros jugadores (la escena pinta los de la sala visible).
  useEffect(() => {
    handleRef.current?.setPlayers(
      snapshot.players
        .filter((player) => !player.isSelf)
        .map(({ id, name, roomId: playerRoom, x, y, tint, characterId, connected }) => ({
          id,
          name,
          roomId: playerRoom,
          x,
          y,
          tint,
          characterId,
          connected,
        })),
    );
  }, [snapshot.players]);

  // Jugador local: sala y posición autoritativas.
  const selfRoom = self?.roomId;
  const selfX = self?.x;
  const selfY = self?.y;
  const selfTint = self?.tint;
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !selfRoom || selfX === undefined || selfY === undefined) return;
    if (serverRoomRef.current !== selfRoom) {
      // Primera posición o cruce aceptado: la escena pasa a la sala del servidor.
      serverRoomRef.current = selfRoom;
      if (sceneRoomRef.current !== selfRoom) {
        sceneRoomRef.current = selfRoom;
        handle.showRoom(selfRoom);
      }
      handle.placeAvatar(selfX, selfY);
      return;
    }
    const local = handle.avatarCell();
    if (local && sceneRoomRef.current === selfRoom) {
      // Desfase grande (movimiento rechazado, pestaña en segundo plano): manda el servidor.
      if (Math.hypot(local.x - selfX, local.y - selfY) > 3.5) handle.placeAvatar(selfX, selfY);
    }
  }, [selfRoom, selfX, selfY]);

  useEffect(() => {
    if (selfTint) handleRef.current?.setLocalTint(selfTint);
  }, [selfTint]);

  const selfCharacterId = self?.characterId;
  useEffect(() => {
    if (selfCharacterId) handleRef.current?.setLocalCharacter(selfCharacterId);
  }, [selfCharacterId]);

  const onReady = useCallback(
    (handle: GameSessionCanvasHandle) => {
      handleRef.current = handle;
      // Estado que llegó antes de montar Phaser.
      const current = snapshotRef.current;
      appliedObjectsRef.current = {};
      for (const [objectId, state] of Object.entries(current.objects)) {
        appliedObjectsRef.current[objectId] = state;
        if (declaresState(model, objectId, state)) handle.setObjectState(objectId, state);
      }
      if (current.self) {
        serverRoomRef.current = current.self.roomId;
        if (current.self.tint) handle.setLocalTint(current.self.tint);
        if (current.self.characterId) handle.setLocalCharacter(current.self.characterId);
        handle.placeAvatar(current.self.x, current.self.y);
      }
    },
    [model],
  );

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
          appliedObjectsRef.current[event.objectId] = event.state;
          if (declaresState(model, event.objectId, event.state)) {
            handleRef.current?.setObjectState(event.objectId, event.state);
          }
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
  }, [client, model, combinePuzzleId, itemName, pushLog, errorText, t, tp]);

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
    [client, stopWalking],
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
      const panelId = model.objectsById[objectId]?.panelPuzzleId;
      // El escondite de un `hidden_key` se revela al inspeccionar: sin panel.
      if (panelId && model.puzzlesById[panelId]?.type !== "hidden_key")
        openPanel(panelId, objectId);
    },
    [client, model, openPanel],
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
    [client, applyItemUse, enterRoom],
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

  /** F-4: referencia estable — junto al `messages` incremental, evita repintar `ChatWindow` (memoizada). */
  const sendChat = useCallback(
    (text: string) => {
      setChatError(null);
      client.sendChat(text);
    },
    [client],
  );

  // F-35: refs para las funciones que el listener global de teclado necesita
  // en su versión más reciente, sin tener que re-registrarse cuando cambian
  // (misma técnica que los refs de estado, arriba).
  const openInventoryRef = useRef(openInventory);
  openInventoryRef.current = openInventory;
  const closeInventoryRef = useRef(closeInventory);
  closeInventoryRef.current = closeInventory;
  const closePanelRef = useRef(closePanel);
  closePanelRef.current = closePanel;

  // ESC cierra en cascada (diálogo → selector → menú → inventario → panel); I,
  // inventario. F-35: el listener se registra UNA VEZ (deps vacías) y lee el
  // estado más reciente desde refs — antes se re-registraba en cada cambio de
  // `dialog`/`pickerFor`/`selected`/`inventoryOpen`/`panel`, varias veces por
  // interacción del jugador.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape") {
        if (dialogRef.current) setDialog(null);
        else if (pickerForRef.current) setPickerFor(null);
        else if (selectedRef.current) setSelected(null);
        else if (inventoryOpenRef.current) closeInventoryRef.current();
        else if (panelRef.current) closePanelRef.current();
        return;
      }
      if (event.key === "i" || event.key === "I") {
        if (inventoryOpenRef.current) closeInventoryRef.current();
        else if (panelRef.current === null) openInventoryRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const copyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [inviteUrl]);

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
  const selectedObject = selected ? model.objectsById[selected] : undefined;
  const solvedCount = Object.values(snapshot.puzzles).filter((p) => p.state === "solved").length;
  const renderItemIcon = (itemId: string, size?: number) => (
    <ItemIcon
      frame={resolveIconFrame(pack?.manifest, model.itemsById[itemId]?.icon ?? "")}
      baseUrl={pack?.baseUrl}
      name={itemName(itemId)}
      size={size}
    />
  );

  return (
    <section
      className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950"
      data-testid="game-session"
      data-phase={snapshot.phase}
    >
      <ErrorBoundary>
        <GameSessionCanvas
          model={model}
          roomId={roomId}
          pack={pack}
          inputEnabled={worldInputEnabled}
          onEvent={onWorldEvent}
          onReady={onReady}
        />
      </ErrorBoundary>

      {draggingItem ? (
        <div className="pointer-events-none absolute inset-x-4 top-24 z-30 mx-auto w-fit rounded-full border border-amber-200/40 bg-slate-950/90 px-4 py-1.5 text-xs text-amber-100 shadow-lg">
          {tp("menu.dropHint", { item: itemName(draggingItem) })}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
        <header className="pointer-events-auto flex w-fit max-w-[min(92vw,44rem)] flex-col gap-1 rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-white backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{title ?? model.meta.title}</span>
            {connection ? (
              <ConnectionBadge status={connection.status} onRetry={connection.onRetry} />
            ) : null}
            {remaining !== null ? (
              <span className="font-mono text-xs text-amber-100" data-testid="game-timer">
                ⏳ {formatDuration(Math.ceil(remaining / 1000))}
              </span>
            ) : null}
          </div>
          {subtitle ? <p className="max-w-2xl text-xs text-white/60">{subtitle}</p> : null}
          <span className="text-xs text-amber-100/80" data-testid="game-room">
            {tp("room", { room: currentRoom?.name ?? roomId })}
          </span>
          <span className="text-xs text-white/40">{tp("controls")}</span>
        </header>

        <div className="pointer-events-auto flex w-full flex-wrap items-end justify-between gap-4">
          <div className="flex w-fit max-w-[min(92vw,40rem)] flex-col gap-3 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
            <span className="text-[0.65rem] uppercase tracking-wide text-white/40">
              {tp("objects")}
            </span>
            <div className="flex flex-wrap gap-2">
              {roomObjects.map((object) => (
                <Button
                  key={object.id}
                  size="xs"
                  variant="overlay"
                  disabled={!worldInputEnabled}
                  onClick={() => setSelected(object.id)}
                >
                  {objectName(object.id)}
                </Button>
              ))}
              {openDoors.map((door) => (
                <Button
                  key={door.id}
                  size="xs"
                  variant="default"
                  disabled={!worldInputEnabled}
                  onClick={() => {
                    if (!door.leadsTo) return;
                    sceneRoomRef.current = door.leadsTo;
                    handleRef.current?.showRoom(door.leadsTo);
                    enterRoom(door.leadsTo, door.position);
                  }}
                >
                  {tp("action.goTo", {
                    room: model.subroomsById[door.leadsTo ?? ""]?.name ?? door.leadsTo ?? "",
                  })}
                </Button>
              ))}
            </div>
          </div>

          <ChatWindow
            messages={snapshot.chat}
            selfId={snapshot.selfId || null}
            connected={connection ? connection.status === "connected" : true}
            error={chatError}
            onSend={sendChat}
          />

          <div className="flex w-64 flex-col gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-white/50">
                {tp("inventory")}
              </span>
              <Button
                size="xs"
                variant="overlay"
                disabled={introOpen || !playing}
                onClick={openInventory}
                data-testid="game-open-inventory"
              >
                {tp("inventoryButton")}
              </Button>
            </div>
            <ul className="flex flex-wrap gap-1.5" data-testid="game-inventory">
              {snapshot.inventory.length === 0 ? (
                <li className="text-[0.7rem] text-white/40">{tp("emptyInventory")}</li>
              ) : (
                snapshot.inventory.map((itemId) => (
                  <li
                    key={itemId}
                    draggable
                    onDragStart={(event) => {
                      setDraggingItem(itemId);
                      event.dataTransfer.setData("text/plain", itemId);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDraggingItem(null)}
                    className="flex cursor-grab items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 py-1 pl-1 pr-2.5 text-[0.7rem] text-amber-100 active:cursor-grabbing"
                  >
                    {renderItemIcon(itemId, 28)}
                    {itemName(itemId)}
                  </li>
                ))
              )}
            </ul>
            <dl className="flex justify-between text-[0.7rem] text-white/60">
              <dt>{tp("stats.puzzles")}</dt>
              <dd className="font-mono text-white/90">
                {solvedCount}/{model.puzzles.length}
              </dd>
            </dl>
            <Button
              size="sm"
              variant="overlay"
              disabled={!playing || !hintPuzzleId}
              onClick={() => setPanel("hints")}
            >
              {tp("action.hints")}
            </Button>
          </div>
        </div>
      </div>

      {/* Jugadores e invitación. Altura total acotada (además del tope del propio
          registro, ticket 6.5): en pantallas de 720 px, con varios jugadores y
          varias líneas de registro a la vez, el aside podía llegar a estirarse
          hasta tapar la barra de objetos (bottom-left) y robarle los clics — le
          pasó a la barra de objetos con `pointer-events`, no solo visualmente. */}
      <aside className="pointer-events-auto absolute left-4 top-40 z-10 flex max-h-52 w-56 flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-white backdrop-blur">
        <span className="text-[0.65rem] uppercase tracking-wide text-white/50">
          {t("lobby.players", { count: snapshot.players.length })}
        </span>
        <ul
          className="flex max-h-20 flex-col gap-1 overflow-y-auto text-xs"
          data-testid="game-players"
        >
          {snapshot.players.map((player) => (
            <li key={player.id} className="flex items-center gap-2">
              <span
                aria-hidden
                className="tint-dot inline-block size-2.5 rounded-full"
                style={{ "--tint": player.tint } as CSSProperties}
              />
              <span className={player.connected ? "text-white/90" : "text-white/40"}>
                {player.name}
                {player.isSelf ? ` (${t("lobby.you")})` : ""}
                {player.isHost ? ` · ${t("lobby.host")}` : ""}
                {player.connected ? "" : ` · ${t("lobby.offline")}`}
              </span>
            </li>
          ))}
        </ul>
        {inviteUrl ? (
          <Button size="xs" variant="overlayGhost" onClick={() => void copyInvite()}>
            {copied ? t("lobby.copied") : t("lobby.invite")}
          </Button>
        ) : null}
        <span className="mt-1 text-[0.65rem] uppercase tracking-wide text-white/50">
          {tp("log.title")}
        </span>
        {/* Tope propio además del de arriba: el registro es lo que más crece
            dentro del aside a lo largo de la partida. */}
        <ul
          className="flex max-h-24 flex-col gap-0.5 overflow-y-auto text-[0.65rem] text-white/70"
          aria-live="polite"
        >
          {log.length === 0 ? <li className="text-white/40">—</li> : null}
          {log.map((entry) => (
            <li key={entry.id}>{entry.text}</li>
          ))}
        </ul>
      </aside>

      {snapshot.phase === "lobby" && snapshot.self ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-4"
          data-testid="game-lobby"
        >
          <div className="pointer-events-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-white/10 bg-slate-950/95 px-6 py-5 text-center text-white shadow-xl">
            <h2 className="text-base font-semibold">{t("lobby.title")}</h2>
            <p className="text-sm text-white/70">
              {t("lobby.players", { count: snapshot.players.length })}
            </p>
            {pack ? (
              <CharacterPicker
                pack={pack}
                occupiedBy={
                  new Set(
                    snapshot.players
                      .filter((player) => !player.isSelf && player.connected)
                      .map((player) => player.characterId),
                  )
                }
                value={self?.characterId}
                onChange={(characterId) => client.selectCharacter(characterId)}
              />
            ) : null}
            {isHost ? (
              <Button onClick={() => client.startGame()} data-testid="game-start">
                {t("lobby.start")}
              </Button>
            ) : (
              <p className="text-sm text-white/60">{t("lobby.waitingHost")}</p>
            )}
            {inviteUrl ? (
              <Button size="sm" variant="overlayGhost" onClick={() => void copyInvite()}>
                {copied ? t("lobby.copied") : t("lobby.invite")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedObject ? (
        <div className="absolute inset-x-4 bottom-52 z-20 mx-auto w-fit max-w-[min(92vw,26rem)] rounded-xl border border-amber-200/30 bg-slate-950/95 px-4 py-3 text-white shadow-xl">
          <span className="block text-[0.65rem] uppercase tracking-wide text-amber-200/70">
            {tp("menu.title")}
          </span>
          <span className="block font-mono text-xs text-white/60">
            {tp("menu.object", { object: selectedObject.id })}
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {(selectedObject.actions ?? ["inspect", "use_item"]).map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "use_item" ? "default" : "overlay"}
                onClick={() => {
                  setSelected(null);
                  if (action === "inspect") inspect(selectedObject.id);
                  else setPickerFor(selectedObject.id);
                }}
              >
                {tp(action === "inspect" ? "menu.inspect" : "menu.useItem")}
              </Button>
            ))}
            {selectedObject.panelPuzzleId &&
            snapshot.puzzles[selectedObject.panelPuzzleId]?.state !== "solved" ? (
              <Button
                size="sm"
                variant="overlay"
                onClick={() => {
                  setSelected(null);
                  openPanel(selectedObject.panelPuzzleId!, selectedObject.id);
                }}
              >
                {tp("menu.openPanel")}
              </Button>
            ) : null}
            <Button size="sm" variant="overlayGhost" onClick={() => setSelected(null)}>
              {tp("menu.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {pickerFor ? (
        <div className="absolute inset-x-4 bottom-52 z-20 mx-auto w-fit max-w-[min(92vw,30rem)] rounded-xl border border-amber-200/30 bg-slate-950/95 px-4 py-3 text-white shadow-xl">
          <span className="block text-[0.65rem] uppercase tracking-wide text-amber-200/70">
            {tp("menu.chooseItem", { object: pickerFor })}
          </span>
          <p className="mt-1 text-[0.7rem] text-white/50">{tp("menu.dragHint")}</p>
          {snapshot.inventory.length === 0 ? (
            <p className="mt-2 text-xs text-white/40">{tp("menu.noItems")}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {snapshot.inventory.map((itemId) => (
                <Button
                  key={itemId}
                  size="sm"
                  variant="overlay"
                  onClick={() => {
                    const target = pickerFor;
                    setPickerFor(null);
                    applyItemUse(itemId, target);
                  }}
                >
                  {renderItemIcon(itemId, 28)}
                  {itemName(itemId)}
                </Button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="overlayGhost"
            className="mt-2"
            onClick={() => setPickerFor(null)}
          >
            {tp("menu.cancel")}
          </Button>
        </div>
      ) : null}

      {dialog ? (
        <Button
          type="button"
          variant="ghost"
          data-testid="game-dialog"
          data-intro={introOpen}
          onClick={() => setDialog(null)}
          className="absolute inset-x-4 bottom-40 z-30 mx-auto block h-auto max-w-2xl cursor-pointer rounded-xl border border-amber-200/40 bg-slate-950/90 px-5 py-4 text-left text-sm whitespace-normal text-white shadow-lg backdrop-blur hover:bg-slate-950/90"
        >
          <span className="block text-[0.65rem] uppercase tracking-wide text-amber-200/70">
            {dialog.id === INTRO_DIALOG_ID ? tp("intro") : tp("dialog")}
          </span>
          {dialog.text}
          <span className="mt-1 block text-[0.65rem] text-white/40">{tp("close")}</span>
        </Button>
      ) : null}

      <Dialog open={imagePanel !== null} onOpenChange={(open) => !open && setImagePanel(null)}>
        <DialogContent
          showCloseButton
          data-testid="game-image-panel"
          className="flex w-[min(92vw,40rem)] max-w-none flex-col items-center gap-3 rounded-2xl border-amber-200/30 bg-slate-950/95 p-5 text-center text-white shadow-2xl"
        >
          <DialogTitle className="sr-only">{tp("inspectImage")}</DialogTitle>
          <DialogDescription className="sr-only">
            {imagePanel?.caption ?? tp("inspectImage")}
          </DialogDescription>
          {imagePanel && pack ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen de inspección servida por el pack, fuera de next/image
            <img
              src={`${pack.baseUrl.replace(/\/$/, "")}/inspect/${imagePanel.image}.png`}
              alt={imagePanel.caption ?? ""}
              className="max-h-[70vh] w-auto max-w-full rounded-lg border border-white/10 object-contain"
            />
          ) : null}
          {imagePanel?.caption ? (
            <p className="text-sm text-white/80">{imagePanel.caption}</p>
          ) : null}
        </DialogContent>
      </Dialog>

      {inventoryOpen ? (
        <div
          data-testid="game-inventory-overlay"
          className="absolute inset-0 z-30 grid place-items-center overflow-auto bg-black/60 p-4"
        >
          {combineView ? (
            <InventoryPanel
              view={combineView}
              items={model.items.map((item) => ({ id: item.id, name: item.name, icon: item.icon }))}
              onCombine={(inputs) => combinePuzzleId && client.combine(inputs, combinePuzzleId)}
              feedback={combineFeedback}
              onClose={closeInventory}
              renderIcon={(item) => renderItemIcon(item.id)}
            />
          ) : (
            <p className="text-sm text-white/70">{t("hud.loadingPanel")}</p>
          )}
        </div>
      ) : null}

      {panel ? (
        <div className="absolute inset-0 z-20 grid place-items-center overflow-auto bg-black/50 p-4">
          <div className="flex flex-col items-end gap-2">
            <Button size="sm" variant="overlayGhost" onClick={closePanel}>
              {tp("close")}
            </Button>
            {panel === "hints" && hintPuzzleId ? (
              <HintPanel
                view={hintView}
                puzzleId={hintPuzzleId}
                onRequest={(puzzleId) => client.requestHint(puzzleId)}
                disabled={!playing}
                error={hintError}
              />
            ) : null}
            {activePuzzle && !activeView ? (
              <p className="text-sm text-white/70">{t("hud.loadingPanel")}</p>
            ) : null}
            {activePuzzle?.type === "hidden_key" && activeView ? (
              <HiddenKeyPanel
                view={activeView as HiddenKeyPublicView}
                onReveal={() => client.attempt(activePuzzle.id, {})}
                feedback={feedback.hidden}
              />
            ) : null}
            {activePuzzle?.type === "code_lock" && activeView ? (
              <CodeLockPanel
                view={activeView as CodeLockPublicView}
                onAttempt={(code) => client.attempt(activePuzzle.id, { code })}
                feedback={feedback.code}
              />
            ) : null}
            {activePuzzle?.type === "simultaneous_plates" && activeView ? (
              <PlatesPanel
                view={activeView as SimultaneousPlatesPublicView}
                onTogglePlate={(objectId, active) => togglePlate(activePuzzle.id, objectId, active)}
                onPlaceBridge={() => placePlatesBridge(activePuzzle.id)}
                feedback={feedback.plates}
              />
            ) : null}
            {activePuzzle?.type === "sliding_puzzle" && activeView ? (
              <SlidingPanel
                view={activeView as SlidingPuzzlePublicView}
                onMove={(move) => client.attempt(activePuzzle.id, { move })}
                baseUrl={pack?.baseUrl}
                feedback={feedback.sliding}
              />
            ) : null}
            {activePuzzle?.type === "memory" && activeView ? (
              <MemoryPanel
                view={activeView as MemoryPublicView}
                onFlip={(flip) => client.attempt(activePuzzle.id, { flip })}
                feedback={feedback.memory}
              />
            ) : null}
            {activePuzzle?.type === "split_clue" && activeView ? (
              <SplitCluePanel
                view={activeView as SplitCluePublicView}
                symbols={activePuzzle.symbols}
                onSubmit={(combination) =>
                  client.attempt(
                    activePuzzle.id,
                    Array.isArray(combination) ? { symbols: combination } : { code: combination },
                  )
                }
                onPlaceBridge={() => placeMirror(activePuzzle.id)}
                feedback={feedback.split}
              />
            ) : null}
            {activePuzzle?.type === "pipes" && activeView ? (
              <PipesPanel
                view={activeView as PipesPuzzlePublicView}
                onRotate={(rotate) => client.attempt(activePuzzle.id, { rotate })}
                onOpenGate={(gate) => client.attempt(activePuzzle.id, { gate })}
                feedback={feedback.pipes}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {children}

      {summary ? (
        <ResultsScreen
          summary={summary}
          exitHref={exitHref}
          signInHref={signInHref}
          className="z-40"
        />
      ) : null}
    </section>
  );
}
