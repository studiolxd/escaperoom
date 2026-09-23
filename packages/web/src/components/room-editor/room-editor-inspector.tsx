"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type * as Y from "yjs";
import {
  Inspector,
  type InspectorLabelsInput,
  type InspectorTarget,
  type LinkedTextSlotProps,
  type RulesGraphLabelsInput,
} from "@escaperoom/editor";
import { AUDIO_LIBRARY } from "@escaperoom/shared/audio";
import { LocalizedAudioField, type AudioUploadSummary } from "@/components/editor/audio-field";
import { LocalizedTextField } from "@/components/editor/localized-text-field";

/** Variables CSS del inspector sobre el fondo oscuro del editor. */
const INSPECTOR_STYLE = {
  "--inspector-input-bg": "#0f172a",
  "--inspector-border": "rgba(255,255,255,.18)",
  colorScheme: "dark",
} as CSSProperties;

/**
 * Subidas de audio propias (`GET /api/audio/uploads`) para el selector de 3.11.
 * Sin sesión (p. ej. el demo local) la lista queda vacía: la biblioteca
 * incluida sigue disponible.
 */
function useAudioUploads(enabled: boolean): AudioUploadSummary[] {
  const [uploads, setUploads] = useState<AudioUploadSummary[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/audio/uploads", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((body: { items?: AudioUploadSummary[] }) => setUploads(body.items ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [enabled]);
  return uploads;
}

export interface RoomEditorInspectorProps {
  doc: Y.Doc;
  target: InspectorTarget | null;
  onSelect: (target: InspectorTarget | null) => void;
  onOpenRule: (ruleId: string) => void;
  onDelete?: (target: InspectorTarget) => void;
  /** Cargar las subidas de audio propias (necesita sesión; no en el demo local). */
  loadUploads?: boolean;
}

/**
 * Inspector de propiedades (3.4) montado en el editor: los textos salen del
 * namespace `Inspector.labels` (los tipos de trigger, de `RulesGraph.labels`)
 * y los textos localizados usan los campos de 3.10 (texto por idioma) y 3.11
 * (audio por idioma).
 */
export function RoomEditorInspector({
  doc,
  target,
  onSelect,
  onOpenRule,
  onDelete,
  loadUploads = false,
}: RoomEditorInspectorProps) {
  const t = useTranslations("Inspector");
  const tGraph = useTranslations("RulesGraph");
  const uploads = useAudioUploads(loadUploads);
  const labels = useMemo(() => {
    const own = t.raw("labels") as InspectorLabelsInput;
    const graph = tGraph.raw("labels") as RulesGraphLabelsInput;
    return { ...own, options: { ...graph.triggers, ...own.options } };
  }, [t, tGraph]);

  const renderLocalizedText = (slot: LinkedTextSlotProps) => (
    <div className="flex flex-col gap-2">
      <LocalizedTextField
        text={slot.text}
        languages={slot.languages}
        defaultLanguage={slot.defaultLanguage}
        label={slot.label}
        rows={2}
      />
      {slot.audio && (
        <LocalizedAudioField
          text={slot.text}
          languages={slot.languages}
          defaultLanguage={slot.defaultLanguage}
          label={`${t("audio")} · ${slot.id}`}
          library={AUDIO_LIBRARY}
          uploads={uploads}
        />
      )}
    </div>
  );

  return (
    <div className="dark text-sm" data-testid="room-editor-inspector">
      <Inspector
        doc={doc}
        target={target}
        labels={labels}
        onSelect={onSelect}
        onOpenRule={onOpenRule}
        onDelete={onDelete}
        renderLocalizedText={renderLocalizedText}
        style={INSPECTOR_STYLE}
      />
    </div>
  );
}
