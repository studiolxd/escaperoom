"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack, WorldSceneEvent } from "@escaperoom/game-runtime/phaser";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import type { HintRequestErrorCode } from "@escaperoom/shared/hints";
import type { RoomObjectAction } from "@escaperoom/shared/session";
import type { EngineEffect } from "@escaperoom/shared/engine";
import {
  computeSessionStats,
  createRoomSession,
  type RoomSession,
} from "@escaperoom/shared/session";
import { Button } from "@/components/ui/button";
import { CodeLockPanel, type CodeLockFeedback } from "@/components/puzzles/code-lock-panel";
import { HiddenKeyPanel, type HiddenKeyFeedback } from "@/components/puzzles/hidden-key-panel";
import {
  InventoryPanel,
  type InventoryCombineFeedback,
} from "@/components/puzzles/inventory-panel";
import { HintPanel } from "@/components/hints/hint-panel";
import type { RoomPlaytestHandle } from "./room-playtest-canvas";

const RoomPlaytestCanvas = dynamic(() => import("./room-playtest-canvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      Cargando el Salón del Trono…
    </div>
  ),
});

const ARCA_HINTS_PUZZLE = "p-candado-arca";

export interface RoomPlaytestShellProps {
  model: RuntimeModel;
  /**
   * Contrato completo de la sala. En producción la validación de los puzzles
   * vive en el servidor (1.6); esta ruta es una **previsualización de desarrollo**
   * que ejecuta las plantillas puras en el cliente para poder recorrer la Sala 1
   * sin infraestructura.
   */
  roomPackage: RoomPackage;
  pack?: RoomScenePack;
}

/** Etiqueta legible de una acción de objeto (i18n). */
const ACTION_LABEL: Record<RoomObjectAction, "menu.inspect" | "menu.useItem"> = {
  inspect: "menu.inspect",
  use_item: "menu.useItem",
};

/**
 * Playtest de la Sala 1 (ticket 1.10): reutiliza el runtime isométrico (1.2), los
 * objetos (1.3), el motor (1.4), las plantillas (1.5–1.7), las pistas (1.8) y las
 * stats (1.9) a través de `RoomSession`, sin duplicar su lógica.
 *
 * Interacción (ticket 1.13): la escena **no** resuelve nada; emite la intención
 * (`interact` / `use-item`) y este overlay la resuelve con `RoomSession`
 * (diálogo, estado del mundo y panel). Al seleccionar un objeto (Espacio cerca o
 * clic) se abre un **menú contextual** con las acciones que el motor declara
 * para él (`session.availableActions`): `Inspeccionar` y/o `Usar objeto…`. El
 * armario se abre por las tres vías: menú desde Espacio, menú desde clic y
 * arrastrando la llave sobre el objeto (drag&drop).
 */
