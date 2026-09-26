"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import { RoomRuntime, type RoomSceneLabels, type WorldSceneEvent } from "@escaperoom/game-runtime/phaser";

/** Handle imperativo para disparar interacciones desde el overlay React. */
export interface WorldPreviewHandle {
  inspectObject(objectId: string): void;
  setObjectState(objectId: string, state: string): void;
}

/**
 * Monta el runtime Phaser de objetos (ticket 1.3) con el diálogo dibujado en
 * React (`dialogOverlay: false`). Reenvía cada `world:event` al overlay y expone
 * un handle para inspeccionar/cambiar estado desde botones.
 */
export default function WorldPreviewCanvas({
  model,
  onEvent,
  onReady,
}: {
  model: RuntimeModel;
  onEvent: (event: WorldSceneEvent) => void;
  onReady?: (handle: WorldPreviewHandle) => void;
}) {
  const t = useTranslations("RoomScene.labels");
  const containerRemaining = t("containerRemaining");
  const containerEmpty = t("containerEmpty");
  const containerReceived = t("containerReceived");
  const openPanelLabel = t("openPanel");
  // `useMemo` (no un objeto literal): un `RoomRuntime` nuevo por render
  // reconstruiría la sala entera (F-21/F-22); solo cambia si cambia el texto.
  const labels: Partial<RoomSceneLabels> = useMemo(
    () => ({
      containerRemaining,
      containerEmpty,
      containerReceived,
      openPanel: openPanelLabel,
    }),
    [containerRemaining, containerEmpty, containerReceived, openPanelLabel],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RoomRuntime | null>(null);
  const onEventRef = useRef(onEvent);
  const onReadyRef = useRef(onReady);
  onEventRef.current = onEvent;
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || runtimeRef.current) {
      return;
    }

    const runtime = new RoomRuntime(container, model, {
      dialogOverlay: false,
      localPlayerId: "p1",
      labels,
    });
    runtimeRef.current = runtime;
    const off = runtime.onWorldEvent((event) => onEventRef.current(event));
    onReadyRef.current?.({
      inspectObject: (objectId) => runtime.inspectObject(objectId),
      setObjectState: (objectId, state) => runtime.setObjectState(objectId, state),
    });

    return () => {
      off();
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, [model, labels]);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}
