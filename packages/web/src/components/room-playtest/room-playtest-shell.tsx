"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { resolveIconFrame, type RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack, WorldSceneEvent } from "@escaperoom/game-runtime/phaser";
import type { PuzzleDefinition, RoomPackage } from "@escaperoom/shared/schemas";
import type { HintRequestErrorCode } from "@escaperoom/shared/hints";
import type { EngineEffect, EngineResult } from "@escaperoom/shared/engine";
import {
  computeSessionStats,
  createRoomSession,
  type RoomObjectAction,
  type RoomSession,
} from "@escaperoom/shared/session";
import { Button } from "@/components/ui/button";
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
import { HintPanel } from "@/components/hints/hint-panel";
import { ResultsScreen } from "@/components/game/results-screen";
import {
  INTRO_DIALOG_ID,
  isIntroOpen,
  isWorldInputEnabled,
  resolveDialog,
} from "@/lib/playtest-state";
import { reyAldricSteps } from "@/lib/rey-aldric-route";
import type { RoomPlaytestHandle } from "./room-playtest-canvas";

const RoomPlaytestCanvas = dynamic(() => import("./room-playtest-canvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      Cargando el castillo…
    </div>
  ),
});

const PLAYER_ID = "p1";
const COMBINE_PUZZLE = "p-combina";
/** Cadencia del reloj del playtest (cronómetro y `delay` de la victoria). */
const TICK_MS = 500;

export interface RoomPlaytestShellProps {
  model: RuntimeModel;
  /**
   * Contrato completo de la sala. En producción la validación de los puzzles
   * vive en el servidor (`GameRoom`, 2.8); esta ruta es una **previsualización
   * de desarrollo** que ejecuta el mismo `RoomSession` en el cliente para poder
   * recorrer el Rey Aldric sin infraestructura.
   */
  roomPackage: RoomPackage;
  pack?: RoomScenePack;
}

/** Etiqueta legible de una acción de objeto (i18n). */
const ACTION_LABEL: Record<RoomObjectAction, "menu.inspect" | "menu.useItem"> = {
  inspect: "menu.inspect",
  use_item: "menu.useItem",
};

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

/**
 * Playtest del **Rey Aldric completo** (tickets 1.10, 1.14 y 2.8): las 3 salas
 * con las 8 plantillas sobre `RoomSession` —el mismo núcleo autoritativo que
 * ejecuta la `GameRoom` de Colyseus—, sin duplicar su lógica. Cada panel
 * (`CodeLock`, `Plates`, `Sliding`, `Memory`, `SplitClue`, `Pipes`…) recibe la
 * proyección pública real de la sesión y devuelve la intención del jugador.
 *
 * Contrato de UX (specs/04 §4 y §8-UI):
 * - La **intro bloquea** el juego hasta cerrarse (ESC o clic).
 * - La interacción emite la **intención** (`interact`/`use-item`) y `RoomSession`
 *   resuelve diálogo/estado/panel (modo `intentOnly` de 1.13).
 * - Cruzar una puerta solo es posible si el servidor la abrió (`enter-room`).
 * - El **inventario** se abre/cierra con `I` o su botón del HUD.
 * - Placas y mirillas dependen de la **posición**: sus paneles colocan al
 *   jugador sobre la placa o tras la mirilla (en solitario, cáliz y espejo).
 */
