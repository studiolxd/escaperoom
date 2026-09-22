"use client";

import { useEffect, useRef } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import {
  RoomRuntime,
  type RoomScenePack,
  type WorldSceneEvent,
} from "@escaperoom/game-runtime/phaser";

/** Handle imperativo para disparar inspecciones desde el overlay React. */
export interface RoomPlaytestHandle {
  inspectObject(objectId: string): void;
  setObjectState(objectId: string, state: string): void;
}

/**
 * Canvas del playtest de la Sala 1 (ticket 1.10): monta el runtime de producto
 * con avatar jugable (teclado) y reenvía cada `world:event` al overlay React
 * (`dialogOverlay: false`), que es quien decide qué hace el motor de reglas.
 */
export default function RoomPlaytestCanvas({
  model,
  roomId,
  pack,
  onEvent,
  onReady,
}: {
  model: RuntimeModel;
  roomId: string;
  pack?: RoomScenePack;
  onEvent: (event: WorldSceneEvent) => void;
  onReady?: (handle: RoomPlaytestHandle) => void;
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
      initialRoomId: roomId,
      pack,
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
  }, [model, roomId, pack]);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}
