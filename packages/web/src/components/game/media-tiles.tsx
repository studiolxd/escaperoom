"use client";

import { Track, type Participant } from "livekit-client";
import {
  VideoTrack,
  useIsSpeaking,
  useLocalParticipant,
  useParticipants,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { MediaRole } from "@/lib/media";
import type { MediaStatus } from "@/store/media-store";
import { LobbyDeviceCheck } from "../game-session/components/lobby-device-check";

const STATUS_DOT: Record<MediaStatus, string> = {
  idle: "bg-slate-400",
  connecting: "bg-amber-400",
  connected: "bg-emerald-400",
  disconnected: "bg-slate-400",
  error: "bg-rose-500",
  unavailable: "bg-amber-400",
};

export interface MediaTilesProps {
  role: MediaRole;
  canPublishVideo: boolean;
  status: MediaStatus;
  statusLabel: string;
  errorText: string | null;
}

/**
 * Tiles de webcam/mic del overlay (ticket 2.2). Debe montarse **dentro** de
 * `LiveKitRoom` para leer el contexto de la room. En modo observador no se
 * muestra ningún control de publicación: el token no lo permite (specs/12 §1.1).
 */
export function MediaTiles({
  role,
  canPublishVideo,
  status,
  statusLabel,
  errorText,
}: MediaTilesProps) {
  const t = useTranslations("Media");
  const participants = useParticipants();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const tracksByIdentity = new Map(
    cameraTracks.map((track) => [track.participant.identity, track] as const),
  );
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  const localTile = participants.find((participant) => participant.isLocal);
  const others = [...participants]
    .filter((participant) => !participant.isLocal)
    .sort((a, b) => a.identity.localeCompare(b.identity));

  return (
    <>
      <span className="text-xs uppercase tracking-wide text-white/50">{t("tiles.title")}</span>

      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1 text-xs text-white">
          <span aria-hidden className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
          {statusLabel}
        </span>
        {errorText ? <span className="text-[0.7rem] text-rose-300">{errorText}</span> : null}
      </div>

      {localTile ? (
        <div className="mt-1.5">
          <MediaTile
            participant={localTile}
            track={tracksByIdentity.get(localTile.identity)}
            forceCameraOff={!isCameraEnabled}
          />
        </div>
      ) : null}

      {role === "player" ? (
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="overlayGhost"
            aria-label={isMicrophoneEnabled ? t("tiles.mic.on") : t("tiles.mic.off")}
            onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          >
            {isMicrophoneEnabled ? <Mic /> : <MicOff />}
          </Button>
          {canPublishVideo ? (
            <Button
              size="icon-sm"
              variant="overlayGhost"
              aria-label={isCameraEnabled ? t("tiles.camera.on") : t("tiles.camera.off")}
              onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
            >
              {isCameraEnabled ? <Video /> : <VideoOff />}
            </Button>
          ) : (
            <span className="text-[0.7rem] text-white/50">{t("tiles.videoNotAllowed")}</span>
          )}
        </div>
      ) : (
        <p className="text-[0.7rem] text-white/50">{t("tiles.observer")}</p>
      )}

      {role === "player" ? <LobbyDeviceCheck fullWidth /> : null}

      {others.length > 0 ? (
        <div
          className="mt-2 flex flex-col gap-2 border-t border-white/10 py-2"
          data-testid="media-tiles"
        >
          {others.map((participant) => (
            <MediaTile
              key={participant.identity}
              participant={participant}
              track={tracksByIdentity.get(participant.identity)}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

interface MediaTileProps {
  participant: Participant;
  track: TrackReference | undefined;
  /** El propio participante: LiveKit puede seguir publicando el track un
   * instante tras apagar la cámara (`setCameraEnabled(false)`), así que no
   * basta con comprobar `track` para decidir si mostrar "Cámara apagada". */
  forceCameraOff?: boolean;
}

function MediaTile({ participant, track, forceCameraOff = false }: MediaTileProps) {
  const t = useTranslations("Media");
  const speaking = useIsSpeaking(participant);
  const label =
    participant.name?.trim() ||
    (participant.isLocal ? t("tiles.you") : participant.identity.slice(0, 8));
  const micLabel = participant.isMicrophoneEnabled
    ? t("tiles.micStatus.on")
    : t("tiles.micStatus.off");
  const showVideo = Boolean(track) && !forceCameraOff;

  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-lg border bg-white/10 ${
        speaking ? "border-emerald-400/70" : "border-white/10"
      }`}
    >
      {showVideo ? (
        <VideoTrack trackRef={track!} className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-[0.65rem] text-white/40">
          {t("tiles.cameraOff")}
        </div>
      )}
      {/* F-38: color/emoji redundantes con `sr-only` — el hablar solo se veía en el
          borde (color) y el mic solo en `title` (no siempre accesible, p. ej. táctil). */}
      {speaking ? <span className="sr-only">{t("tiles.speaking")}</span> : null}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/60 px-1.5 py-0.5 text-[0.6rem]">
        <span className="truncate">{label}</span>
        <span aria-hidden title={micLabel}>
          {participant.isMicrophoneEnabled ? (
            <Mic className="size-3" />
          ) : (
            <MicOff className="size-3" />
          )}
        </span>
        <span className="sr-only">{micLabel}</span>
      </span>
    </div>
  );
}
