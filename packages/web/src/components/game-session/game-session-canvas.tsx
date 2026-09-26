"use client";

import { useEffect, useRef, type DragEvent } from "react";
import type { PublicRuntimeModel } from "@escaperoom/game-runtime";
import {
  RoomRuntime,
  type RoomScenePack,
  type ScenePlayer,
  type WorldSceneEvent,
} from "@escaperoom/game-runtime/phaser";

/** Handle imperativo del canvas para que el shell refleje el estado del servidor. */
export interface GameSessionCanvasHandle {
  showRoom(roomId: string): void;
  placeAvatar(x: number, y: number): void;
  avatarCell(): { x: number; y: number } | undefined;
  setObjectState(objectId: string, state: string): void;
  setPlayers(players: readonly ScenePlayer[]): void;
  setLocalTint(tint: string): void;
  setLocalCharacter(characterId: string): void;
}

/**
 * Canvas de la partida en red (fase 2): el runtime de producto en modo
 * `intentOnly` (la escena solo emite intenciones) y `emitAvatarMoves` (la
 * posición del avatar sale hacia el servidor, que es el autoritativo). Los
 * demás jugadores los pinta la escena a partir del estado sincronizado.
 */
export default function GameSessionCanvas({
  model,
  roomId,
  pack,
  inputEnabled = true,
  onEvent,
  onReady,
}: {
  model: PublicRuntimeModel;
  roomId: string;
  pack?: RoomScenePack;
  inputEnabled?: boolean;
  onEvent: (event: WorldSceneEvent) => void;
  onReady?: (handle: GameSessionCanvasHandle) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RoomRuntime | null>(null);
  const onEventRef = useRef(onEvent);
  const onReadyRef = useRef(onReady);
  const initialRoomRef = useRef(roomId);
  onEventRef.current = onEvent;
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || runtimeRef.current) {
      return;
    }

    const runtime = new RoomRuntime(container, model, {
      initialRoomId: initialRoomRef.current,
      pack,
      dialogOverlay: false,
      intentOnly: true,
      inputEnabled: false,
      emitAvatarMoves: true,
    });
    runtimeRef.current = runtime;
    const off = runtime.onWorldEvent((event) => onEventRef.current(event));
    onReadyRef.current?.({
      showRoom: (next) => runtime.showRoom(next),
      placeAvatar: (x, y) => runtime.placeAvatar(x, y),
      avatarCell: () => runtime.avatarCell,
      setObjectState: (objectId, state) => runtime.setObjectState(objectId, state),
      setPlayers: (players) => runtime.setPlayers(players),
      setLocalTint: (tint) => runtime.setLocalTint(tint),
      setLocalCharacter: (characterId) => runtime.setLocalCharacter(characterId),
    });

    return () => {
      off();
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, [model, pack]);

  useEffect(() => {
    runtimeRef.current?.setInputEnabled(inputEnabled);
  }, [inputEnabled]);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!inputEnabled) return;
    const itemId = event.dataTransfer.getData("text/plain");
    if (itemId) runtimeRef.current?.dropItemAt(itemId, event.clientX, event.clientY);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      aria-hidden
    />
  );
}
