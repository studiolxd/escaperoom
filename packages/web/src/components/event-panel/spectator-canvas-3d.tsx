"use client";

import { useEffect, useRef } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { ScenePlayer } from "@escaperoom/game-runtime/phaser";
import { RoomRuntime3D, type ObserverCamera } from "@escaperoom/game-runtime/three";
import type { Pack3D } from "@/lib/game-model";
import { BACKGROUND_HEX, isDarkThemeActive } from "@/lib/theme";

/**
 * Mundo 3D del modo observador (ticket 7.6): `RoomRuntime3D` con `observer: true`, alimentado
 * con todos los jugadores y objetos del `GameSnapshot`, como hace `useSceneSync` para un jugador.
 * Los selectores de cámara y habitación los pinta `SpectatorView`; aquí solo se aplica la cámara.
 */
export default function SpectatorCanvas3D({
  model,
  pack3d,
  players,
  objects,
  camera,
  onRoomChange,
}: {
  model: RuntimeModel;
  pack3d?: Pack3D;
  players: readonly ScenePlayer[];
  objects: Readonly<Record<string, string>>;
  camera: ObserverCamera;
  onRoomChange?: (roomId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RoomRuntime3D | null>(null);
  const playersRef = useRef(players);
  const objectsRef = useRef(objects);
  const cameraRef = useRef(camera);
  const onRoomChangeRef = useRef(onRoomChange);
  playersRef.current = players;
  objectsRef.current = objects;
  cameraRef.current = camera;
  onRoomChangeRef.current = onRoomChange;
  const appliedObjectsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const container = containerRef.current;
    if (!container || runtimeRef.current) return;
    const runtime = new RoomRuntime3D(container, model, {
      packBaseUrl: pack3d?.baseUrl,
      packId: pack3d?.packId,
      observer: true,
      backgroundColor: isDarkThemeActive() ? BACKGROUND_HEX.dark : BACKGROUND_HEX.light,
    });
    runtimeRef.current = runtime;
    appliedObjectsRef.current = {};
    const offRoom = runtime.onObserverRoomChange((roomId) => onRoomChangeRef.current?.(roomId));
    let cancelled = false;
    void runtime.ready
      .catch((error: unknown) => {
        console.error("SpectatorCanvas3D: la sala 3D no se pudo preparar", error);
      })
      .then(() => {
        if (cancelled) return;
        runtime.setObserverCamera(cameraRef.current);
        runtime.setPlayers(playersRef.current);
        for (const [objectId, state] of Object.entries(objectsRef.current)) {
          if (state && model.objectsById[objectId]?.states.includes(state)) {
            appliedObjectsRef.current[objectId] = state;
            runtime.setObjectState(objectId, state);
          }
        }
      });
    return () => {
      cancelled = true;
      offRoom();
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, [model, pack3d]);

  useEffect(() => {
    runtimeRef.current?.setPlayers(players);
  }, [players]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    for (const [objectId, state] of Object.entries(objects)) {
      if (appliedObjectsRef.current[objectId] === state) continue;
      if (!state || !model.objectsById[objectId]?.states.includes(state)) continue;
      appliedObjectsRef.current[objectId] = state;
      runtime.setObjectState(objectId, state);
    }
  }, [model, objects]);

  useEffect(() => {
    runtimeRef.current?.setObserverCamera(camera);
  }, [camera]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      runtimeRef.current?.setBackgroundColor(
        isDarkThemeActive() ? BACKGROUND_HEX.dark : BACKGROUND_HEX.light,
      );
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} className="absolute inset-0" data-dimension="3d" aria-hidden />;
}
