"use client";

import { useEffect, useRef, type DragEvent } from "react";
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
 *
 * `intentOnly: true` (ticket 1.13): la escena no resuelve diálogos ni reparte
 * contenedores por su cuenta; solo emite la intención (`interact` / `use-item`)
 * y es `RoomSession` quien devuelve diálogo, estado y panel. Así desaparece el
 * doble diálogo al inspeccionar.
 *
 * El drag&drop de un item del inventario se recibe aquí (el canvas es el único
 * elemento de fondo; los overlays tienen `pointer-events: none` o capturan el
 * drop), se localiza el objeto bajo el puntero y la escena emite `use-item`.
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
      intentOnly: true,
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

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const itemId = event.dataTransfer.getData("text/plain");
    if (!itemId) return;
    runtimeRef.current?.dropItemAt(itemId, event.clientX, event.clientY);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      aria-hidden
    />
  );
}
