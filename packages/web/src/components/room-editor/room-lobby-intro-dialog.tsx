"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type * as Y from "yjs";
import {
  MIN_LOBBY_DIMENSION,
  addLobbyRoom,
  getRoomIntroText,
  setRoomIntro,
  setRoomIntroSubtitles,
  setSubRoomKind,
  toToolError,
} from "@escaperoom/editor";
import { toRuntimeModel, type RuntimeModel } from "@escaperoom/game-runtime";
import {
  DEFAULT_LOBBY_GRID,
  DEFAULT_LOBBY_ROOM_NAME,
  MAX_GRID_DIMENSION,
  MAX_INTRO_TEXT_LENGTH,
  lobbyRoomOf,
  withLobbyRoom,
  type RoomPackage,
} from "@escaperoom/shared/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { LocalizedTextField, languageLabel } from "@/components/editor/localized-text-field";
import {
  checkIntroSubtitlesFile,
  checkIntroVideoFile,
  resolveIntroMediaUrl,
  uploadIntroSubtitles,
  uploadIntroVideo,
  type IntroFileProblem,
  introSubtitlesUrl,
} from "@/lib/intro-media-client";
import type { RoomPreviewPack } from "@/lib/room-preview-pack";

const RoomPreviewCanvas = dynamic(() => import("../room-preview/room-preview-canvas"), {
  ssr: false,
});

/** Props del lienzo de previsualización del lobby (inyectable en tests). */
export type LobbyPreviewRenderProps = {
  model: RuntimeModel;
  roomId: string;
  pack?: RoomPreviewPack;
};

const defaultRenderPreview = (props: LobbyPreviewRenderProps) => <RoomPreviewCanvas {...props} />;

const QUIET_BUTTON = "border border-white/15 text-white hover:bg-white/10";

/** Códigos de error de los comandos con texto propio en esta sección. */
const ERROR_CODES = ["LOBBY_CONFLICT", "INVALID_VALUE", "DUPLICATE_ID", "INVALID_ID"] as const;

type IntroType = "none" | "text" | "video";

export interface RoomLobbyIntroDialogProps {
  roomId: string;
  doc: Y.Doc;
  /** La sala en vivo (`useRoomPackage`). */
  pkg: RoomPackage;
  /** `false` en el modo local (sin servidor): no hay subida de medios. */
  uploadsEnabled: boolean;
  pack?: RoomPreviewPack;
  /** Lleva el lienzo del editor a la habitación indicada (el lobby diseñado). */
  onEditLobby: (roomId: string) => void;
  /** Lienzo de la previsualización del lobby; por defecto, el runtime Phaser de la previsualización. */
  renderPreview?: (props: LobbyPreviewRenderProps) => ReactNode;
}

/**
 * Sección «Lobby e introducción» del editor (encargo lobby-diseño, specs/09
 * §"Lobby e introducción"). El lobby es una habitación más del mapa con
 * `kind: "lobby"`: aquí se crea (con su tamaño) o se marca una existente, y
 * se pinta/decora en el propio lienzo; sin él, la partida usa el generado,
 * que se puede previsualizar. La introducción es ninguna, un texto
 * multiidioma o un vídeo con subtítulos WebVTT por idioma. Todo escribe con
 * los mismos comandos de `room-doc` que el MCP.
 */
export function RoomLobbyIntroDialog(props: RoomLobbyIntroDialogProps) {
  const t = useTranslations("RoomEditor.lobbyIntro");
  const [open, setOpen] = useState(false);
  const designed = lobbyRoomOf(props.pkg.map);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className={QUIET_BUTTON}>
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <LobbySection
          {...props}
          designedId={designed?.id}
          onEditLobby={(id) => {
            props.onEditLobby(id);
            setOpen(false);
          }}
        />
        <Separator />
        <IntroSection {...props} />
      </DialogContent>
    </Dialog>
  );
}

