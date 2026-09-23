"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import type * as Y from "yjs";
import {
  RoomLanguageError,
  addRoomLanguage,
  countTranslations,
  getRoomLanguages,
  purgeLanguageTranslations,
  removeRoomLanguage,
  setDefaultLanguage,
  type RoomLanguages,
} from "@escaperoom/editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { languageLabel } from "./localized-text-field";

/** Suscripción React a `meta.languages`/`meta.defaultLanguage` del doc Yjs. */
export function useRoomLanguages(doc: Y.Doc): RoomLanguages {
  const store = useMemo(() => {
    let cached = getRoomLanguages(doc);
    return {
      subscribe(onChange: () => void) {
        const meta = doc.getMap("meta");
        const handler = () => {
          cached = getRoomLanguages(doc);
          onChange();
        };
        meta.observeDeep(handler);
        return () => meta.unobserveDeep(handler);
      },
      getSnapshot: () => cached,
    };
  }, [doc]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

type Pending = { code: string; translations: number };

/**
 * Gestión de los idiomas de la sala. Retirar un idioma pide confirmación y
 * avisa de cuántas traducciones tiene: por defecto se CONSERVAN en el borrador
 * (no se publican); borrarlas es una acción aparte, explícita y destructiva.
 */
export function RoomLanguagesEditor({ doc }: { doc: Y.Doc }) {
  const t = useTranslations("EditorI18n");
  const uiLocale = useLocale();
  const { languages, defaultLanguage } = useRoomLanguages(doc);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (caught) {
      if (caught instanceof RoomLanguageError) setError(t(`errors.${caught.code}`));
      else throw caught;
    }
  };

  const confirmRemove = (purge: boolean) => {
    if (!pending) return;
    run(() => {
      removeRoomLanguage(doc, pending.code);
      if (purge) purgeLanguageTranslations(doc, pending.code);
    });
    setPending(null);
  };

  return (
    <section className="flex flex-col gap-2" aria-labelledby="room-languages-title">
      <h3 id="room-languages-title" className="text-sm font-semibold">
        {t("languagesTitle")}
      </h3>
      <ul className="flex flex-col gap-1">
        {languages.map((code) => (
          <li key={code} className="flex items-center gap-2 text-sm" data-language={code}>
            <span className="min-w-24">
              {languageLabel(code, uiLocale)} <span className="uppercase opacity-60">({code})</span>
            </span>
            {code === defaultLanguage ? (
              <span className="text-xs opacity-80">{t("default")}</span>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => run(() => setDefaultLanguage(doc, code))}
                >
                  {t("makeDefault")}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setPending({ code, translations: countTranslations(doc, code) })}
                >
                  {t("remove")}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>

      {pending && (
        <div
          role="alertdialog"
          aria-labelledby="remove-language-title"
          className="rounded-md border p-2 text-sm"
        >
          <p id="remove-language-title">
            {t("removeWarning", {
              language: languageLabel(pending.code, uiLocale),
              count: pending.translations,
            })}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => confirmRemove(false)}>
              {t("removeKeep")}
            </Button>
            {pending.translations > 0 && (
              <Button size="sm" variant="destructive" onClick={() => confirmRemove(true)}>
                {t("removePurge")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const code = draft.trim();
          if (!code) return;
          run(() => addRoomLanguage(doc, code));
          setDraft("");
        }}
      >
        <Label className="sr-only" htmlFor="room-language-add">
          {t("addLabel")}
        </Label>
        <Input
          id="room-language-add"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("addPlaceholder")}
          className="h-7 w-24 px-2 text-sm"
        />
        <Button size="sm" type="submit">
          {t("add")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
