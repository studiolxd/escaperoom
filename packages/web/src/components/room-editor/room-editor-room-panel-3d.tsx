"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type * as Y from "yjs";
import {
  setAmbientLight,
  setRoomBounds3D,
  toToolError,
  type EditTarget,
  type ToolError,
} from "@escaperoom/editor";
import { checkRoomReach, initNav3D, type ReachIssue } from "@escaperoom/nav3d";
import { getModels3DCatalog } from "@escaperoom/shared/packs";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

const INPUT =
  "h-auto rounded border border-white/15 bg-slate-900 px-1.5 py-0.5 text-xs text-white";
/** Luz ambiente que se propone al tocar los controles de una sala que no tiene. */
const DEFAULT_AMBIENT = { color: "#ffffff", intensity: 0.6 } as const;
/** Espera tras el último cambio del modelo antes de recalcular la navmesh. */
export const REACH_DEBOUNCE_MS = 500;

export interface RoomEditorRoomPanel3DProps {
  doc: Y.Doc;
  pkg: RoomPackage;
  roomId: string;
  /** Selecciona el elemento al que apunta un aviso. */
  onSelect: (targets: readonly EditTarget[]) => void;
  errorText: (error: ToolError) => string;
}

/**
 * Panel de la habitación activa del editor 3D: medidas, luz ambiente, recuento
 * y avisos de zona transitable (`checkRoomReach`, recalculados con debounce).
 */
export function RoomEditorRoomPanel3D({
  doc,
  pkg,
  roomId,
  onSelect,
  errorText,
}: RoomEditorRoomPanel3DProps) {
  const t = useTranslations("RoomEditor.room3d");
  const [error, setError] = useState<string | null>(null);
  const room = pkg.map.rooms.find((r) => r.id === roomId);
  const ambient = room?.lighting.find((light) => light.type === "ambient");
  const [intensity, setIntensity] = useState<number | undefined>(undefined);
  const [issues, setIssues] = useState<ReachIssue[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void initNav3D()
        .then(() => {
          if (cancelled) return;
          setIssues(checkRoomReach(pkg, roomId, getModels3DCatalog(pkg.map.tileset)));
        })
        .catch((caught: unknown) => {
          console.error("RoomEditorRoomPanel3D: no se pudo calcular la zona transitable", caught);
        });
    }, REACH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pkg, roomId]);

  if (!room) return null;

  const run = (command: () => unknown) => {
    try {
      command();
      setError(null);
    } catch (caught) {
      setError(errorText(toToolError(caught)));
    }
  };

  const setSize = (key: "cols" | "rows", raw: string) => {
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value) || value === room.grid[key]) return;
    run(() => setRoomBounds3D(doc, roomId, { ...room.grid, [key]: value }));
  };

  const current = ambient ?? { ...DEFAULT_AMBIENT };
  const shownIntensity = intensity ?? current.intensity;
  const pieces = pkg.world3d?.rooms[roomId]?.pieces.length ?? 0;
  const objects = pkg.objects.filter((o) => o.roomId === roomId).length;
  const torches = room.lighting.filter((l) => l.type === "torch").length;

  const issueText = (issue: ReachIssue): { text: string; target?: EditTarget } => {
    switch (issue.code) {
      case "no_floor":
        return { text: t("noFloor") };
      case "spawn_off_navmesh":
        return {
          text: t("spawnOff", { id: issue.spawnId }),
          target: { kind: "spawn", id: issue.spawnId },
        };
      case "object_unreachable":
        return {
          text: t("unreachable", { object: issue.objectId }),
          target: { kind: "object", id: issue.objectId },
        };
    }
  };

  return (
    <section className="space-y-4 text-sm" data-room-panel-3d={roomId}>
      <h2 className="text-sm font-semibold">{room.name || room.id}</h2>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">{t("size")}</h3>
        <div className="grid grid-cols-2 gap-2">
          <Label className="flex-col items-start gap-1 text-xs font-normal text-white/70">
            {t("width")}
            <Input
              key={`cols-${room.grid.cols}`}
              type="number"
              min={1}
              step={1}
              defaultValue={room.grid.cols}
              className={INPUT}
              data-room-size="cols"
              onBlur={(event) => setSize("cols", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setSize("cols", event.currentTarget.value);
              }}
            />
          </Label>
          <Label className="flex-col items-start gap-1 text-xs font-normal text-white/70">
            {t("depth")}
            <Input
              key={`rows-${room.grid.rows}`}
              type="number"
              min={1}
              step={1}
              defaultValue={room.grid.rows}
              className={INPUT}
              data-room-size="rows"
              onBlur={(event) => setSize("rows", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setSize("rows", event.currentTarget.value);
              }}
            />
          </Label>
        </div>
      </div>

      <div className="space-y-2" data-room-ambient="">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">{t("ambient")}</h3>
        <Label className="gap-2 text-xs font-normal text-white/70">
          {t("ambient")}
          <Input
            type="color"
            aria-label={t("ambient")}
            value={current.color}
            className="h-7 w-12 p-0.5"
            onChange={(event) =>
              run(() =>
                setAmbientLight(doc, roomId, {
                  color: event.currentTarget.value,
                  intensity: current.intensity,
                }),
              )
            }
          />
        </Label>
        <Label className="flex-col items-stretch gap-2 text-xs font-normal text-white/70">
          {t("intensity")} ({shownIntensity.toFixed(2)})
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[shownIntensity]}
            aria-label={t("intensity")}
            onValueChange={([value]) => setIntensity(value)}
            onValueCommit={([value]) => {
              setIntensity(undefined);
              if (value !== undefined) {
                run(() => setAmbientLight(doc, roomId, { color: current.color, intensity: value }));
              }
            }}
          />
        </Label>
      </div>

      <p className="text-xs text-white/60" data-room-counts="">
        {t("counts", { pieces, objects, spawns: room.spawnPoints.length, torches })}
      </p>

      <div className="space-y-2" data-reach="">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">{t("reachTitle")}</h3>
        {issues.length > 0 && (
          <ul className="space-y-1">
            {issues.map((issue) => {
              const { text, target } = issueText(issue);
              const key = `${issue.code}-${"spawnId" in issue ? issue.spawnId : "objectId" in issue ? issue.objectId : ""}`;
              return (
                <li key={key}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start whitespace-normal rounded border border-amber-400/40 bg-amber-400/10 p-1.5 text-left text-xs text-amber-100"
                    data-reach-issue={issue.code}
                    disabled={!target}
                    onClick={() => target && onSelect([target])}
                  >
                    {text}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-white/50">{t("platformNote")}</p>
      </div>
    </section>
  );
}
