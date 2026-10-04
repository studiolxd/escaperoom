"use client";

import { useEffect, useRef } from "react";
import type { Edit3DController, Tool3DState, Transform3DChange } from "@escaperoom/editor";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import {
  RoomRuntime3D,
  type EditPointer3D,
  type TransformChange3D,
} from "@escaperoom/game-runtime/three";
import type { Pack3D } from "@/lib/game-model";

export interface RoomEditorCanvas3DProps {
  model: RuntimeModel;
  roomId: string;
  pack3d?: Pack3D;
  controller: Edit3DController;
  state: Tool3DState;
  /** Alt pulsado: el imán se desactiva mientras dure. */
  altPressed: boolean;
  navmeshVisible: boolean;
}

const SNAP_ON = { move: 1, yaw: 90 } as const;
const SNAP_OFF = { move: 0, yaw: 0 } as const;

/** Cambio del gizmo → cambio de comando (giro normalizado a [0, 360); `scale` 1 = sin escala). */
export function toTransformChanges(changes: readonly TransformChange3D[]): Transform3DChange[] {
  const out: Transform3DChange[] = [];
  for (const change of changes) {
    const { target } = change;
    const yaw = ((change.yaw % 360) + 360) % 360;
    const scale = change.scale === 1 ? undefined : change.scale;
    const base = { x: change.x, y: change.y, h: change.h };
    if (target.kind === "piece" || target.kind === "object") {
      out.push({ kind: target.kind, id: target.id, ...base, yaw, ...(scale !== undefined ? { scale } : {}) });
    } else if (target.kind === "spawn") {
      out.push({ kind: "spawn", id: target.id, ...base, yaw });
    } else if (target.kind === "torch") {
      out.push({ kind: "torch", index: target.index, ...base });
    }
  }
  return out;
}

/**
 * Lienzo del editor 3D (specs/27 §8): el `RoomRuntime3D` de Three.js con
 * `mode: "edit"`. No edita nada: reenvía puntero y gizmo al controlador y se
 * repinta desde el modelo derivado del doc Yjs. Solo cliente (`next/dynamic`,
 * `ssr: false`): no arrastra Phaser.
 */
export default function RoomEditorCanvas3D({
  model,
  roomId,
  pack3d,
  controller,
  state,
  altPressed,
  navmeshVisible,
}: RoomEditorCanvas3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RoomRuntime3D | null>(null);
  const latest = useRef({ model, roomId, controller, state, altPressed, navmeshVisible });
  latest.current = { model, roomId, controller, state, altPressed, navmeshVisible };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Siguiente tick: el montaje descartado de StrictMode no llega a crear un renderer.
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => {
      const current = latest.current;
      const runtime = new RoomRuntime3D(container, current.model, {
        mode: "edit",
        initialRoomId: current.roomId,
        packBaseUrl: pack3d?.baseUrl,
        packId: pack3d?.packId,
      });
      runtimeRef.current = runtime;
      const offEvent = runtime.onEditEvent((event: EditPointer3D) => {
        latest.current.controller.pointer({
          type: event.type,
          point: event.point,
          target: event.target,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        });
      });
      const offTransform = runtime.onTransform((changes, final) => {
        latest.current.controller.transform(toTransformChanges(changes), final);
      });
      applyState(runtime, current.state, current.altPressed, current.navmeshVisible);
      void runtime.ready.catch((error: unknown) => {
        console.error("RoomEditorCanvas3D: la sala 3D no se pudo preparar", error);
      });
      stop = () => {
        offEvent();
        offTransform();
        runtime.destroy();
      };
    }, 0);
    return () => {
      clearTimeout(timer);
      stop?.();
      runtimeRef.current = null;
    };
  }, [pack3d]);

  // Varias transacciones Yjs seguidas se agrupan por frame: solo la última se aplica.
  useEffect(() => {
    const frame = requestAnimationFrame(() => runtimeRef.current?.setModel(model));
    return () => cancelAnimationFrame(frame);
  }, [model]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && model.subroomsById[roomId] && runtime.currentRoomId !== roomId) {
      runtime.showRoom(roomId);
    }
  }, [roomId, model]);

  const { selection, ghost, workHeight, tool, gizmoMode, snapEnabled } = state;
  useEffect(() => runtimeRef.current?.setSelection(selection), [selection]);
  useEffect(() => runtimeRef.current?.setGhost(ghost ?? null), [ghost]);
  useEffect(() => runtimeRef.current?.setWorkHeight(workHeight), [workHeight]);
  useEffect(
    () => runtimeRef.current?.setGizmoMode(tool === "select" ? gizmoMode : null),
    [tool, gizmoMode],
  );
  useEffect(
    () => runtimeRef.current?.setSnap(snapEnabled && !altPressed ? SNAP_ON : SNAP_OFF),
    [snapEnabled, altPressed],
  );
  useEffect(() => runtimeRef.current?.setNavmeshVisible(navmeshVisible), [navmeshVisible]);

  return <div ref={containerRef} className="absolute inset-0 touch-none" aria-hidden />;
}

function applyState(
  runtime: RoomRuntime3D,
  state: Tool3DState,
  altPressed: boolean,
  navmeshVisible: boolean,
): void {
  runtime.setSelection(state.selection);
  runtime.setGhost(state.ghost ?? null);
  runtime.setWorkHeight(state.workHeight);
  runtime.setGizmoMode(state.tool === "select" ? state.gizmoMode : null);
  runtime.setSnap(state.snapEnabled && !altPressed ? SNAP_ON : SNAP_OFF);
  runtime.setNavmeshVisible(navmeshVisible);
}
