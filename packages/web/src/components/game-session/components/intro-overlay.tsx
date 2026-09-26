"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { IntroModel } from "@/lib/intro-model";

export interface IntroOverlayProps {
  intro: IntroModel;
  onClose: () => void;
}

/** Nombre del idioma en el idioma del jugador (`es` → «español»), o el código si no se sabe. */
function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Pistas WebVTT como `blob:` del mismo origen (ver `IntroModel`): se crean al
 * montar y se revocan al desmontar.
 */
function useSubtitleUrls(subtitles: readonly { lang: string; vtt: string }[]) {
  const [urls, setUrls] = useState<{ lang: string; url: string }[]>([]);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const created = subtitles.map(({ lang, vtt }) => ({
      lang,
      url: URL.createObjectURL(new Blob([vtt], { type: "text/vtt" })),
    }));
    setUrls(created);
    return () => {
      for (const { url } of created) URL.revokeObjectURL(url);
    };
  }, [subtitles]);
  return urls;
}

/**
 * Introducción de la sala (encargo lobby-diseño, specs/04 §7): tras «Empezar»
 * (o al llegar tarde), antes del 3-2-1. Texto o vídeo; el jugador la cierra
 * cuando quiere, sin límite de tiempo, y no se puede volver a ver durante la
 * partida.
 *
 * El vídeo usa el `<video>` nativo (elemento de medios, permitido junto a
 * shadcn/ui) con controles accesibles del navegador, **sin autoplay** (nunca
 * suena solo) y subtítulos opcionales por idioma, con el del jugador por
 * defecto.
 */
export function IntroOverlay({ intro, onClose }: IntroOverlayProps) {
  const t = useTranslations("Game");
  const locale = useLocale();
  const titleId = useId();
  const subtitles = useMemo(() => (intro.kind === "video" ? intro.subtitles : []), [intro]);
  const tracks = useSubtitleUrls(subtitles);
  const defaultLang =
    tracks.find((track) => track.lang === locale)?.lang ??
    tracks.find((track) => locale.startsWith(track.lang))?.lang;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 grid place-items-center overflow-y-auto bg-slate-950/90 p-4 text-white backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="game-intro"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 rounded-xl border border-white/10 bg-slate-950 p-6 shadow-xl">
        <h2 id={titleId} className="text-lg font-semibold">
          {t("intro.title")}
        </h2>
        {intro.kind === "text" ? (
          <div
            className="max-h-[60dvh] overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-white/85"
            data-testid="game-intro-text"
          >
            {intro.text}
          </div>
        ) : (
          // Los subtítulos son opcionales (decisión del usuario): cuando el
          // creador los sube van como `<track>` por idioma, más abajo.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            controls
            playsInline
            preload="metadata"
            src={intro.videoUrl}
            aria-label={t("intro.videoLabel")}
            className="max-h-[60dvh] w-full rounded-lg bg-black"
            data-testid="game-intro-video"
          >
            {tracks.map((track) => (
              <track
                key={track.lang}
                kind="subtitles"
                src={track.url}
                srcLang={track.lang}
                label={languageName(track.lang, locale)}
                default={track.lang === defaultLang}
              />
            ))}
          </video>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/50">{t("intro.hint")}</p>
          <Button onClick={onClose} data-testid="game-intro-continue">
            {t("intro.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
