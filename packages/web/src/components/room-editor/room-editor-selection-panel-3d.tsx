"use client";

import { useTranslations } from "next-intl";
import type { EditTarget, Edit3DController, Transform3DChange } from "@escaperoom/editor";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INPUT =
  "h-auto rounded border border-white/15 bg-slate-900 px-1.5 py-0.5 text-xs text-white";
/** Altura por defecto de una antorcha 3D sin `h`. */
const DEFAULT_TORCH_HEIGHT = 1.6;

type Pose = { x: number; y: number; h: number; yaw?: number; scale?: number };

/** Pose actual del elemento, leída del paquete; `undefined` si ya no existe. */
function readPose(pkg: RoomPackage, roomId: string, target: EditTarget): Pose | undefined {
  switch (target.kind) {
    case "piece": {
      const piece = pkg.world3d?.rooms[roomId]?.pieces.find((p) => p.id === target.id);
      return piece && { x: piece.x, y: piece.y, h: piece.h, yaw: piece.yaw, scale: piece.scale ?? 1 };
    }
    case "object": {
      const t = pkg.objects.find((o) => o.id === target.id)?.transform;
      return t && { x: t.x, y: t.y, h: t.h, yaw: t.yaw, scale: t.scale ?? 1 };
    }
    case "spawn": {
      const s = pkg.map.rooms.find((r) => r.id === roomId)?.spawnPoints.find((p) => p.id === target.id);
      return s && { x: s.x, y: s.y, h: s.h ?? 0, yaw: s.yaw ?? 0 };
    }
    case "torch": {
      const light = pkg.map.rooms.find((r) => r.id === roomId)?.lighting[target.index];
      return light?.type === "torch"
        ? { x: light.x, y: light.y, h: light.h ?? DEFAULT_TORCH_HEIGHT }
        : undefined;
    }
  }
}

function toChange(target: EditTarget, pose: Required<Pick<Pose, "x" | "y" | "h">> & Pose): Transform3DChange {
  const { x, y, h } = pose;
  const yaw = pose.yaw ?? 0;
  switch (target.kind) {
    case "piece":
    case "object":
      return {
        kind: target.kind,
        id: target.id,
        x,
        y,
        h,
        yaw,
        ...(pose.scale !== undefined && pose.scale !== 1 ? { scale: pose.scale } : {}),
      };
    case "spawn":
      return { kind: "spawn", id: target.id, x, y, h, yaw };
    case "torch":
      return { kind: "torch", index: target.index, x, y, h };
  }
}

export interface RoomEditorSelectionPanel3DProps {
  pkg: RoomPackage;
  roomId: string;
  selection: readonly EditTarget[];
  controller: Edit3DController;
}

/**
 * Panel de la selección del editor 3D: coordenadas exactas de un elemento
 * (x, y, h, giro, escala) o acciones sobre varios. Confirmar un campo (Intro o
 * perder el foco) escribe con `controller.transform(..., true)`.
 */
export function RoomEditorSelectionPanel3D({
  pkg,
  roomId,
  selection,
  controller,
}: RoomEditorSelectionPanel3DProps) {
  const t = useTranslations("RoomEditor.selection3d");
  if (selection.length === 0) return null;

  const actions = (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="ghost"
        className="border border-white/15 text-white hover:bg-white/10"
        onClick={() => controller.duplicateSelection()}
        data-action="duplicate"
      >
        {t("duplicate")}
      </Button>
      <Button size="sm" variant="destructive" onClick={() => controller.deleteSelection()} data-action="delete">
        {t("delete")}
      </Button>
    </div>
  );

  const target = selection[0]!;
  const pose = selection.length === 1 ? readPose(pkg, roomId, target) : undefined;

  if (selection.length > 1 || !pose) {
    return (
      <section className="space-y-2 text-sm" data-selection-panel-3d="">
        <p className="text-xs text-white/70">{t("many", { count: selection.length })}</p>
        {actions}
      </section>
    );
  }

  const fields: { key: "x" | "y" | "h" | "yaw" | "scale"; step: number }[] = [
    { key: "x", step: 0.1 },
    { key: "y", step: 0.1 },
    { key: "h", step: 0.1 },
    ...(pose.yaw !== undefined ? [{ key: "yaw" as const, step: 5 }] : []),
    ...(pose.scale !== undefined ? [{ key: "scale" as const, step: 0.1 }] : []),
  ];

  const commit = (key: (typeof fields)[number]["key"], raw: string) => {
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value) || value === pose[key]) return;
    controller.transform([toChange(target, { ...pose, [key]: value })], true);
  };

  return (
    <section className="space-y-2 text-sm" data-selection-panel-3d="">
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ key, step }) => (
          <Label key={key} className="flex-col items-start gap-1 text-xs font-normal text-white/70">
            {t(key)}
            <Input
              // Se remonta al cambiar el valor del doc (gizmo, otra pestaña): refleja siempre lo guardado.
              key={`${target.kind}-${"id" in target ? target.id : target.index}-${key}-${pose[key]}`}
              type="number"
              step={step}
              defaultValue={pose[key]}
              className={INPUT}
              data-field={key}
              onBlur={(event) => commit(key, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit(key, event.currentTarget.value);
              }}
            />
          </Label>
        ))}
      </div>
      {actions}
    </section>
  );
}