export function RoomPlaytestShell({ model, roomPackage, pack }: RoomPlaytestShellProps) {
  const t = useTranslations("Playtest");
  const locale = useLocale();

  const [session] = useState<RoomSession>(() =>
    createRoomSession(roomPackage, { playerIds: [PLAYER_ID], timeLimitSec: 3600, now: Date.now() }),
  );
  const [startRoomId] = useState(() => roomPackage.map.rooms[0]?.id ?? "");
  const [roomId, setRoomId] = useState(startRoomId);
  const [, setVersion] = useState(0);
  const [dialog, setDialog] = useState<{ id: string; text: string } | null>(() => ({
    id: INTRO_DIALOG_ID,
    text: model.dialogsById[INTRO_DIALOG_ID]?.text ?? INTRO_DIALOG_ID,
  }));
  const [panel, setPanel] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [combineFeedback, setCombineFeedback] = useState<InventoryCombineFeedback | null>(null);
  const [feedback, setFeedback] = useState<PanelFeedback>(NO_FEEDBACK);
  const [hintError, setHintError] = useState<HintRequestErrorCode | null>(null);
  const [log, setLog] = useState<string[]>([]);
  /** Objeto seleccionado: menú contextual abierto. */
  const [selected, setSelected] = useState<string | null>(null);
  /** Objeto destino del selector de inventario ("Usar objeto…"). */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [draggingItem, setDraggingItem] = useState<string | null>(null);

  const handleRef = useRef<RoomPlaytestHandle | null>(null);
  const now = useCallback(() => Date.now(), []);
  const rerender = useCallback(() => setVersion((value) => value + 1), []);
  const pushLog = useCallback((entry: string) => {
    setLog((prev) => [entry, ...prev].slice(0, 10));
  }, []);
  const giveFeedback = useCallback(
    <K extends keyof PanelFeedback>(key: K, value: PanelFeedback[K]) =>
      setFeedback((prev) => ({ ...prev, [key]: value })),
    [],
  );

  /** La intro bloquea el juego hasta cerrarse (specs/04 §4). */
  const introOpen = isIntroOpen(dialog);
  /** El mundo solo recibe input si no hay intro, panel ni inventario abiertos. */
  const worldInputEnabled = isWorldInputEnabled({
    introOpen,
    inventoryOpen,
    panelOpen: panel !== null,
  });

  /** Refleja en la escena los cambios de estado que el motor resolvió (efectos). */
  const applyEngineEffects = useCallback((effects: readonly EngineEffect[]) => {
    for (const effect of effects) {
      if (effect.type === "set_object_state") {
        handleRef.current?.setObjectState(effect.objectId, effect.state);
      } else if (effect.type === "unlock_door") {
        handleRef.current?.setObjectState(effect.objectId, "open");
      }
    }
  }, []);

  /**
   * Fija el diálogo a partir de los `show_dialog` del motor. Si no hay ninguno,
   * lo **cierra**: una acción completada nunca deja colgado el diálogo anterior
   * (specs/04 §4).
   */
  const showDialogs = useCallback(
    (dialogIds: readonly string[], fallback?: string) => {
      setDialog(resolveDialog(dialogIds, model.dialogsById, fallback));
    },
    [model],
  );

  /** Aplica un resultado del motor: efectos en la escena, diálogos y registro. */
  const applyResult = useCallback(
    (result: EngineResult | null | undefined, options: { keepDialog?: boolean } = {}) => {
      if (!result) return;
      applyEngineEffects(result.effects);
      const dialogIds = result.effects
        .filter(
          (effect): effect is Extract<EngineEffect, { type: "show_dialog" }> =>
            effect.type === "show_dialog",
        )
        .map((effect) => effect.dialogId);
      if (dialogIds.length > 0 || !options.keepDialog) showDialogs(dialogIds);
      for (const event of result.events) {
        if (event.type === "on_puzzle_solved") pushLog(t("log.solved", { puzzle: event.puzzleId }));
      }
    },
    [applyEngineEffects, showDialogs, pushLog, t],
  );

  useEffect(() => {
    const start = now();
    session.start(start);
    session.spawnPlayer(PLAYER_ID, start);
    rerender();
  }, [session, now, rerender]);

  // Reloj de la partida: cronómetro, avisos y el `delay` de la victoria.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (session.ended) return;
      const result = session.tick(now());
      if (result.effects.length > 0 || session.ended) {
        applyResult(result, { keepDialog: true });
        rerender();
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [session, now, applyResult, rerender]);

  /** Cierra el diálogo (clic o ESC) y, si era la intro, desbloquea el juego. */
  const closeDialog = useCallback(() => setDialog(null), []);

  const openInventory = useCallback(() => {
    if (introOpen) return;
    setSelected(null);
    setPickerFor(null);
    setPanel(null);
    setInventoryOpen(true);
  }, [introOpen]);

  const closeInventory = useCallback(() => setInventoryOpen(false), []);

  // ESC cierra el diálogo (y, en cascada, el inventario y los menús); I abre o
  // cierra el inventario (specs/04 §8-UI).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dialog) {
          setDialog(null);
        } else if (pickerFor) {
          setPickerFor(null);
        } else if (selected) {
          setSelected(null);
        } else if (inventoryOpen) {
          setInventoryOpen(false);
        } else if (panel) {
          setPanel(null);
        }
        return;
      }
      if (event.key === "i" || event.key === "I") {
        if (introOpen || panel !== null) return;
        setSelected(null);
        setPickerFor(null);
        setInventoryOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, pickerFor, selected, inventoryOpen, panel, introOpen]);

  const puzzleById = useCallback(
    (puzzleId: string): PuzzleDefinition | undefined =>
      roomPackage.puzzles.find((puzzle) => puzzle.id === puzzleId),
    [roomPackage],
  );

  /** Mueve al jugador dentro de su habitación (placas y mirillas dependen de ello). */
  const moveTo = useCallback(
    (x: number, y: number) => {
      const result = session.movePlayer(PLAYER_ID, roomId, x, y, now());
      applyResult(result.engine, { keepDialog: true });
      return result;
    },
    [session, roomId, now, applyResult],
  );

  /** Cambia de habitación a través de una puerta abierta (la sesión lo valida). */
  const enterRoom = useCallback(
    (targetRoomId: string, fromScene = false) => {
      const target = roomPackage.map.rooms.find((room) => room.id === targetRoomId);
      const spawn = target?.spawnPoints[0] ?? { x: 0, y: 0 };
      const result = session.movePlayer(PLAYER_ID, targetRoomId, spawn.x, spawn.y, now());
      if (result.outcome !== "moved") {
        pushLog(t("log.roomLocked"));
        if (fromScene) handleRef.current?.showRoom(roomId);
        return;
      }
      if (!fromScene) handleRef.current?.showRoom(targetRoomId);
      setRoomId(targetRoomId);
      setPanel(null);
      setSelected(null);
      applyResult(result.engine);
      pushLog(t("log.enterRoom", { room: model.subroomsById[targetRoomId]?.name ?? targetRoomId }));
      rerender();
    },
    [session, roomPackage, roomId, model, now, applyResult, pushLog, t, rerender],
  );

  /**
   * Abre el panel de un puzzle. Placas y mirillas son mecánicas de posición:
   * el panel de una mirilla coloca al jugador tras ella para que el servidor
   * calcule qué fragmentos ve.
   */
  const openPanel = useCallback(
    (puzzleId: string, fromObjectId?: string) => {
      const puzzle = puzzleById(puzzleId);
      if (!puzzle) return;
      if (puzzle.type === "combine_items") {
        setInventoryOpen(true);
        return;
      }
      if (puzzle.type === "hidden_key" && session.hiddenKeyView(puzzle.id).revealed) return;
      if (puzzle.type === "split_clue") {
        const viewpoint =
          puzzle.viewpoints.find((candidate) => candidate.objectId === fromObjectId) ??
          puzzle.viewpoints[0];
        if (viewpoint) moveTo(viewpoint.zone.x, viewpoint.zone.y);
      }
      setPanel(puzzle.id);
    },
    [puzzleById, session, moveTo],
  );

  /**
   * "Inspeccionar": `RoomSession.interact` resuelve el diálogo/estado/panel. El
   * panel de un `hidden_key` ya revelado no se reabre.
   */
  const inspect = useCallback(
    (objectId: string) => {
      if (introOpen) return;
      const result = session.interact(objectId, now(), PLAYER_ID);
      if (result.rejected) {
        pushLog(t("log.rejected"));
        return;
      }
      applyResult(result.engine);
      const panelId = session.panelForObject(objectId);
      if (panelId) openPanel(panelId, objectId);
      pushLog(t("log.interact", { object: objectId }));
      rerender();
    },
    [session, introOpen, now, applyResult, openPanel, pushLog, t, rerender],
  );

  /** "Usar objeto…" / drag&drop: `RoomSession.useItemOnObject` resuelve regla o puente. */
  const applyItemUse = useCallback(
    (itemId: string, objectId: string) => {
      if (introOpen) return;
      const result = session.useItemOnObject(itemId, objectId, now(), PLAYER_ID);
      if (result.rejected) {
        pushLog(t("log.rejected"));
        return;
      }
      applyResult(result.engine);
      pushLog(t("log.useItem", { item: labelForItem(model, itemId), object: objectId }));
      rerender();
    },
    [session, model, introOpen, now, applyResult, pushLog, t, rerender],
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
        enterRoom(event.roomId, true);
      } else if (event.type === "open-panel") {
        openPanel(event.puzzleId, event.objectId);
      }
    },
    [applyItemUse, enterRoom, openPanel],
  );

  const chooseItem = useCallback(
    (itemId: string) => {
      if (!pickerFor) return;
      setPickerFor(null);
      applyItemUse(itemId, pickerFor);
    },
    [pickerFor, applyItemUse],
  );

  const onReady = useCallback((handle: RoomPlaytestHandle) => {
    handleRef.current = handle;
  }, []);

  const combine = useCallback(
    (inputs: readonly string[]) => {
      if (introOpen) return;
      const result = session.combine(COMBINE_PUZZLE, inputs, now(), PLAYER_ID);
      setCombineFeedback({ outcome: result.result.outcome, output: result.result.output });
      applyResult(result.engine, { keepDialog: true });
      pushLog(t("log.combine", { input: inputs.join(" + ") }));
      rerender();
    },
    [session, introOpen, now, applyResult, pushLog, t, rerender],
  );

  /** Cierra el panel si la acción lo resolvió (acción completada, specs/04 §4). */
  const settlePanel = useCallback(
    (result: EngineResult | null) => {
      applyResult(result);
      if (result?.events.some((event) => event.type === "on_puzzle_solved")) setPanel(null);
      rerender();
    },
    [applyResult, rerender],
  );

  const attemptCode = useCallback(
    (puzzleId: string, code: string) => {
      const result = session.attemptCode(puzzleId, code, now(), PLAYER_ID);
      giveFeedback("code", result.outcome);
      if (result.outcome === "correct") {
        settlePanel(result.engine);
      } else {
        setDialog(null);
        rerender();
      }
    },
    [session, now, giveFeedback, settlePanel, rerender],
  );

  const revealHiddenKey = useCallback(
    (puzzleId: string) => {
      const result = session.revealHiddenKey(puzzleId, now(), PLAYER_ID);
      giveFeedback("hidden", result.outcome);
      settlePanel(result.engine);
    },
    [session, now, giveFeedback, settlePanel],
  );

  /** Pisar/dejar una placa = colocarse encima o volver al centro de la sala. */
  const togglePlate = useCallback(
    (puzzleId: string, plateObjectId: string, active: boolean) => {
      const puzzle = puzzleById(puzzleId);
      if (puzzle?.type !== "simultaneous_plates") return;
      const plate = puzzle.plates.find((candidate) => candidate.objectId === plateObjectId);
      const spawn = roomPackage.map.rooms.find((room) => room.id === roomId)?.spawnPoints[0];
      const target = active ? plate : spawn;
      if (!target) return;
      const moved = moveTo(target.x, target.y);
      const change = moved.plates.find((entry) => entry.plateObjectId === plateObjectId);
      giveFeedback("plates", change?.outcome ?? null);
      if (session.isPuzzleSolved(puzzleId)) setPanel(null);
      rerender();
    },
    [puzzleById, roomPackage, roomId, moveTo, giveFeedback, session, rerender],
  );

  /** Objeto-puente (cáliz): se coloca en la primera placa libre. */
  const placePlatesBridge = useCallback(
    (puzzleId: string) => {
      const puzzle = puzzleById(puzzleId);
      if (puzzle?.type !== "simultaneous_plates" || !puzzle.soloBridgeItemId) return;
      const free = session.platesView(puzzleId).plates.find((plate) => !plate.active);
      if (!free) return;
      const result = session.useItemOnObject(
        puzzle.soloBridgeItemId,
        free.objectId,
        now(),
        PLAYER_ID,
      );
      giveFeedback("plates", result.rejected ? "unavailable" : "activated");
      settlePanel(result.engine);
    },
    [puzzleById, session, now, giveFeedback, settlePanel],
  );

  /** Espejo: se coloca en la mirilla que ocupa el jugador. */
  const placeMirror = useCallback(
    (puzzleId: string) => {
      const puzzle = puzzleById(puzzleId);
      if (puzzle?.type !== "split_clue" || !puzzle.soloBridgeItemId) return;
      const viewpoint = session.viewpointOf(puzzleId, PLAYER_ID) ?? puzzle.viewpoints[0]?.objectId;
      if (!viewpoint) return;
      const result = session.useItemOnObject(puzzle.soloBridgeItemId, viewpoint, now(), PLAYER_ID);
      giveFeedback("split", result.rejected ? "unavailable" : "bridged");
      settlePanel(result.engine);
    },
    [puzzleById, session, now, giveFeedback, settlePanel],
  );

  const requestHint = useCallback(
    (puzzleId: string) => {
      const result = session.requestHint(puzzleId);
      setHintError(result.ok ? null : result.error.code);
      rerender();
    },
    [session, rerender],
  );

  const reset = useCallback(() => {
    window.location.reload();
  }, []);

  const stats = computeSessionStats(session.state, {
    now: now(),
    puzzlesTotal: roomPackage.puzzles.length,
  });
  const inventory = session.inventory(PLAYER_ID);
  const selectedActions = selected ? session.availableActions(selected) : [];
  const selectedPanel = selected ? session.panelForObject(selected) : undefined;
  const steps = reyAldricSteps(session);
  const summary = session.summary(now());
  const currentRoom = model.subroomsById[roomId];
  const roomObjects = (currentRoom?.objects ?? []).filter((object) => object.interactable);
  const openDoors = roomPackage.objects.filter(
    (object) =>
      object.roomId === roomId &&
      object.leadsTo !== undefined &&
      session.objectState(object.id) === "open",
  );
  const hintPuzzleId =
    roomPackage.hints.find((hint) => puzzleById(hint.puzzleId)?.roomId === roomId)?.puzzleId ??
    roomPackage.hints[0]?.puzzleId;
  const activePuzzle = panel ? puzzleById(panel) : undefined;

  return (
    <section className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <RoomPlaytestCanvas
        model={model}
        roomId={startRoomId}
        pack={pack}
        inputEnabled={worldInputEnabled}
        onEvent={onWorldEvent}
        onReady={onReady}
      />

      {draggingItem ? (
        <div className="pointer-events-none absolute inset-x-4 top-24 z-30 mx-auto w-fit rounded-full border border-amber-200/40 bg-slate-950/90 px-4 py-1.5 text-xs text-amber-100 shadow-lg">
          {t("menu.dropHint", { item: labelForItem(model, draggingItem) })}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
        <header className="pointer-events-auto flex w-fit max-w-[min(92vw,44rem)] flex-col gap-1 rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-white backdrop-blur">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{model.meta.title}</span>
            <span className="text-white/50">· {t("badge")}</span>
          </div>
          <span className="text-xs text-amber-100/80" data-testid="playtest-room">
            {t("room", { room: currentRoom?.name ?? roomId })}
          </span>
          <p className="max-w-2xl text-xs text-white/60">{t("subtitle")}</p>
          <span className="text-xs text-white/40">{t("controls")}</span>
        </header>

        <div className="pointer-events-auto flex w-full flex-wrap items-end justify-between gap-4">
          <div className="flex w-fit max-w-[min(92vw,44rem)] flex-col gap-3 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-white/50">{t("steps")}</span>
              <span
                className={
                  summary?.result === "victory"
                    ? "text-xs text-emerald-300"
                    : "text-xs text-white/50"
                }
              >
                {summary?.result === "victory" ? t("complete") : t("inProgress")}
              </span>
            </div>

            <ol className="flex flex-wrap gap-1.5" data-testid="playtest-steps">
              {steps.map((step, index) => (
                <li
                  key={step.id}
                  data-done={step.done}
                  className={
                    step.done
                      ? "rounded-full border border-emerald-300/50 bg-emerald-300/10 px-2.5 py-0.5 text-[0.7rem] text-emerald-100"
                      : "rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[0.7rem] text-white/60"
                  }
                >
                  {index + 1}. {t(`step.${step.id}`)}
                </li>
              ))}
            </ol>

            <span className="text-[0.65rem] uppercase tracking-wide text-white/40">
              {t("objects")}
            </span>
            <div className="flex flex-wrap gap-2">
              {roomObjects.map((object) => (
                <Button
                  key={object.id}
                  size="xs"
                  variant="overlay"
                  disabled={introOpen}
                  onClick={() => setSelected(object.id)}
                >
                  {object.id}
                </Button>
              ))}
              {openDoors.map((door) => (
                <Button
                  key={door.id}
                  size="xs"
                  variant="default"
                  disabled={introOpen}
                  onClick={() => door.leadsTo && enterRoom(door.leadsTo)}
                >
                  {t("action.goTo", {
                    room: model.subroomsById[door.leadsTo ?? ""]?.name ?? door.leadsTo ?? "",
                  })}
                </Button>
              ))}
              <Button size="xs" variant="overlayGhost" onClick={reset}>
                {t("action.reset")}
              </Button>
            </div>
          </div>

          <div className="flex w-64 flex-col gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-white/50">
                {t("inventory")}
              </span>
              <Button
                size="xs"
                variant="overlay"
                disabled={introOpen}
                onClick={openInventory}
                data-testid="playtest-open-inventory"
              >
                {t("inventoryButton")}
              </Button>
            </div>
            <ul className="flex flex-wrap gap-1.5" data-testid="playtest-inventory">
              {inventory.length === 0 ? (
                <li className="text-[0.7rem] text-white/40">{t("emptyInventory")}</li>
              ) : (
                inventory.map((itemId) => (
                  <li
                    key={itemId}
                    draggable
                    onDragStart={(event) => {
                      setDraggingItem(itemId);
                      event.dataTransfer.setData("text/plain", itemId);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDraggingItem(null)}
                    className="flex cursor-grab items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[0.7rem] text-amber-100 active:cursor-grabbing"
                  >
                    <ItemIcon
                      frame={resolveIconFrame(pack?.manifest, model.itemsById[itemId]?.icon ?? "")}
                      baseUrl={pack?.baseUrl}
                      name={labelForItem(model, itemId)}
                      size={16}
                    />
                    <Button
                      type="button"
                      variant="link"
                      onClick={openInventory}
                      className="h-auto p-0 text-[0.7rem] text-amber-100"
                    >
                      {labelForItem(model, itemId)}
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <dl className="flex justify-between text-[0.7rem] text-white/60">
              <dt>{t("stats.puzzles")}</dt>
              <dd className="font-mono text-white/90">
                {stats.puzzlesSolved}/{stats.puzzlesTotal}
              </dd>
            </dl>
            <dl className="flex justify-between text-[0.7rem] text-white/60">
              <dt>{t("stats.items")}</dt>
              <dd className="font-mono text-white/90">{stats.itemsCollected}</dd>
            </dl>
            <Button size="sm" variant="overlay" onClick={() => setPanel("hints")}>
              {t("action.hints")}
            </Button>
          </div>
        </div>
      </div>

      {selected ? (
        <div className="absolute inset-x-4 bottom-52 z-20 mx-auto w-fit max-w-[min(92vw,26rem)] rounded-xl border border-amber-200/30 bg-slate-950/95 px-4 py-3 text-white shadow-xl">
          <span className="block text-[0.65rem] uppercase tracking-wide text-amber-200/70">
            {t("menu.title")}
          </span>
          <span className="block font-mono text-xs text-white/60">
            {t("menu.object", { object: selected })}
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedActions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "use_item" ? "default" : "overlay"}
                onClick={() => {
                  setSelected(null);
                  if (action === "inspect") {
                    inspect(selected);
                  } else {
                    setPickerFor(selected);
                  }
                }}
              >
                {t(ACTION_LABEL[action])}
              </Button>
            ))}
            {selectedPanel ? (
              <Button
                size="sm"
                variant="overlay"
                onClick={() => {
                  setSelected(null);
                  openPanel(selectedPanel, selected);
                }}
              >
                {t("menu.openPanel")}
              </Button>
            ) : null}
            <Button size="sm" variant="overlayGhost" onClick={() => setSelected(null)}>
              {t("menu.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {pickerFor ? (
        <div className="absolute inset-x-4 bottom-52 z-20 mx-auto w-fit max-w-[min(92vw,30rem)] rounded-xl border border-amber-200/30 bg-slate-950/95 px-4 py-3 text-white shadow-xl">
          <span className="block text-[0.65rem] uppercase tracking-wide text-amber-200/70">
            {t("menu.chooseItem", { object: pickerFor })}
          </span>
          <p className="mt-1 text-[0.7rem] text-white/50">{t("menu.dragHint")}</p>
          {inventory.length === 0 ? (
            <p className="mt-2 text-xs text-white/40">{t("menu.noItems")}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {inventory.map((itemId) => (
                <Button key={itemId} size="sm" variant="overlay" onClick={() => chooseItem(itemId)}>
                  <ItemIcon
                    frame={resolveIconFrame(pack?.manifest, model.itemsById[itemId]?.icon ?? "")}
                    baseUrl={pack?.baseUrl}
                    name={labelForItem(model, itemId)}
                    size={16}
                  />
                  {labelForItem(model, itemId)}
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
            {t("menu.cancel")}
          </Button>
        </div>
      ) : null}

      {dialog ? (
        <Button
          type="button"
          variant="ghost"
          data-testid="playtest-dialog"
          data-intro={introOpen}
          onClick={closeDialog}
          className="absolute inset-x-4 bottom-40 z-30 mx-auto block h-auto max-w-2xl cursor-pointer rounded-xl border border-amber-200/40 bg-slate-950/90 px-5 py-4 text-left text-sm whitespace-normal text-white shadow-lg backdrop-blur hover:bg-slate-950/90"
        >
          <span className="block text-[0.65rem] uppercase tracking-wide text-amber-200/70">
            {introOpen ? t("intro") : t("dialog")}
          </span>
          {dialog.text}
          <span className="mt-1 block text-[0.65rem] text-white/40">{t("close")}</span>
        </Button>
      ) : null}

      {inventoryOpen ? (
        <div
          data-testid="playtest-inventory-overlay"
          className="absolute inset-0 z-30 grid place-items-center overflow-auto bg-black/60 p-4"
        >
          <InventoryPanel
            view={session.combineItemsView(COMBINE_PUZZLE, PLAYER_ID)}
            items={model.items.map((item) => ({
              id: item.id,
              name: item.name,
              icon: item.icon,
            }))}
            onCombine={combine}
            feedback={combineFeedback}
            onClose={closeInventory}
            renderIcon={(item) => (
              <ItemIcon
                frame={resolveIconFrame(pack?.manifest, item.icon ?? "")}
                baseUrl={pack?.baseUrl}
                name={item.name}
              />
            )}
          />
        </div>
      ) : null}

      {panel ? (
        <div className="absolute inset-0 z-20 grid place-items-center overflow-auto bg-black/50 p-4">
          <div className="flex flex-col items-end gap-2">
            <Button size="sm" variant="overlayGhost" onClick={() => setPanel(null)}>
              {t("close")}
            </Button>
            {activePuzzle?.type === "hidden_key" ? (
              <HiddenKeyPanel
                view={session.hiddenKeyView(activePuzzle.id)}
                onReveal={() => revealHiddenKey(activePuzzle.id)}
                feedback={feedback.hidden}
              />
            ) : null}
            {activePuzzle?.type === "code_lock" ? (
              <CodeLockPanel
                view={session.codeLockView(activePuzzle.id)}
                onAttempt={(code) => attemptCode(activePuzzle.id, code)}
                feedback={feedback.code}
              />
            ) : null}
            {activePuzzle?.type === "simultaneous_plates" ? (
              <PlatesPanel
                view={session.platesView(activePuzzle.id, now())}
                onTogglePlate={(objectId, active) => togglePlate(activePuzzle.id, objectId, active)}
                onPlaceBridge={() => placePlatesBridge(activePuzzle.id)}
                feedback={feedback.plates}
              />
            ) : null}
            {activePuzzle?.type === "sliding_puzzle" ? (
              <SlidingPanel
                view={session.slidingView(activePuzzle.id)}
                onMove={(index) => {
                  const result = session.moveSlidingTile(activePuzzle.id, index, now(), PLAYER_ID);
                  giveFeedback("sliding", result.outcome);
                  settlePanel(result.engine);
                }}
                baseUrl={pack?.baseUrl}
                feedback={feedback.sliding}
              />
            ) : null}
            {activePuzzle?.type === "memory" ? (
              <MemoryPanel
                view={session.memoryView(activePuzzle.id)}
                onFlip={(cardId) => {
                  const result = session.flipMemoryCard(activePuzzle.id, cardId, now(), PLAYER_ID);
                  giveFeedback("memory", result.outcome);
                  settlePanel(result.engine);
                }}
                feedback={feedback.memory}
              />
            ) : null}
            {activePuzzle?.type === "split_clue" ? (
              <SplitCluePanel
                view={session.splitClueView(activePuzzle.id, PLAYER_ID)}
                onSubmit={(combination) => {
                  const result = session.submitSplitClue(
                    activePuzzle.id,
                    combination,
                    now(),
                    PLAYER_ID,
                  );
                  giveFeedback("split", result.outcome);
                  settlePanel(result.engine);
                }}
                onPlaceBridge={() => placeMirror(activePuzzle.id)}
                feedback={feedback.split}
              />
            ) : null}
            {activePuzzle?.type === "pipes" ? (
              <PipesPanel
                view={session.pipesView(activePuzzle.id)}
                onRotate={(index) => {
                  const result = session.rotatePipe(activePuzzle.id, index, now(), PLAYER_ID);
                  giveFeedback("pipes", result.outcome);
                  settlePanel(result.engine);
                }}
                onOpenGate={(index) => {
                  const result = session.openPipesGate(activePuzzle.id, index, now(), PLAYER_ID);
                  giveFeedback("pipes", result.outcome);
                  settlePanel(result.engine);
                }}
                feedback={feedback.pipes}
              />
            ) : null}
            {panel === "hints" && hintPuzzleId ? (
              <HintPanel
                view={session.hintView(locale)}
                puzzleId={hintPuzzleId}
                onRequest={requestHint}
                error={hintError}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {summary ? <ResultsScreen summary={summary} /> : null}

      <div className="pointer-events-none absolute right-4 top-4 w-52 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-white backdrop-blur">
        <span className="text-[0.65rem] uppercase tracking-wide text-white/50">
          {t("log.title")}
        </span>
        <ul className="mt-1 flex flex-col gap-0.5 text-[0.65rem] text-white/70">
          {log.length === 0 ? <li className="text-white/40">—</li> : null}
          {log.map((entry, index) => (
            <li key={`${entry}-${index}`}>{entry}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function labelForItem(model: RuntimeModel, itemId: string): string {
  return model.itemsById[itemId]?.name ?? itemId;
}
