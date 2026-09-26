"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import { RoomRuntime, type RoomScenePack, type RoomSceneLabels } from "@escaperoom/game-runtime/phaser";

/**
 * Monta el runtime Phaser de producto (`RoomRuntime`) en un contenedor React y
 * lo destruye al desmontar. Solo se carga en cliente vía `next/dynamic` con
 * `ssr: false` (ver `room-preview-shell.tsx`), porque Phaser necesita
 * `window`/`canvas`. Al cambiar `roomId`, pide el cambio de habitación.
 *
 * Si `pack` está presente, la escena precarga sus atlas; si no, genera
 * placeholders procedurales por frame (ticket 1.2).
 */
export default function RoomPreviewCanvas({
  model,
  roomId,
  pack,
}: {
  model: RuntimeModel;
  roomId: string;
  pack?: RoomScenePack;
}) {
  const t = useTranslations("RoomScene.labels");
  const inspectHint = t("inspectHint");
  const containerRemaining = t("containerRemaining");
  const containerEmpty = t("containerEmpty");
  const containerReceived = t("containerReceived");
  const openPanelLabel = t("openPanel");
  // `useMemo` (no un objeto literal): un `RoomRuntime` nuevo por render
  // reconstruiría la sala entera (F-21/F-22); solo cambia si cambia el texto.
  const labels: Partial<RoomSceneLabels> = useMemo(
    () => ({
      inspectHint,
      containerRemaining,
      containerEmpty,
      containerReceived,
      openPanel: openPanelLabel,
    }),
    [inspectHint, containerRemaining, containerEmpty, containerReceived, openPanelLabel],
  );
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
      pack,
      labels,
    });
    runtimeRef.current = runtime;

    return () => {
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, [model, pack, labels]);

  useEffect(() => {
    roomIdRef.current = roomId;
    runtimeRef.current?.showRoom(roomId);
  }, [roomId]);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}
