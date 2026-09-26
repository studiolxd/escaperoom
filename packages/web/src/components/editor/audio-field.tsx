"use client";

import { useId, useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "cn";
import { setLocalizedAudioUrl, type YLocalizedText } from "@escaperoom/editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUDIO_KINDS,
  libraryAudioRef,
  libraryTrackTitle,
  type AudioLibraryTrack,
} from "@escaperoom/shared/audio";
import { languageLabel, useLocalizedText } from "./localized-text-field";

/** Sentinel del `SelectItem` "sin audio" (Radix no admite `value=""`). */
const NONE = "__none__";

/** Subida propia tal y como la devuelve `GET /api/audio/uploads`. */
export type AudioUploadSummary = {
  ref: string;
  originalFilename: string;
  status: "approved" | "rejected";
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
 * con licencia) o subidas propias. Un audio rechazado en su día por la
 * extinta cola de moderación queda inutilizable (histórico). Lo usan los
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
      <Select
        value={value ?? NONE}
        onValueChange={(next) => onChange(next === NONE ? undefined : next)}
      >
        <SelectTrigger id={id} className="h-8 w-full text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("none")}</SelectItem>
          {AUDIO_KINDS.map((kind) => {
            const tracks = library.filter((track) => track.kind === kind);
            if (tracks.length === 0) return null;
            return (
              <SelectGroup key={kind}>
                <SelectLabel>{`${t("library")} · ${t(`kinds.${kind}`)}`}</SelectLabel>
                {tracks.map((track) => (
                  <SelectItem key={track.id} value={libraryAudioRef(track.id)}>
                    {libraryTrackTitle(track, uiLocale)}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
          {uploads.length > 0 && (
            <SelectGroup>
              <SelectLabel>{t("myUploads")}</SelectLabel>
              {uploads.map((upload) => (
                <SelectItem
                  key={upload.ref}
                  value={upload.ref}
                  // Un audio rechazado no se puede usar en ningún sitio.
                  disabled={upload.status === "rejected"}
                  data-status={upload.status}
                >
                  {upload.status === "approved"
                    ? upload.originalFilename
                    : t("optionRejected", { name: upload.originalFilename })}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {selectedTrack && (
        <p className="text-xs text-muted-foreground" data-testid="audio-credits">
          {t("credits", {
            license: selectedTrack.license.spdx,
            author: selectedTrack.credits.author,
          })}
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

/**
 * Subida de un MP3 propio con declaración de derechos (specs/15 §4).
 * Disponible al instante, sin moderación previa (ADR-039).
 */
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

  const rightsId = `${id}-rights`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="audio-upload">
      <div className="flex items-start gap-2 text-xs">
        <Checkbox
          id={rightsId}
          checked={rights}
          onCheckedChange={(checked) => setRights(checked === true)}
        />
        <Label htmlFor={rightsId} className="text-xs font-normal">
          {t("rightsDeclared")}
        </Label>
      </div>
      <Label
        htmlFor={`${id}-file`}
        aria-disabled={busy || undefined}
        className="h-8 w-fit cursor-pointer rounded-md border border-border px-3 text-sm font-normal hover:bg-muted"
      >
        {busy ? t("uploading") : t("upload")}
      </Label>
      <Input
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
            <Button
              key={code}
              type="button"
              variant="ghost"
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
                "h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium uppercase",
                code === active ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              {code}
              {hasAudio && <span aria-hidden="true">♪</span>}
            </Button>
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
