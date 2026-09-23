"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type * as Y from "yjs";
import {
  SchemaForm,
  createInspectorLabeler,
  idOptions,
  useRoomPackage,
  type InspectorLabelsInput,
  type SchemaFormContext,
} from "@escaperoom/editor";
import {
  checkTemplateConfig,
  createTemplatePreview,
  describeTemplateConfig,
  setTemplateConfig,
  type TemplateConfigCheck,
} from "@escaperoom/editor/template-config";
import { resolveIconFrame } from "@escaperoom/game-runtime";
import type { PuzzleDefinition, RoomPackage } from "@escaperoom/shared/schemas";
import { ItemIcon } from "@/components/puzzles/item-icon";
import type { InventoryItemView } from "@/components/puzzles/inventory-panel";
import type { RoomPreviewPack } from "@/lib/room-preview-pack";
import { PuzzlePreview } from "./template-preview";

export interface PuzzleConfiguratorProps {
  doc: Y.Doc;
  puzzle: PuzzleDefinition;
  /** Textos del inspector (`Inspector.labels`): nombres de campo y opciones. */
  labels?: InspectorLabelsInput;
  /** Pack gráfico de la sala (imagen del deslizante, iconos de ítems). */
  pack?: RoomPreviewPack;
  readOnly?: boolean;
}

/** Catálogo de ítems con el nombre en el idioma del editor (cae al idioma por defecto y al id). */
export function previewItems(pkg: RoomPackage, locale: string): InventoryItemView[] {
  return pkg.items.map((item) => {
    const name = item.name[locale]?.text || item.name[pkg.meta.defaultLanguage]?.text || item.id;
    return { id: item.id, name, ...(item.icon ? { icon: item.icon } : {}) };
  });
}

/**
 * Configurador de la plantilla (ticket 3.5), montado en el slot
 * `renderPuzzleConfigurator` del inspector (3.4):
 *
 * 1. **Aviso inmediato** si la configuración no es resoluble (oráculo de la
 *    plantilla, el mismo del validador) o no cumple el esquema.
 * 2. **Formulario** de los campos propios de la plantilla, generado de su
 *    esquema Zod; cada cambio se escribe en el doc Yjs.
 * 3. **Vista previa jugable** con el componente de juego de la plantilla en
 *    modo demo local (sin servidor), que se reinicia al cambiar la config.
 */
export function PuzzleConfigurator({
  doc,
  puzzle,
  labels,
  pack,
  readOnly = false,
}: PuzzleConfiguratorProps) {
  const t = useTranslations("TemplateConfig");
  const locale = useLocale();
  const pkg = useRoomPackage(doc);
  const labeler = useMemo(() => createInspectorLabeler(labels), [labels]);
  const root = useMemo(() => describeTemplateConfig(puzzle.type), [puzzle.type]);
  const [error, setError] = useState<string | null>(null);

  const check = checkTemplateConfig(puzzle);
  const previewKey = JSON.stringify(puzzle);
  const previewable = canPreview(puzzle, check);

  const ctx: SchemaFormContext = {
    t: labeler,
    idOptions: (ref) => idOptions(pkg, ref, puzzle),
    kinds: [],
    renderers: {},
    readOnly,
  };

  const items = useMemo(() => previewItems(pkg, locale), [pkg, locale]);

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="puzzle-configurator"
      data-template={puzzle.type}
    >
      <TemplateIssue check={check} t={t} />
      <SchemaForm
        root={root}
        value={puzzle as unknown as Record<string, unknown>}
        onPropertyChange={(key, value) => {
          try {
            setTemplateConfig(doc, puzzle, key, value);
            setError(null);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        }}
        ctx={ctx}
      />
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
      {previewable ? (
        <PuzzlePreview
          key={previewKey}
          puzzle={puzzle}
          baseUrl={pack?.baseUrl}
          items={items}
          renderIcon={(item) => (
            <ItemIcon
              frame={resolveIconFrame(pack?.manifest, item.icon ?? "")}
              baseUrl={pack?.baseUrl}
              name={item.name}
            />
          )}
        />
      ) : (
        <p className="text-xs text-white/60">{t("preview.unavailable")}</p>
      )}
    </div>
  );
}

/** La vista previa necesita una definición válida con la que la plantilla pueda arrancar. */
function canPreview(puzzle: PuzzleDefinition, check: TemplateConfigCheck): boolean {
  if (!check.ok && check.issue === "schema") return false;
  try {
    createTemplatePreview(puzzle);
    return true;
  } catch {
    return false;
  }
}

function TemplateIssue({
  check,
  t,
}: {
  check: TemplateConfigCheck;
  t: ReturnType<typeof useTranslations<"TemplateConfig">>;
}) {
  if (check.ok) {
    return (
      <p role="status" className="text-xs text-emerald-300" data-template-issue="none">
        {t("issues.ok")}
      </p>
    );
  }
  const message =
    check.issue === "schema"
      ? t("issues.schema", { fields: check.paths.join(", ") })
      : t(`issues.unsolvable.${check.type}`);
  return (
    <p
      role="alert"
      className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-xs text-amber-200"
      data-template-issue={check.issue}
    >
      {message}
    </p>
  );
}
