"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack, WorldSceneEvent } from "@escaperoom/game-runtime/phaser";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import type { HintRequestErrorCode } from "@escaperoom/shared/hints";
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

/**
 * Playtest de la Sala 1 (ticket 1.10): reutiliza el runtime isométrico (1.2), los
 * objetos (1.3), el motor (1.4), las plantillas (1.5–1.7), las pistas (1.8) y las
 * stats (1.9) a través de `RoomSession`, sin duplicar su lógica. El canvas mueve
 * al avatar con el teclado y permite inspeccionar con el ratón; el overlay ofrece
 * el guion de la sala y los paneles de cada puzzle.
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

  const interact = useCallback(
    (objectId: string) => {
      const result = session.interact(objectId, now());
      showDialogs(result.dialogIds);
      setPanel(session.panelForObject(objectId) ?? null);
      pushLog(t("log.interact", { object: objectId }));
      rerender();
    },
    [session, now, showDialogs, pushLog, t, rerender],
  );

  const onWorldEvent = useCallback(
    (event: WorldSceneEvent) => {
      if (event.type === "dialog") {
        interact(event.objectId);
      } else if (event.type === "open-panel") {
        setPanel(event.puzzleId);
      }
    },
    [interact],
  );

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
        pushLog(t("log.arcaOpen"));
      }
      rerender();
    },
    [session, now, showDialogs, pushLog, t, rerender],
  );

  const revealHiddenKey = useCallback(() => {
    const result = session.revealHiddenKey("p-llave-cuadro", now());
    setHiddenFeedback(result.outcome);
    rerender();
  }, [session, now, rerender]);

  const solvePlates = useCallback(() => {
    const result = session.solveWorldPuzzle("p-placas-estatuas", now());
    if (result) {
      showDialogs(
        result.effects
          .filter((effect) => effect.type === "show_dialog")
          .map((effect) => effect.dialogId),
      );
      pushLog(t("log.plates"));
    }
    rerender();
  }, [session, now, showDialogs, pushLog, t, rerender]);

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
      <RoomPlaytestCanvas model={model} roomId="salon-trono" pack={pack} onEvent={onWorldEvent} />

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
              <Button size="sm" variant="outline" onClick={() => interact("cuadro-aurelio")}>
                {t("action.cuadro")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => interact("armario")}>
                {t("action.armario")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPanel("p-combina")}>
                {t("action.combina")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => interact("brasero")}>
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
                    className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[0.7rem] text-amber-100"
                  >
                    {model.itemsById[itemId]?.name ?? itemId}
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
