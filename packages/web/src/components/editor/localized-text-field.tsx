"use client";

import { useCallback, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "cn";
import { setLocalizedValue, yLocalizedTextToJSON, type YLocalizedText } from "@escaperoom/editor";
import { missingTranslations, type LocalizedText } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Nombre legible de un idioma en el idioma de la UI (`en` → "inglés"); si no, el código. */
export function languageLabel(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Suscripción React a un `YLocalizedText`: re-renderiza con cualquier cambio
 * (local o remoto del proveedor de 3.3). El snapshot se cachea por versión para
 * que `useSyncExternalStore` reciba la misma referencia si nada cambió.
 */
export function useLocalizedText(text: YLocalizedText): LocalizedText {
  const store = useMemo(() => {
    let cached: LocalizedText = yLocalizedTextToJSON(text);
    return {
      subscribe(onChange: () => void) {
        const handler = () => {
          cached = yLocalizedTextToJSON(text);
          onChange();
        };
        text.observeDeep(handler);
        return () => text.unobserveDeep(handler);
      },
      getSnapshot: () => cached,
    };
  }, [text]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export interface LocalizedTextFieldProps {
  /** Campo `LocalizedText` del doc Yjs (p. ej. `ensureLocalizedField(doc, "dialogs", id)`). */
  text: YLocalizedText;
  /** Idiomas declarados de la sala (`meta.languages`), en orden. */
  languages: readonly string[];
  /** Idioma que se abre por defecto (`meta.defaultLanguage`). */
  defaultLanguage: string;
  /** Etiqueta visible del campo (ya traducida por el host). */
  label: string;
  /** Idioma activo inicial; si falta, el idioma por defecto. */
  initialLanguage?: string;
  rows?: number;
  className?: string;
}

/**
 * Campo de texto localizado del editor (specs/08 §2.2): un selector de idioma
 * activo (pestañas) y el área de texto de ESE idioma. Las pestañas de idiomas
 * sin traducción se marcan y debajo se resume qué falta. Escribe directamente
 * en el doc Yjs (solo la diferencia), así que la coedición y el guardado los
 * resuelve el proveedor de sincronización.
 */
export function LocalizedTextField({
  text,
  languages,
  defaultLanguage,
  label,
  initialLanguage,
  rows = 3,
  className,
}: LocalizedTextFieldProps) {
  const t = useTranslations("EditorI18n");
  const uiLocale = useLocale();
  const id = useId();
  const value = useLocalizedText(text);
  const [selected, setSelected] = useState(initialLanguage ?? defaultLanguage);
  // Si el idioma activo se retira (otro creador), vuelve al idioma por defecto.
  const active = languages.includes(selected) ? selected : defaultLanguage;
  const missing = missingTranslations(value, languages);

  const onChange = useCallback(
    (next: string) => setLocalizedValue(text, active, next),
    [text, active],
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="localized-text-field">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <div role="tablist" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1">
        {languages.map((code) => {
          const isMissing = missing.includes(code);
          const name = languageLabel(code, uiLocale);
          return (
            <Button
              key={code}
              type="button"
              variant="ghost"
              role="tab"
              id={`${id}-tab-${code}`}
              aria-selected={code === active}
              aria-controls={`${id}-panel`}
              data-language={code}
              data-missing={isMissing || undefined}
              title={isMissing ? t("missingOne", { language: name }) : name}
              onClick={() => setSelected(code)}
              className={cn(
                "h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium uppercase",
                code === active ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                isMissing && "text-amber-600 dark:text-amber-400",
              )}
            >
              {code}
              {code === defaultLanguage && <span aria-hidden="true">★</span>}
              {isMissing && (
                <span aria-label={t("missingOne", { language: name })} className="font-bold">
                  !
                </span>
              )}
            </Button>
          );
        })}
      </div>
      <Textarea
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${active}`}
        lang={active}
        rows={rows}
        value={value[active]?.text ?? ""}
        placeholder={t("placeholder", { language: languageLabel(active, uiLocale) })}
        onChange={(event) => onChange(event.target.value)}
        className="px-2 py-1.5 text-sm"
      />
      {missing.length > 0 && (
        <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
          {t("missingSummary", {
            languages: missing.map((code) => languageLabel(code, uiLocale)).join(", "),
          })}
        </p>
      )}
    </div>
  );
}