export function RoomPlaytestShell({ model, roomPackage, pack }: RoomPlaytestShellProps) {
  const t = useTranslations("Playtest");
  const locale = useLocale();

  const [session] = useState<RoomSession>(() =>
    createRoomSession(roomPackage, { playerIds: ["p1"], timeLimitSec: 3600 }),
  );
  const [, setVersion] = useState(0);
  const [dialog, setDialog] = useState<{ id: string; text: string } | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [combineFeedback, setCombineFeedback] = useState<InventoryCombineFeedback | null>(null);
  const [codeFeedback, setCodeFeedback] = useState<CodeLockFeedback>(null);
  const [hiddenFeedback, setHiddenFeedback] = useState<HiddenKeyFeedback>(null);
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

  useEffect(() => {
    session.start(now());
    setDialog({ id: "d-intro", text: model.dialogsById["d-intro"]?.text ?? "d-intro" });
    rerender();
  }, [session, model, now, rerender]);

  const showDialogs = useCallback(
    (dialogIds: readonly string[], fallback?: string) => {
      const last = dialogIds.at(-1);
      if (last) {
        setDialog({ id: last, text: model.dialogsById[last]?.text ?? fallback ?? last });
      } else if (fallback) {
        setDialog({ id: "", text: fallback });
      }
    },
    [model],
  );

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
   * "Inspeccionar": `RoomSession.interact` resuelve el diálogo/estado/panel. El
   * panel de un `hidden_key` ya revelado no se reabre (evita repetir
   * "¡has encontrado…!" al inspeccionar el cuadro por segunda vez).
   */
  const inspect = useCallback(
    (objectId: string) => {
      const result = session.interact(objectId, now());
      showDialogs(result.dialogIds);
      applyEngineEffects(result.engine.effects);
      const panelId = session.panelForObject(objectId);
      if (panelId && shouldOpenPanel(session, roomPackage, panelId)) {
        setPanel(panelId);
      }
      pushLog(t("log.interact", { object: objectId }));
      rerender();
    },
    [session, roomPackage, now, showDialogs, applyEngineEffects, pushLog, t, rerender],
  );

  /** "Usar objeto…" / drag&drop: `RoomSession.useItemOnObject` resuelve la regla. */
  const useItem = useCallback(
    (itemId: string, objectId: string) => {
      const result = session.useItemOnObject(itemId, objectId, now());
      showDialogs(result.dialogIds);
      applyEngineEffects(result.engine.effects);
      pushLog(t("log.useItem", { item: labelForItem(model, itemId), object: objectId }));
      rerender();
    },
    [session, model, now, showDialogs, applyEngineEffects, pushLog, t, rerender],
  );

  const onWorldEvent = useCallback(
    (event: WorldSceneEvent) => {
      if (event.type === "interact") {
        setSelected(event.objectId);
      } else if (event.type === "use-item") {
        setSelected(null);
        setPickerFor(null);
        useItem(event.itemId, event.objectId);
      } else if (event.type === "open-panel") {
        setPanel(event.puzzleId);
      }
    },
    [useItem],
  );

  const chooseItem = useCallback(
    (itemId: string) => {
      if (!pickerFor) return;
      setPickerFor(null);
      useItem(itemId, pickerFor);
    },
    [pickerFor, useItem],
  );

  const onReady = useCallback((handle: RoomPlaytestHandle) => {
    handleRef.current = handle;
  }, []);

  const combine = useCallback(
    (inputs: readonly string[]) => {
      const result = session.combine("p-combina", inputs, now());
      setCombineFeedback({ outcome: result.result.outcome, output: result.result.output });
      pushLog(t("log.combine", { input: inputs.join(" + ") }));
      rerender();
    },
    [session, now, pushLog, t, rerender],
  );

  const attemptCode = useCallback(
    (code: string) => {
      const result = session.attemptCode(ARCA_HINTS_PUZZLE, code, now());
      setCodeFeedback(result.outcome);
      if (result.outcome === "correct") {
        showDialogs(
          result.engine?.effects
            .filter((effect) => effect.type === "show_dialog")
            .map((effect) => effect.dialogId) ?? [],
        );
        if (result.engine) applyEngineEffects(result.engine.effects);
        pushLog(t("log.arcaOpen"));
      }
      rerender();
    },
    [session, now, showDialogs, applyEngineEffects, pushLog, t, rerender],
  );

  const revealHiddenKey = useCallback(() => {
    const result = session.revealHiddenKey("p-llave-cuadro", now());
    setHiddenFeedback(result.outcome);
    if (result.engine) applyEngineEffects(result.engine.effects);
    rerender();
  }, [session, now, applyEngineEffects, rerender]);

  const solvePlates = useCallback(() => {
    const result = session.solveWorldPuzzle("p-placas-estatuas", now());
    if (result) {
      showDialogs(
        result.effects
          .filter((effect) => effect.type === "show_dialog")
          .map((effect) => effect.dialogId),
      );
      applyEngineEffects(result.effects);
      pushLog(t("log.plates"));
    }
    rerender();
  }, [session, now, showDialogs, applyEngineEffects, pushLog, t, rerender]);

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
  const inventory = session.inventory();
  const selectedActions = selected ? session.availableActions(selected) : [];
  const steps = [
    { id: "cuadro", done: session.isPuzzleSolved("p-llave-cuadro") },
    { id: "armario", done: session.objectState("armario") === "open" },
    { id: "combina", done: session.combineItemsView("p-combina").appliedRecipeCount >= 1 },
    { id: "brasero", done: session.objectState("brasero") === "lit" },
    { id: "arca", done: session.isPuzzleSolved(ARCA_HINTS_PUZZLE) },
    { id: "placas", done: session.isPuzzleSolved("p-placas-estatuas") },
  ];
  const sala1Complete = steps.every((step) => step.done);

  return (
    <section className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <RoomPlaytestCanvas
        model={model}
        roomId="salon-trono"
        pack={pack}
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
          <p className="max-w-2xl text-xs text-white/60">{t("subtitle")}</p>
          <span className="text-xs text-white/40">{t("controls")}</span>
        </header>

        <div className="pointer-events-auto flex w-full flex-wrap items-end justify-between gap-4">
          <div className="flex w-fit max-w-[min(92vw,40rem)] flex-col gap-3 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-white/50">{t("steps")}</span>
              <span
                className={sala1Complete ? "text-xs text-emerald-300" : "text-xs text-white/50"}
              >
                {sala1Complete ? t("complete") : t("inProgress")}
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

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => inspect("cuadro-aurelio")}>
                {t("action.cuadro")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelected("armario")}>
                {t("action.armario")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPanel("p-combina")}>
                {t("action.combina")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => inspect("brasero")}>
                {t("action.brasero")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPanel(ARCA_HINTS_PUZZLE)}>
                {t("action.arca")}
              </Button>
              <Button size="sm" variant="outline" onClick={solvePlates}>
                {t("action.placas")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/10"
                onClick={reset}
              >
                {t("action.reset")}
              </Button>
            </div>
          </div>

          <div className="flex w-64 flex-col gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
            <span className="text-xs uppercase tracking-wide text-white/50">{t("inventory")}</span>
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
                    className="cursor-grab rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[0.7rem] text-amber-100 active:cursor-grabbing"
                  >
                    {labelForItem(model, itemId)}
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
            <Button size="sm" variant="outline" onClick={() => setPanel("hints")}>
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
                variant={action === "use_item" ? "default" : "outline"}
                onClick={() => {
                  if (action === "inspect") {
                    setSelected(null);
                    inspect(selected);
                  } else {
                    setSelected(null);
                    setPickerFor(selected);
                  }
                }}
              >
                {t(ACTION_LABEL[action])}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10"
              onClick={() => setSelected(null)}
            >
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
                <Button key={itemId} size="sm" variant="outline" onClick={() => chooseItem(itemId)}>
                  {labelForItem(model, itemId)}
                </Button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 text-white hover:bg-white/10"
            onClick={() => setPickerFor(null)}
          >
            {t("menu.cancel")}
          </Button>
        </div>
      ) : null}

      {dialog ? (
        <button
          type="button"
          onClick={() => setDialog(null)}
          className="absolute inset-x-4 bottom-40 mx-auto max-w-2xl cursor-pointer rounded-xl border border-amber-200/40 bg-slate-950/90 px-5 py-4 text-left text-sm text-white shadow-lg backdrop-blur"
        >
          <span className="block text-[0.65rem] uppercase tracking-wide text-amber-200/70">
            {t("dialog")}
          </span>
          {dialog.text}
          <span className="mt-1 block text-[0.65rem] text-white/40">{t("close")}</span>
        </button>
      ) : null}

      {panel ? (
        <div className="absolute inset-0 z-10 grid place-items-center overflow-auto bg-black/50 p-4">
          <div className="flex flex-col items-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10"
              onClick={() => setPanel(null)}
            >
              {t("close")}
            </Button>
            {panel === "p-llave-cuadro" ? (
              <HiddenKeyPanel
                view={session.hiddenKeyView("p-llave-cuadro")}
                onReveal={revealHiddenKey}
                feedback={hiddenFeedback}
              />
            ) : null}
            {panel === "p-combina" ? (
              <InventoryPanel
                view={session.combineItemsView("p-combina")}
                items={model.items.map((item) => ({
                  id: item.id,
                  name: item.name,
                  icon: item.icon,
                }))}
                onCombine={(a, b) => combine([a, b])}
                feedback={combineFeedback}
              />
            ) : null}
            {panel === ARCA_HINTS_PUZZLE ? (
              <CodeLockPanel
                view={session.codeLockView(ARCA_HINTS_PUZZLE)}
                onAttempt={attemptCode}
                feedback={codeFeedback}
              />
            ) : null}
            {panel === "hints" ? (
              <HintPanel
                view={session.hintView(locale)}
                puzzleId={ARCA_HINTS_PUZZLE}
                onRequest={requestHint}
                error={hintError}
              />
            ) : null}
          </div>
        </div>
      ) : null}

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

/** El panel de un `hidden_key` ya revelado no se reabre (interacción resuelta). */
function shouldOpenPanel(session: RoomSession, roomPackage: RoomPackage, panelId: string): boolean {
  const puzzle = roomPackage.puzzles.find((candidate) => candidate.id === panelId);
  if (puzzle?.type === "hidden_key" && session.hiddenKeyView(puzzle.id).revealed) {
    return false;
  }
  return true;
}

function labelForItem(model: RuntimeModel, itemId: string): string {
  return model.itemsById[itemId]?.name ?? itemId;
}
