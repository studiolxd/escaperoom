"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type * as Y from "yjs";
import {
  moveDecoration,
  removeDecoration,
  removeLight,
  setAmbientLight,
  setDecorationSprite,
  toToolError,
  updateTorch,
  type ToolError,
} from "@escaperoom/editor";
import type { SubRoom, WorldObject } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Luz ambiente que se propone al añadirla (la del salón del Rey Aldric). */
const DEFAULT_AMBIENT = { color: "#3a2f22", intensity: 0.6 } as const;

const INPUT =
  "h-auto rounded border border-white/15 bg-slate-900 px-1.5 py-0.5 text-xs text-white disabled:opacity-50";

/** Sentinel del `SelectItem` "sin objeto" (Radix no admite `value=""`). */
const NO_OBJECT = "__none__";

export interface RoomEditorRoomPanelProps {
  doc: Y.Doc;
  /** Habitación activa, leída del doc (`useRoomPackage`). */
  room: SubRoom;
  /** Objetos de la habitación: candidatos a gobernar una antorcha. */
  objects: readonly WorldObject[];
  /** Sprites del pack, para cambiar el de una decoración. */
  sprites: readonly string[];
  /** Traduce el error de un comando (mismos códigos que el lienzo). */
  errorText: (error: ToolError) => string;
}

/**
 * Panel de la habitación activa (specs/09 §4.1, specs/04 §3.3–3.4): lista las
 * decoraciones y luces que se colocan desde el lienzo (herramientas «Decorar» y
 * «Antorcha») y permite moverlas, cambiarlas y quitarlas, y fijar la luz
 * ambiente. Cada cambio es un comando de `room-doc`, los mismos que usa el MCP
 * (`decorate_subroom`); el panel no guarda la sala en estado local.
 */
