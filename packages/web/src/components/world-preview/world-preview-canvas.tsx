"use client";

import { useEffect, useRef } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import { RoomRuntime, type WorldSceneEvent } from "@escaperoom/game-runtime/phaser";

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
  }, [model]);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}
