"use client";

import { useEffect, useRef, type DragEvent } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import { RoomRuntime3D } from "@escaperoom/game-runtime/three";
import type { WorldSceneEvent } from "@escaperoom/game-runtime/phaser";
import { BACKGROUND_HEX, isDarkThemeActive } from "@/lib/theme";
import type { Pack3D } from "@/lib/game-model";
import type { GameSessionCanvasHandle } from "./game-session-canvas";

/**
 * Canvas de la partida en red para salas 3D (specs/27 §7): mismo contrato que
 * `GameSessionCanvas` (Phaser), montando `RoomRuntime3D`. Una partida 3D no
 * descarga Phaser ni una 2D descarga Three.js: el shell elige uno u otro con
 * `dynamic()`.
 */
export default function GameSessionCanvas3D({
  model,
  roomId,
  pack3d,
  inputEnabled = true,
  onEvent,
  onReady,
}: {
  model: RuntimeModel;
  roomId: string;
  pack3d?: Pack3D;
  inputEnabled?: boolean;
  onEvent: (event: WorldSceneEvent) => void;
  onReady?: (handle: GameSessionCanvasHandle) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RoomRuntime3D | null>(null);
  const onEventRef = useRef(onEvent);
  const onReadyRef = useRef(onReady);
  const initialRoomRef = useRef(roomId);
  const inputEnabledRef = useRef(inputEnabled);
  onEventRef.current = onEvent;
  onReadyRef.current = onReady;
  inputEnabledRef.current = inputEnabled;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || runtimeRef.current) return;

    const runtime = new RoomRuntime3D(container, model, {
      initialRoomId: initialRoomRef.current,
      packBaseUrl: pack3d?.baseUrl,
      packId: pack3d?.packId,
      resolveCustomModelUrl: (ref) => pack3d?.customModelUrls?.[ref],
      inputEnabled: false,
      emitAvatarMoves: true,
      backgroundColor: isDarkThemeActive() ? BACKGROUND_HEX.dark : BACKGROUND_HEX.light,
    });
    runtimeRef.current = runtime;
    const off = runtime.onWorldEvent((event) => onEventRef.current(event));
    let cancelled = false;
    void runtime.ready
      .catch((error: unknown) => {
        // La partida sigue (sin navmesh no hay camino, pero el HUD y los paneles funcionan).
        console.error("GameSessionCanvas3D: la sala 3D no se pudo preparar", error);
      })
      .then(() => {
        if (cancelled) return;
        runtime.setInputEnabled(inputEnabledRef.current);
        onReadyRef.current?.({
          showRoom: (next, onBuilt) => runtime.showRoom(next, onBuilt),
          placeAvatar: (x, y, h, yaw) => runtime.placeAvatar(x, y, h, yaw),
          avatarCell: () => runtime.avatarCell,
          avatarPose: () => runtime.avatarPose,
          setObjectState: (objectId, state) => runtime.setObjectState(objectId, state),
          setPlayers: (players) => runtime.setPlayers(players),
          setLocalTint: (tint) => runtime.setLocalTint(tint),
          setLocalCharacter: (characterId) => runtime.setLocalCharacter(characterId),
          getObjectScreenFraction: (objectId) => runtime.getObjectScreenFraction(objectId),
          isObjectInteractive: (objectId) => runtime.isObjectInteractive(objectId),
          walkTo: (point, onArrive) => runtime.walkTo(point, onArrive),
          setMoveVector: (v) => runtime.setMoveVector(v),
          interactHighlighted: () => runtime.interactHighlighted(),
          onHighlightChange: (handler) => runtime.onHighlightChange(handler),
        });
      });

    return () => {
      cancelled = true;
      off();
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, [model, pack3d]);

  useEffect(() => {
    runtimeRef.current?.setInputEnabled(inputEnabled);
  }, [inputEnabled]);

  useEffect(() => {
    // Nada dispara un evento al cambiar de tema: se observa la clase de <html>.
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
      data-dimension="3d"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      aria-hidden
    />
  );
}
