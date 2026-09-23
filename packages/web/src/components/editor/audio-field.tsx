"use client";

import { useId, useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "cn";
import { setLocalizedAudioUrl, type YLocalizedText } from "@escaperoom/editor";
import {
  AUDIO_KINDS,
  libraryAudioRef,
  libraryTrackTitle,
  type AudioLibraryTrack,
} from "@escaperoom/shared/audio";
import { languageLabel, useLocalizedText } from "./localized-text-field";

/** Subida propia tal y como la devuelve `GET /api/audio/uploads`. */
export type AudioUploadSummary = {
  ref: string;
  originalFilename: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
};

export interface AudioSourceSelectProps {
  /** Referencia actual (`library:…` / `upload:…`) o `undefined` si no hay audio. */
  value: string | undefined;
  onChange: (ref: string | undefined) => void;
  library: readonly AudioLibraryTrack[];
  uploads: readonly AudioUploadSummary[];
  /** Id del `<select>` (para asociar una etiqueta externa). */
  id?: string;
  className?: string;
}

/**
 * Selector de la fuente de un audio: biblioteca incluida (agrupada por tipo,
 * con licencia) o subidas propias con su estado de moderación. Lo usan los
 * diálogos/pistas (por idioma) y los efectos de sonido.
 */
export function AudioSourceSelect({
  value,
  onChange,
  library,
  uploads,
  id,
  className,
}: AudioSourceSelectProps) {
  const t = useTranslations("EditorAudio");
  const uiLocale = useLocale();
  const selectedUpload = uploads.find((u) => u.ref === value);
  const selectedTrack = library.find((track) => libraryAudioRef(track.id) === value);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      >
        <option value="">{t("none")}</option>
        {AUDIO_KINDS.map((kind) => {
          const tracks = library.filter((track) => track.kind === kind);
          if (tracks.length === 0) return null;
          return (
            <optgroup key={kind} label={`${t("library")} · ${t(`kinds.${kind}`)}`}>
              {tracks.map((track) => (
                <option key={track.id} value={libraryAudioRef(track.id)}>
                  {libraryTrackTitle(track, uiLocale)}
                </option>
              ))}
            </optgroup>
          );
        })}
        {uploads.length > 0 && (
          <optgroup label={t("myUploads")}>
            {uploads.map((upload) => (
              <option
                key={upload.ref}
                value={upload.ref}
                // Un audio rechazado no se puede usar en ningún sitio.
                disabled={upload.status === "rejected"}
                data-status={upload.status}
              >
                {upload.status === "approved"
                  ? upload.originalFilename
                  : t(upload.status === "pending" ? "optionPending" : "optionRejected", {
                      name: upload.originalFilename,
                    })}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {selectedTrack && (
        <p className="text-xs text-muted-foreground" data-testid="audio-credits">
          {t("credits", {
            license: selectedTrack.license.spdx,
            author: selectedTrack.credits.author,
          })}
        </p>
      )}
      {selectedUpload?.status === "pending" && (
        <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
          {t("status.pending")}
        </p>
      )}
      {selectedUpload?.status === "rejected" && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {t("status.rejected", { reason: selectedUpload.rejectionReason ?? "—" })}
        </p>
      )}
    </div>
  );
}

/** Error de subida con el `code` de la API (`PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`…). */
export type AudioUploadError = { code?: string };

export interface AudioUploadButtonProps {
  /** Sube el fichero (`POST /api/audio/uploads`); rechaza con `{ code }` si la API falla. */
  onUpload: (file: File, opts: { rightsDeclared: true }) => Promise<void>;
  maxBytes: number;
  maxDurationMs: number;
  className?: string;
}

const ERROR_KEY: Record<string, "tooLarge" | "notMp3" | "rightsRequired"> = {
  PAYLOAD_TOO_LARGE: "tooLarge",
  UNSUPPORTED_MEDIA_TYPE: "notMp3",
};

/** Subida de un MP3 propio con declaración de derechos (specs/15 §4). */
export function AudioUploadButton({
  onUpload,
  maxBytes,
  maxDurationMs,
  className,
}: AudioUploadButtonProps) {
  const t = useTranslations("EditorAudio");
  const id = useId();
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"tooLarge" | "notMp3" | "rightsRequired" | "generic" | null>(
    null,
  );
  const maxMb = Math.round(maxBytes / (1024 * 1024));
  const maxMinutes = Math.round(maxDurationMs / 60_000);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // Pre-comprobaciones locales; el servidor vuelve a validar el contenido real.
    if (!rights) return setError("rightsRequired");
    if (file.size > maxBytes) return setError("tooLarge");
    if (!/\.mp3$/i.test(file.name) && file.type !== "audio/mpeg") return setError("notMp3");
    setError(null);
    setBusy(true);
    try {
      await onUpload(file, { rightsDeclared: true });
    } catch (err) {
      setError(ERROR_KEY[(err as AudioUploadError)?.code ?? ""] ?? "generic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="audio-upload">
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={rights}
          onChange={(event) => setRights(event.target.checked)}
        />
        <span>{t("rightsDeclared")}</span>
      </label>
      <label
        htmlFor={`${id}-file`}
        aria-disabled={busy || undefined}
        className="inline-flex h-8 w-fit cursor-pointer items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
      >
        {busy ? t("uploading") : t("upload")}
      </label>
      <input
        id={`${id}-file`}
        type="file"
        accept="audio/mpeg,.mp3"
        className="sr-only"
        disabled={busy}
        onChange={onFile}
      />
      <p className="text-xs text-muted-foreground">{t("uploadHint", { maxMb, maxMinutes })}</p>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {t(`errors.${error}`, { maxMb })}
        </p>
      )}
    </div>
  );
}

export interface LocalizedAudioFieldProps {
  /** Campo `LocalizedText` del diálogo o pista (`ensureLocalizedField`). */
  text: YLocalizedText;
  languages: readonly string[];
  defaultLanguage: string;
  label: string;
  library: readonly AudioLibraryTrack[];
  uploads: readonly AudioUploadSummary[];
  initialLanguage?: string;
  className?: string;
}

/**
 * Audio POR IDIOMA de un diálogo o pista (specs/08 §2.2): pestañas de idioma y
 * el selector de fuente del idioma activo. Escribe `audioUrl` en el doc Yjs.
 */
export function LocalizedAudioField({
  text,
  languages,
  defaultLanguage,
  label,
  library,
  uploads,
  initialLanguage,
  className,
}: LocalizedAudioFieldProps) {
  const t = useTranslations("EditorAudio");
  const uiLocale = useLocale();
  const id = useId();
  const value = useLocalizedText(text);
  const [selected, setSelected] = useState(initialLanguage ?? defaultLanguage);
  const active = languages.includes(selected) ? selected : defaultLanguage;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="localized-audio-field">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <div role="tablist" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1">
        {languages.map((code) => {
          const hasAudio = Boolean(value[code]?.audioUrl);
          return (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={code === active}
              data-language={code}
              data-has-audio={hasAudio || undefined}
              title={
                hasAudio
                  ? languageLabel(code, uiLocale)
                  : t("noAudioIn", { language: languageLabel(code, uiLocale) })
              }
              onClick={() => setSelected(code)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium uppercase",
                code === active ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              {code}
              {hasAudio && <span aria-hidden="true">♪</span>}
            </button>
          );
        })}
      </div>
      <AudioSourceSelect
        value={value[active]?.audioUrl}
        onChange={(ref) => setLocalizedAudioUrl(text, active, ref)}
        library={library}
        uploads={uploads}
      />
    </div>
  );
}
