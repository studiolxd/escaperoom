"use client";

import { useEffect, useRef } from "react";
import type { EditPointerEvent, RuntimeModel } from "@escaperoom/game-runtime";
import { RoomRuntime, type RoomScenePack } from "@escaperoom/game-runtime/phaser";

export interface RoomEditorCanvasProps {
  model: RuntimeModel;
  roomId: string;
  pack?: RoomScenePack;
  selectedObjectId?: string;
  drag?: { objectId: string; cell: { x: number; y: number } };
  onPointer: (event: EditPointerEvent) => void;
}

/**
 * Lienzo WYSIWYG del editor (specs/09 §1): el mismo `RoomRuntime` de Phaser
 * que en juego, con `mode: 'edit'`. No edita nada: reenvía el puntero a la
 * capa de comandos y se repinta cuando cambia el modelo derivado del doc Yjs.
 * Solo cliente (se carga con `next/dynamic` y `ssr: false`).
 */
export default function RoomEditorCanvas({
  model,
  roomId,
  pack,
  selectedObjectId,
  drag,
  onPointer,
}: RoomEditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RoomRuntime | null>(null);
  // Últimos props, para crear el runtime con el estado vigente y reenviar el puntero.
  const latest = useRef({ model, roomId, selectedObjectId, onPointer });

  useEffect(() => {
    latest.current = { model, roomId, selectedObjectId, onPointer };
  }, [model, roomId, selectedObjectId, onPointer]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // Se crea en el siguiente tick: el montaje descartado de StrictMode no llega
    // a crear un juego Phaser (destruido antes de arrancar, seguiría vivo y se
    // quedaría con el puntero sin nadie escuchando sus eventos de edición).
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => {
      const runtime = new RoomRuntime(container, latest.current.model, {
        initialRoomId: latest.current.roomId,
        pack,
        mode: "edit",
      });
      runtimeRef.current = runtime;
      runtime.setSelection(latest.current.selectedObjectId);
      const unsubscribe = runtime.onEditEvent((event) => latest.current.onPointer(event));
      stop = () => {
        unsubscribe();
        runtime.destroy();
      };
    }, 0);
    return () => {
      clearTimeout(timer);
      stop?.();
      runtimeRef.current = null;
    };
  }, [pack]);

  // `setModel` reconstruye la sala entera en Phaser (F-21): con varias
  // actualizaciones del modelo dentro del mismo frame (p. ej. varias
  // transacciones Yjs seguidas), como mínimo se agrupan por frame (RAF) para
  // que solo la última se aplique, en vez de una reconstrucción por cada una.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      runtimeRef.current?.setModel(model);
    });
    return () => cancelAnimationFrame(frame);
  }, [model]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && model.subroomsById[roomId]) {
      runtime.showRoom(roomId);
    }
  }, [roomId, model]);

  useEffect(() => {
    runtimeRef.current?.setSelection(selectedObjectId);
  }, [selectedObjectId, model]);

  useEffect(() => {
    runtimeRef.current?.setDragPreview(drag?.objectId, drag?.cell);
  }, [drag]);

  return <div ref={containerRef} className="absolute inset-0 touch-none" aria-hidden />;
}
