"use client";

import { useEffect, useRef, type DragEvent } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import {
  RoomRuntime,
  type RoomScenePack,
  type ScenePlayer,
  type WorldSceneEvent,
} from "@escaperoom/game-runtime/phaser";
import { BACKGROUND_HEX, isDarkThemeActive } from "@/lib/theme";

/** Handle imperativo del canvas para que el shell refleje el estado del servidor. */
export interface GameSessionCanvasHandle {
  /** `onBuilt`, si se da, se llama cuando la sala nueva ya está reconstruida (ver `RoomScene.setRoom`). */
  showRoom(roomId: string, onBuilt?: () => void): void;
  /** `h` y `yaw` solo los usa el canvas 3D. */
  placeAvatar(x: number, y: number, h?: number, yaw?: number): void;
  avatarCell(): { x: number; y: number } | undefined;
  setObjectState(objectId: string, state: string): void;
  setPlayers(players: readonly ScenePlayer[]): void;
  setLocalTint(tint: string): void;
  setLocalCharacter(characterId: string): void;
  /** Fracción (0–1) del lienzo donde está un objeto interactuable, para clicarlo desde fuera (E2E). */
  getObjectScreenFraction(objectId: string): { x: number; y: number } | undefined;
  /** ¿El objeto responde ahora al clic? (E2E: esperar a que se revele antes de clicarlo). */
  isObjectInteractive(objectId: string): boolean;

  // — Solo los implementa el canvas 3D (`game-session-canvas-3d.tsx`) —
  avatarPose?(): { x: number; y: number; h: number; yaw: number } | undefined;
  walkTo?(point: { x: number; y: number; h?: number }, onArrive?: () => void): boolean;
  setMoveVector?(v: { x: number; y: number } | null): void;
  interactHighlighted?(): boolean;
  onHighlightChange?(handler: (objectId: string | undefined) => void): () => void;
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
  model: RuntimeModel;
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
      backgroundColor: isDarkThemeActive() ? BACKGROUND_HEX.dark : BACKGROUND_HEX.light,
    });
    runtimeRef.current = runtime;
    const off = runtime.onWorldEvent((event) => onEventRef.current(event));
    onReadyRef.current?.({
      showRoom: (next, onBuilt) => runtime.showRoom(next, onBuilt),
      placeAvatar: (x, y) => runtime.placeAvatar(x, y),
      avatarCell: () => runtime.avatarCell,
      setObjectState: (objectId, state) => runtime.setObjectState(objectId, state),
      setPlayers: (players) => runtime.setPlayers(players),
      setLocalTint: (tint) => runtime.setLocalTint(tint),
      setLocalCharacter: (characterId) => runtime.setLocalCharacter(characterId),
      getObjectScreenFraction: (objectId) => runtime.getObjectScreenFraction(objectId),
      isObjectInteractive: (objectId) => runtime.isObjectInteractive(objectId),
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

  useEffect(() => {
    // Nada dispara un evento al cambiar de tema (`ThemeSelect` solo hace
    // `classList.toggle`): sin esto, el fondo del canvas se quedaría con el
    // de la carga inicial si el tema cambia con la partida ya en marcha.
    const observer = new MutationObserver(() => {
      runtimeRef.current?.setBackgroundColor(
        isDarkThemeActive() ? BACKGROUND_HEX.dark : BACKGROUND_HEX.light,
      );
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

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
