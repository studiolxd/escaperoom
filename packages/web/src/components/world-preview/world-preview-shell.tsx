"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { WorldSceneEvent } from "@escaperoom/game-runtime/phaser";
import { Button } from "@/components/ui/button";
import type { WorldPreviewHandle } from "./world-preview-canvas";

const WorldPreviewCanvas = dynamic(() => import("./world-preview-canvas"), {
  ssr: false,
  loading: () => <WorldPreviewCanvasLoading />,
});

function WorldPreviewCanvasLoading() {
  const t = useTranslations("WorldPreview");
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      {t("loadingRuntime")}
    </div>
  );
}

/**
 * Previsualización del sistema de objetos (ticket 1.3): Phaser pinta el mundo
 * (hover/brillo, estados, animaciones) y este overlay React muestra los
 * diálogos y los paneles que la escena anuncia por `world:event` (specs/03 §3).
 */
export function WorldPreviewShell({ model }: { model: RuntimeModel }) {
  const t = useTranslations("WorldPreview");
  const handleRef = useRef<WorldPreviewHandle | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const onEvent = useCallback(
    (event: WorldSceneEvent) => {
      if (event.type === "dialog") {
        setDialog(event.text);
      } else if (event.type === "open-panel") {
        setPanel(event.puzzleId);
      } else if (event.type === "collect") {
        setLog((prev) => [t("log.collect", { items: event.items.join(", ") }), ...prev].slice(0, 8));
      } else if (event.type === "state") {
        setLog((prev) =>
          [t("log.state", { object: event.objectId, state: event.state }), ...prev].slice(0, 8),
        );
      }
    },
    [t],
  );

  const onReady = useCallback((handle: WorldPreviewHandle) => {
    handleRef.current = handle;
  }, []);

  return (
    <section className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <WorldPreviewCanvas model={model} onEvent={onEvent} onReady={onReady} />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
        <header className="pointer-events-auto flex w-fit max-w-[min(92vw,44rem)] flex-col gap-1 rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-white backdrop-blur">
          <span className="text-sm font-medium">{model.meta.title}</span>
          <p className="max-w-2xl text-xs text-white/60">{model.meta.description}</p>
          <span className="text-xs text-white/40">{t("hint")}</span>
        </header>

        <div className="flex items-end justify-between gap-4">
          <div className="pointer-events-auto flex w-fit max-w-[min(92vw,44rem)] flex-col gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
            <span className="text-xs uppercase tracking-wide text-white/50">{t("actions")}</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="overlay"
                onClick={() => handleRef.current?.inspectObject("cuadro")}
              >
                {t("action.inspectCuadro")}
              </Button>
              <Button
                size="sm"
                variant="overlay"
                onClick={() => handleRef.current?.inspectObject("cofre")}
              >
                {t("action.inspectCofre")}
              </Button>
              <Button
                size="sm"
                variant="overlay"
                onClick={() => handleRef.current?.setObjectState("cofre", "open")}
              >
                {t("action.openCofre")}
              </Button>
              <Button
                size="sm"
                variant="overlay"
                onClick={() => handleRef.current?.setObjectState("brasero", "lit")}
              >
                {t("action.lightBrasero")}
              </Button>
              <Button
                size="sm"
                variant="overlay"
                onClick={() => handleRef.current?.inspectObject("palanca")}
              >
                {t("action.palanca")}
              </Button>
            </div>
          </div>

          <div className="pointer-events-auto w-56 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
            <span className="text-xs uppercase tracking-wide text-white/50">{t("events")}</span>
            <ul className="mt-1 flex flex-col gap-0.5 text-[0.7rem] text-white/70">
              {log.length === 0 ? <li className="text-white/40">—</li> : null}
              {log.map((entry, index) => (
                <li key={`${entry}-${index}`}>{entry}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {dialog ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setDialog(null)}
          className="absolute inset-x-4 bottom-4 mx-auto block h-auto max-w-2xl cursor-pointer rounded-xl border border-amber-200/40 bg-slate-950/90 px-5 py-4 text-left text-sm whitespace-normal text-white shadow-lg backdrop-blur hover:bg-slate-950/90"
        >
          <span className="block text-[0.65rem] uppercase tracking-wide text-amber-200/70">
            {t("dialogTitle")}
          </span>
          {dialog}
          <span className="mt-1 block text-[0.65rem] text-white/40">{t("clickToClose")}</span>
        </Button>
      ) : null}

      {panel ? (
        <div className="absolute inset-0 grid place-items-center bg-black/40">
          <div className="flex w-fit flex-col gap-3 rounded-xl border border-white/15 bg-slate-950/95 px-6 py-5 text-white shadow-xl">
            <span className="text-[0.65rem] uppercase tracking-wide text-white/50">
              {t("panelMountedTitle")}
            </span>
            <span className="font-mono text-sm">{panel}</span>
            <p className="max-w-xs text-xs text-white/60">{t("panelExplain")}</p>
            <Button size="sm" onClick={() => setPanel(null)}>
              {t("closePanel")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
