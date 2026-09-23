"use client";

import { useTranslations } from "next-intl";
import type { EditTool, EditorTileLayer } from "@escaperoom/editor";
import type { EditorPalette } from "@escaperoom/game-runtime";
import type { WorldObject } from "@escaperoom/shared/schemas";
import { cn } from "@/lib/utils";

export interface RoomEditorPaletteProps {
  palette: EditorPalette;
  /** Objetos de la sala, solo para el contador derivado de «cuántos hay colocados». */
  objects: readonly WorldObject[];
  tool: EditTool;
  tileId: number;
  sprite?: string;
  onSelectTile: (tileId: number, layer: EditorTileLayer) => void;
  onSelectSprite: (sprite: string) => void;
}

/**
 * Palette del editor (specs/09 §4.1): catálogo estático del pack (tiles y
 * sprites de objetos). No conoce el estado de la sala salvo el contador de
 * objetos colocados, derivado del doc.
 */
export function RoomEditorPalette({
  palette,
  objects,
  tool,
  tileId,
  sprite,
  onSelectTile,
  onSelectSprite,
}: RoomEditorPaletteProps) {
  const t = useTranslations("RoomEditor");
  const placed = new Map<string, number>();
  for (const object of objects) placed.set(object.sprite, (placed.get(object.sprite) ?? 0) + 1);
  const paintsTiles = tool === "brush" || tool === "fill";

  return (
    <aside
      className="w-64 shrink-0 overflow-y-auto border-r border-white/10 p-3"
      aria-label={t("palette.title")}
    >
      <p className="mb-3 text-xs text-white/50">{t("palette.pack", { packId: palette.packId })}</p>

      <h2 className="mb-2 text-sm font-semibold">{t("palette.tiles")}</h2>
      <ul className="mb-4 grid grid-cols-4 gap-1.5" data-palette="tiles">
        {palette.tiles.map((tile) => {
          const active = paintsTiles && tile.tileId === tileId;
          return (
            <li key={tile.tileId}>
              <button
                type="button"
                className={cn(
                  "flex w-full flex-col items-center rounded border p-1 text-[10px] text-white/70",
                  active ? "border-sky-400 bg-sky-400/15" : "border-white/10 hover:border-white/30",
                )}
                aria-pressed={active}
                title={t("palette.tileTitle", {
                  tileId: tile.tileId,
                  layer: t(`layers.${tile.layer}`),
                })}
                onClick={() => onSelectTile(tile.tileId, tile.layer)}
              >
                <Thumbnail src={tile.thumbnail} label={String(tile.tileId)} />
                {tile.tileId}
              </button>
            </li>
          );
        })}
      </ul>

      <h2 className="mb-2 text-sm font-semibold">{t("palette.objects")}</h2>
      {palette.sprites.length === 0 ? (
        <p className="text-xs text-white/50">{t("palette.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5" data-palette="objects">
          {palette.sprites.map((entry) => {
            const active = tool === "place" && entry.sprite === sprite;
            const count = placed.get(entry.sprite) ?? 0;
            return (
              <li key={entry.sprite}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col items-center rounded border p-1 text-[10px] text-white/70",
                    active
                      ? "border-amber-400 bg-amber-400/15"
                      : "border-white/10 hover:border-white/30",
                  )}
                  aria-pressed={active}
                  onClick={() => onSelectSprite(entry.sprite)}
                >
                  <Thumbnail src={entry.thumbnail} label={entry.sprite} tall />
                  <span className="w-full truncate font-mono">{entry.sprite}</span>
                  {count > 0 && (
                    <span className="text-white/50">{t("palette.placed", { count })}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function Thumbnail({ src, label, tall }: { src?: string; label: string; tall?: boolean }) {
  const size = tall ? "h-12 w-10" : "h-8 w-12";
  if (!src) {
    return (
      <span className={cn("grid place-items-center rounded bg-white/5 text-white/40", size)}>
        {label.slice(0, 2)}
      </span>
    );
  }
  // Miniaturas SVG/PNG estáticas del pack: `next/image` no aporta nada aquí.
  return <img src={src} alt="" className={cn("object-contain", size)} loading="lazy" />;
}