export function RoomEditorRoomPanel({
  doc,
  room,
  objects,
  sprites,
  errorText,
}: RoomEditorRoomPanelProps) {
  const t = useTranslations("RoomEditor.roomPanel");
  const [error, setError] = useState<string | null>(null);

  const run = (command: () => unknown) => {
    try {
      command();
      setError(null);
    } catch (caught) {
      setError(errorText(toToolError(caught)));
    }
  };

  /** Valor entero de un `<input type="number">`, o `undefined` mientras se escribe. */
  const cellValue = (raw: string): number | undefined => {
    const value = Number.parseInt(raw, 10);
    return Number.isNaN(value) ? undefined : value;
  };

  const ambientIndex = room.lighting.findIndex((light) => light.type === "ambient");
  const ambient = ambientIndex >= 0 ? room.lighting[ambientIndex] : undefined;
  const torches = room.lighting
    .map((light, index) => ({ light, index }))
    .filter(
      (
        entry,
      ): entry is {
        light: Extract<SubRoom["lighting"][number], { type: "torch" }>;
        index: number;
      } => entry.light.type === "torch",
    );
  const spriteOptions = (current: string) =>
    sprites.includes(current) ? sprites : [current, ...sprites];

  return (
    <section className="space-y-4 text-sm" data-room-panel={room.id}>
      <h2 className="text-sm font-semibold">{t("title", { room: room.name || room.id })}</h2>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="space-y-2" data-room-decorations="">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">
          {t("decorations")}
        </h3>
        {room.decorations.length === 0 ? (
          <p className="text-xs text-white/50">{t("decorationsEmpty")}</p>
        ) : (
          <ul className="space-y-1">
            {room.decorations.map((decoration, index) => (
              <li
                // Las decoraciones no tienen id: se direccionan por posición en la lista.
                key={`${index}-${decoration.sprite}`}
                className="flex items-center gap-1"
                data-decoration={index}
              >
                <Select
                  value={decoration.sprite}
                  onValueChange={(value) => run(() => setDecorationSprite(doc, room.id, index, value))}
                >
                  <SelectTrigger
                    aria-label={t("sprite")}
                    className={`${INPUT} min-w-0 flex-1 justify-between font-mono`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {spriteOptions(decoration.sprite).map((sprite) => (
                      <SelectItem key={sprite} value={sprite}>
                        {sprite}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CellInputs
                  x={decoration.x}
                  y={decoration.y}
                  labelX={t("x")}
                  labelY={t("y")}
                  onChange={(axis, raw) => {
                    const value = cellValue(raw);
                    if (value === undefined) return;
                    run(() =>
                      moveDecoration(doc, room.id, index, {
                        x: axis === "x" ? value : decoration.x,
                        y: axis === "y" ? value : decoration.y,
                      }),
                    );
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs text-red-200 hover:bg-red-500/20"
                  aria-label={t("removeDecoration", { sprite: decoration.sprite })}
                  onClick={() => run(() => removeDecoration(doc, room.id, index))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-white/40">{t("decorationsHint")}</p>
      </div>

      <div className="space-y-2" data-room-lighting="">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">
          {t("lighting")}
        </h3>

        <div className="space-y-1" data-ambient-light={ambient ? "" : undefined}>
          <p className="text-xs text-white/70">{t("ambient")}</p>
          {ambient && ambient.type === "ambient" ? (
            <div className="flex items-center gap-2">
              <Input
                type="color"
                aria-label={t("color")}
                className="h-6 w-8 rounded border border-white/15 bg-transparent p-0"
                value={ambient.color}
                onChange={(event) =>
                  run(() =>
                    setAmbientLight(doc, room.id, {
                      color: event.target.value,
                      intensity: ambient.intensity,
                    }),
                  )
                }
              />
              <Label className="min-w-0 flex-1 gap-1 text-xs font-normal text-white/60">
                {t("intensity")}
                <Input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0"
                  value={ambient.intensity}
                  onChange={(event) =>
                    run(() =>
                      setAmbientLight(doc, room.id, {
                        color: ambient.color,
                        intensity: Number(event.target.value),
                      }),
                    )
                  }
                />
                <span className="w-8 text-right font-mono">{ambient.intensity}</span>
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs text-red-200 hover:bg-red-500/20"
                aria-label={t("removeAmbient")}
                onClick={() => run(() => setAmbientLight(doc, room.id, null))}
              >
                ×
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 border border-white/15 text-xs text-white hover:bg-white/10"
              onClick={() => run(() => setAmbientLight(doc, room.id, DEFAULT_AMBIENT))}
            >
              {t("addAmbient")}
            </Button>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs text-white/70">{t("torches")}</p>
          {torches.length === 0 ? (
            <p className="text-xs text-white/50">{t("torchesEmpty")}</p>
          ) : (
            <ul className="space-y-1">
              {torches.map(({ light, index }) => (
                <li key={index} className="flex items-center gap-1" data-torch={index}>
                  <CellInputs
                    x={light.x}
                    y={light.y}
                    labelX={t("x")}
                    labelY={t("y")}
                    onChange={(axis, raw) => {
                      const value = cellValue(raw);
                      if (value === undefined) return;
                      run(() => updateTorch(doc, room.id, index, { [axis]: value }));
                    }}
                  />
                  <Select
                    value={light.objectId ?? NO_OBJECT}
                    onValueChange={(value) =>
                      run(() =>
                        updateTorch(doc, room.id, index, {
                          objectId: value === NO_OBJECT ? null : value,
                        }),
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={t("governedBy")}
                      className={`${INPUT} min-w-0 flex-1 justify-between font-mono`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_OBJECT}>{t("noObject")}</SelectItem>
                      {objects.map((object) => (
                        <SelectItem key={object.id} value={object.id}>
                          {object.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-xs text-red-200 hover:bg-red-500/20"
                    aria-label={t("removeTorch")}
                    onClick={() => run(() => removeLight(doc, room.id, index))}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-white/40">{t("torchesHint")}</p>
        </div>
      </div>
    </section>
  );
}

function CellInputs({
  x,
  y,
  labelX,
  labelY,
  onChange,
}: {
  x: number;
  y: number;
  labelX: string;
  labelY: string;
  onChange: (axis: "x" | "y", raw: string) => void;
}) {
  return (
    <>
      <Input
        type="number"
        min={0}
        step={1}
        aria-label={labelX}
        className={`${INPUT} w-12 font-mono`}
        value={x}
        onChange={(event) => onChange("x", event.target.value)}
      />
      <Input
        type="number"
        min={0}
        step={1}
        aria-label={labelY}
        className={`${INPUT} w-12 font-mono`}
        value={y}
        onChange={(event) => onChange("y", event.target.value)}
      />
    </>
  );
}
