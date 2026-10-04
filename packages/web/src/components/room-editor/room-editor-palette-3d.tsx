"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Tool3DState } from "@escaperoom/editor";
import type { Model3DEntry, Models3DCatalog } from "@escaperoom/shared/packs";
import type { World3D } from "@escaperoom/shared/schemas";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { QUIET_BUTTON } from "./editor-shared";

/** Colores de la categoría (los mismos que las cajas de sustitución del runtime). */
export const CATEGORY_COLORS = {
  suelo: "#57534e",
  muro: "#78716c",
  estructura: "#a8a29e",
  mueble: "#b45309",
  pared: "#7c3aed",
  suelto: "#0891b2",
  propio: "#be185d",
} as const;

const KIT_CATEGORIES = ["suelo", "muro", "estructura"] as const;
const OBJECT_CATEGORIES = ["mueble", "pared", "suelto"] as const;

export const PALETTE_3D_TABS = ["kit", "objects", "mine"] as const;
export type Palette3DTab = (typeof PALETTE_3D_TABS)[number];

export interface RoomEditorPalette3DProps {
  catalog: Models3DCatalog | undefined;
  customModels: World3D["models"] | undefined;
  placing: Tool3DState["placing"];
  onSelectModel: (model: string, as: "piece" | "object", snap: boolean) => void;
}

type Item = {
  id: string;
  label: string;
  size: { w: number; d: number; hgt: number };
  color: string;
  snap: boolean;
  group?: string | undefined;
};

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function entryItem(id: string, entry: Model3DEntry, locale: string): Item {
  const text = entry.label[locale]?.text ?? entry.label.es?.text ?? Object.values(entry.label)[0]?.text;
  return {
    id,
    label: text || id,
    size: entry.size,
    color: CATEGORY_COLORS[entry.category],
    snap: entry.snap,
    group: entry.group,
  };
}

/**
 * Paleta del editor 3D (specs/27 §8): kit de construcción, objetos del pack y
 * modelos propios de la sala. Misma anchura y estilo que la paleta 2D.
 */
export function RoomEditorPalette3D({
  catalog,
  customModels,
  placing,
  onSelectModel,
}: RoomEditorPalette3DProps) {
  const t = useTranslations("RoomEditor");
  const locale = useLocale();
  const [tab, setTab] = useState<Palette3DTab>("kit");
  const [asDecoration, setAsDecoration] = useState(false);

  const entries = Object.entries(catalog?.models ?? {});
  const byCategory = (categories: readonly string[]) =>
    entries
      .filter(([, entry]) => categories.includes(entry.category))
      .map(([id, entry]) => ({ category: entry.category, item: entryItem(id, entry, locale) }));

  const kit = byCategory(KIT_CATEGORIES);
  const objects = byCategory(OBJECT_CATEGORIES);
  const mine: Item[] = Object.entries(customModels ?? {}).map(([id, model]) => ({
    id,
    label: model.label || id,
    size: model.size,
    color: CATEGORY_COLORS.propio,
    snap: false,
  }));

  const objectIds = new Set(objects.map((o) => o.item.id));

  const toggleDecoration = (checked: boolean) => {
    setAsDecoration(checked);
    // Con un modelo de esta pestaña ya elegido, el cambio se aplica a la colocación en curso.
    if (placing && objectIds.has(placing.model)) {
      onSelectModel(placing.model, checked ? "piece" : "object", false);
    }
  };

  const pick = (item: Item, as: "piece" | "object", snap: boolean) => onSelectModel(item.id, as, snap);

  const renderItem = (item: Item, as: "piece" | "object", snap: boolean) => {
    const active = placing?.model === item.id;
    return (
      <li key={item.id}>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "h-auto w-full justify-start gap-2 rounded border p-1.5 text-left text-xs text-white/80",
            active ? "border-amber-400 bg-amber-400/15" : "border-white/10 hover:border-white/30",
          )}
          aria-pressed={active}
          data-model={item.id}
          onClick={() => pick(item, as, snap)}
        >
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{item.label}</span>
            <span className="block text-[10px] text-white/50">
              {fmt(item.size.w)} × {fmt(item.size.d)} × {fmt(item.size.hgt)} m
            </span>
          </span>
        </Button>
      </li>
    );
  };

  const section = (heading: string, items: Item[], as: "piece" | "object", useSnap: boolean) => (
    <section key={heading} className="mb-3" data-palette-group={heading}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">{heading}</h3>
      <ul className="space-y-1">{items.map((item) => renderItem(item, as, useSnap ? item.snap : false))}</ul>
    </section>
  );

  const objectGroups = new Map<string, Item[]>();
  for (const { item } of objects) {
    const key = item.group ?? t("categories.suelto");
    objectGroups.set(key, [...(objectGroups.get(key) ?? []), item]);
  }

  return (
    <aside
      className="w-64 shrink-0 overflow-y-auto border-r border-white/10 p-3"
      aria-label={t("palette.title")}
    >
      <div role="tablist" aria-label={t("palette.title")} className="mb-3 flex gap-1">
        {PALETTE_3D_TABS.map((id) => (
          <Button
            key={id}
            size="sm"
            role="tab"
            variant={tab === id ? "secondary" : "ghost"}
            className={tab === id ? undefined : QUIET_BUTTON}
            aria-selected={tab === id}
            data-palette-tab={id}
            onClick={() => setTab(id)}
          >
            {t(`palette3d.${id}`)}
          </Button>
        ))}
      </div>

      {tab === "kit" &&
        KIT_CATEGORIES.map((category) => {
          const items = kit.filter((k) => k.category === category).map((k) => k.item);
          return items.length > 0 ? section(t(`categories.${category}`), items, "piece", true) : null;
        })}

      {tab === "objects" && (
        <>
          <Label className="mb-3 justify-between gap-2 text-xs font-normal text-white/70">
            {t("palette3d.asDecoration")}
            <Switch
              checked={asDecoration}
              onCheckedChange={toggleDecoration}
              data-as-decoration=""
            />
          </Label>
          {[...objectGroups].map(([group, items]) =>
            section(group, items, asDecoration ? "piece" : "object", false),
          )}
        </>
      )}

      {tab === "mine" &&
        (mine.length === 0 ? (
          <p className="text-xs text-white/50">{t("palette3d.mineEmpty")}</p>
        ) : (
          section(t("palette3d.mine"), mine, "object", false)
        ))}
    </aside>
  );
}
