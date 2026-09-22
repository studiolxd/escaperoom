"use client";

import { useEffect, useRef } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import { RoomRuntime } from "@escaperoom/game-runtime/phaser";

/**
 * Monta el runtime Phaser de producto (`RoomRuntime`) en un contenedor React y
 * lo destruye al desmontar. Solo se carga en cliente vía `next/dynamic` con
 * `ssr: false` (ver `room-preview-shell.tsx`), porque Phaser necesita
 * `window`/`canvas`. Al cambiar `roomId`, pide el cambio de habitación.
 */
export default function RoomPreviewCanvas({
  model,
  roomId,
}: {
  model: RuntimeModel;
  roomId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RoomRuntime | null>(null);
  const roomIdRef = useRef(roomId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || runtimeRef.current) {
      return;
    }

    const runtime = new RoomRuntime(container, model, {
      initialRoomId: roomIdRef.current,
    });
    runtimeRef.current = runtime;

    return () => {
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, [model]);

  useEffect(() => {
    roomIdRef.current = roomId;
    runtimeRef.current?.showRoom(roomId);
  }, [roomId]);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}