function useCommandError() {
  const t = useTranslations("RoomEditor.lobbyIntro");
  const [error, setError] = useState<string | null>(null);
  const run = (command: () => unknown): boolean => {
    try {
      command();
      setError(null);
      return true;
    } catch (caught) {
      const toolError = toToolError(caught);
      setError(
        (ERROR_CODES as readonly string[]).includes(toolError.code)
          ? t(`errors.${toolError.code as (typeof ERROR_CODES)[number]}`)
          : toolError.message,
      );
      return false;
    }
  };
  return { error, setError, run };
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function LobbySection({
  doc,
  pkg,
  pack,
  designedId,
  onEditLobby,
  renderPreview = defaultRenderPreview,
}: RoomLobbyIntroDialogProps & { designedId: string | undefined }) {
  const t = useTranslations("RoomEditor.lobbyIntro.lobby");
  const locale = useLocale();
  const { error, setError, run } = useCommandError();
  const [name, setName] = useState(DEFAULT_LOBBY_ROOM_NAME);
  const [cols, setCols] = useState(String(DEFAULT_LOBBY_GRID.cols));
  const [rows, setRows] = useState(String(DEFAULT_LOBBY_GRID.rows));
  const [markId, setMarkId] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const designed = pkg.map.rooms.find((room) => room.id === designedId);
  const candidates = pkg.map.rooms.filter((room) => room.id !== designedId);

  const preview = useMemo(() => {
    if (!previewOpen) return null;
    try {
      const played = withLobbyRoom(pkg);
      const lobby = lobbyRoomOf(played.map);
      if (!lobby) return { error: true as const };
      return { model: toRuntimeModel(played, { locale }), roomId: lobby.id };
    } catch {
      return { error: true as const };
    }
  }, [previewOpen, pkg, locale]);

  const create = () => {
    const c = Number(cols);
    const r = Number(rows);
    const valid = (value: number) =>
      Number.isInteger(value) && value >= MIN_LOBBY_DIMENSION && value <= MAX_GRID_DIMENSION;
    if (!valid(c) || !valid(r)) {
      setError(t("sizeInvalid", { min: MIN_LOBBY_DIMENSION, max: MAX_GRID_DIMENSION }));
      return;
    }
    let id = "";
    if (run(() => (id = addLobbyRoom(doc, { name, cols: c, rows: r })))) onEditLobby(id);
  };

  return (
    <section className="space-y-3 text-sm" data-lobby-section="">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{t("heading")}</h3>
        <Badge
          variant={designed ? "default" : "secondary"}
          data-lobby-status={designed ? "designed" : "default"}
        >
          {designed ? t("designed") : t("default")}
        </Badge>
      </div>

      {designed ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            {t("designedHint", {
              name: designed.name || designed.id,
              cols: designed.grid.cols,
              rows: designed.grid.rows,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onEditLobby(designed.id)}>
              {t("edit")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => setSubRoomKind(doc, designed.id, undefined))}
            >
              {t("unmark")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground">{t("defaultHint")}</p>
          <div className="grid grid-cols-[1fr_6rem_6rem] items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="lobby-name">{t("name")}</Label>
              <Input
                id="lobby-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lobby-cols">{t("cols")}</Label>
              <Input
                id="lobby-cols"
                type="number"
                min={MIN_LOBBY_DIMENSION}
                max={MAX_GRID_DIMENSION}
                value={cols}
                onChange={(event) => setCols(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lobby-rows">{t("rows")}</Label>
              <Input
                id="lobby-rows"
                type="number"
                min={MIN_LOBBY_DIMENSION}
                max={MAX_GRID_DIMENSION}
                value={rows}
                onChange={(event) => setRows(event.target.value)}
              />
            </div>
          </div>
          <Button size="sm" onClick={create}>
            {t("create")}
          </Button>
          {candidates.length > 1 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <Label htmlFor="lobby-mark">{t("markLabel")}</Label>
                <Select value={markId} onValueChange={setMarkId}>
                  <SelectTrigger id="lobby-mark" className="w-full">
                    <SelectValue placeholder={t("markPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((room) => (
                      <SelectItem key={room.id} value={room.id}>
                        {room.name || room.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!markId}
                onClick={() => {
                  if (run(() => setSubRoomKind(doc, markId, "lobby"))) onEditLobby(markId);
                }}
              >
                {t("mark")}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <Button size="sm" variant="ghost" onClick={() => setPreviewOpen((value) => !value)}>
          {previewOpen ? t("hidePreview") : t("preview")}
        </Button>
        {preview &&
          ("error" in preview ? (
            <p role="alert" className="text-destructive">
              {t("previewError")}
            </p>
          ) : (
            <div
              className="relative h-64 overflow-hidden rounded-md border bg-slate-950"
              data-lobby-preview={preview.roomId}
            >
              {renderPreview({ model: preview.model, roomId: preview.roomId, pack })}
            </div>
          ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Introducción
// ---------------------------------------------------------------------------

function IntroSection({ roomId, doc, pkg, uploadsEnabled }: RoomLobbyIntroDialogProps) {
  const t = useTranslations("RoomEditor.lobbyIntro.intro");
  const intro = pkg.meta.intro;
  const [wantVideo, setWantVideo] = useState(false);
  const { error, run } = useCommandError();
  const value: IntroType = intro?.type === "video" || wantVideo ? "video" : (intro?.type ?? "none");

  // El `YLocalizedText` vivo del doc: cambia de instancia al pasar de texto a vídeo y vuelta.
  const introText = useMemo(
    () => (intro?.type === "text" ? getRoomIntroText(doc) : undefined),
    [doc, intro],
  );

  const onTypeChange = (next: string) => {
    if (next === "video") {
      setWantVideo(true);
      return;
    }
    setWantVideo(false);
    if (next === "none") run(() => setRoomIntro(doc, null));
    else if (next === "text" && intro?.type !== "text") {
      run(() =>
        setRoomIntro(doc, { type: "text", text: { [pkg.meta.defaultLanguage]: { text: "" } } }),
      );
    }
  };

  return (
    <section className="space-y-3 text-sm" data-intro-section="">
      <div>
        <h3 className="font-semibold">{t("heading")}</h3>
        <p className="text-muted-foreground">{t("hint")}</p>
      </div>
      <RadioGroup
        aria-label={t("type")}
        value={value}
        onValueChange={onTypeChange}
        className="flex flex-wrap gap-4"
      >
        {(["none", "text", "video"] as const).map((option) => (
          <div key={option} className="flex items-center gap-2">
            <RadioGroupItem id={`intro-type-${option}`} value={option} />
            <Label htmlFor={`intro-type-${option}`} className="font-normal">
              {t(option)}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {value === "text" && introText && (
        <div className="space-y-1">
          <LocalizedTextField
            text={introText}
            languages={pkg.meta.languages}
            defaultLanguage={pkg.meta.defaultLanguage}
            label={t("textLabel")}
            rows={6}
          />
          <p className="text-xs text-muted-foreground">
            {t("textLimit", { max: MAX_INTRO_TEXT_LENGTH })}
          </p>
        </div>
      )}

      {value === "video" && (
        <IntroVideoEditor
          roomId={roomId}
          doc={doc}
          pkg={pkg}
          uploadsEnabled={uploadsEnabled}
          onUploaded={() => setWantVideo(false)}
        />
      )}
    </section>
  );
}

function problemKey(problem: IntroFileProblem) {
  return `problems.${problem}` as const;
}

function IntroVideoEditor({
  roomId,
  doc,
  pkg,
  uploadsEnabled,
  onUploaded,
}: {
  roomId: string;
  doc: Y.Doc;
  pkg: RoomPackage;
  uploadsEnabled: boolean;
  onUploaded: () => void;
}) {
  const t = useTranslations("RoomEditor.lobbyIntro.intro");
  const uiLocale = useLocale();
  const intro = pkg.meta.intro?.type === "video" ? pkg.meta.intro : undefined;
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyLang, setBusyLang] = useState<string | null>(null);
  const { error, run } = useCommandError();

  const onVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = checkIntroVideoFile(file);
    if (problem) {
      setMessage(t(problemKey(problem)));
      return;
    }
    setMessage(null);
    setProgress(0);
    try {
      const ref = await uploadIntroVideo(roomId, file, setProgress);
      // Conserva los subtítulos ya subidos al sustituir el vídeo.
      if (run(() => setRoomIntro(doc, { type: "video", video: ref, subtitles: intro?.subtitles })))
        onUploaded();
    } catch {
      setMessage(t("uploadError"));
    } finally {
      setProgress(null);
    }
  };

  const onSubtitles = async (lang: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = checkIntroSubtitlesFile(file);
    if (problem) {
      setMessage(t(problemKey(problem)));
      return;
    }
    setMessage(null);
    setBusyLang(lang);
    try {
      const ref = await uploadIntroSubtitles(roomId, lang, file);
      run(() => setRoomIntroSubtitles(doc, lang, ref));
    } catch {
      setMessage(t("uploadError"));
    } finally {
      setBusyLang(null);
    }
  };

  const uploading = progress !== null;

  return (
    <div className="space-y-3" data-intro-video="">
      {!uploadsEnabled && <p className="text-muted-foreground">{t("uploadsDisabled")}</p>}
      <div className="flex flex-col gap-1">
        <Label htmlFor="intro-video-file">{intro ? t("replaceVideo") : t("videoFile")}</Label>
        <Input
          id="intro-video-file"
          type="file"
          accept="video/mp4,video/webm"
          disabled={!uploadsEnabled || uploading}
          onChange={(event) => void onVideo(event)}
        />
      </div>
      {uploading && (
        <div className="space-y-1" data-intro-upload-progress="">
          <Progress value={Math.round(progress * 100)} aria-label={t("uploadingLabel")} />
          <p role="status" className="text-xs text-muted-foreground">
            {t("uploading", { percent: Math.round(progress * 100) })}
          </p>
        </div>
      )}
      {(message || error) && (
        <p role="alert" className="text-destructive">
          {message ?? error}
        </p>
      )}

      {intro ? (
        <>
          <IntroVideoPreview
            roomId={roomId}
            video={intro.video}
            subtitles={intro.subtitles ?? {}}
          />
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("subtitles")}
            </h4>
            <ul className="space-y-2">
              {pkg.meta.languages.map((lang) => {
                const language = languageLabel(lang, uiLocale);
                const has = Boolean(intro.subtitles?.[lang]);
                return (
                  <li
                    key={lang}
                    className="flex flex-wrap items-center gap-2"
                    data-subtitles={lang}
                  >
                    <Label htmlFor={`intro-vtt-${lang}`} className="w-28 font-normal">
                      {language}
                    </Label>
                    <Badge variant={has ? "default" : "outline"}>
                      {has ? t("subtitlesUploaded") : t("subtitlesMissing")}
                    </Badge>
                    <Input
                      id={`intro-vtt-${lang}`}
                      type="file"
                      accept=".vtt,text/vtt"
                      aria-label={t("subtitlesFor", { language })}
                      className="min-w-0 flex-1"
                      disabled={!uploadsEnabled || busyLang !== null}
                      onChange={(event) => void onSubtitles(lang, event)}
                    />
                    {has && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("removeSubtitles", { language })}
                        onClick={() => run(() => setRoomIntroSubtitles(doc, lang, null))}
                      >
                        ×
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">{t("noVideo")}</p>
      )}
    </div>
  );
}

/**
 * Vista previa del vídeo con `<video>` nativo (elemento de medios, no un
 * control de formulario): controles del navegador, sin autoplay, y una pista
 * `<track>` por idioma con subtítulos. Las URLs firmadas se piden al montar.
 */
function IntroVideoPreview({
  roomId,
  video,
  subtitles,
}: {
  roomId: string;
  video: string;
  subtitles: Record<string, string>;
}) {
  const t = useTranslations("RoomEditor.lobbyIntro.intro");
  const uiLocale = useLocale();
  const subtitlesKey = JSON.stringify(subtitles);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; url: string; tracks: { lang: string; url: string }[] }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const entries = Object.entries(JSON.parse(subtitlesKey) as Record<string, string>);
    Promise.all([
      resolveIntroMediaUrl(roomId, video),
      // Subtítulos desde el mismo origen (un `<track>` a la URL firmada del
      // bucket no carga sin CORS): ver `introSubtitlesUrl`.
      Promise.resolve(entries.map(([lang, ref]) => ({ lang, url: introSubtitlesUrl(roomId, ref) }))),
    ])
      .then(([url, tracks]) => {
        if (!cancelled) setState({ status: "ready", url, tracks: tracks.filter((tr) => tr.url) });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, video, subtitlesKey]);

  if (state.status === "error") {
    return <p className="text-muted-foreground">{t("previewUnavailable")}</p>;
  }
  if (state.status === "loading") return null;
  return (
    // Vista previa del creador: los subtítulos son opcionales (la sala puede no
    // tenerlos todavía); cuando existen van como `<track>` por idioma.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      key={state.url}
      controls
      preload="metadata"
      playsInline
      aria-label={t("previewLabel")}
      className="aspect-video w-full rounded-md bg-black"
      src={state.url}
      data-intro-preview=""
    >
      {state.tracks.map((track) => (
        <track
          key={track.lang}
          kind="subtitles"
          srcLang={track.lang}
          label={languageLabel(track.lang, uiLocale)}
          src={track.url}
        />
      ))}
    </video>
  );
}
