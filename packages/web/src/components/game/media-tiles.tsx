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
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { MediaRole } from "@/lib/media";

export interface MediaTilesProps {
  role: MediaRole;
  canPublishVideo: boolean;
}

/**
 * Tiles de webcam/mic del overlay (ticket 2.2). Debe montarse **dentro** de
 * `LiveKitRoom` para leer el contexto de la room. En modo observador no se
 * muestra ningún control de publicación: el token no lo permite (specs/12 §1.1).
 */
export function MediaTiles({ role, canPublishVideo }: MediaTilesProps) {
  const t = useTranslations("Media");
  const participants = useParticipants();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const tracksByIdentity = new Map(
    cameraTracks.map((track) => [track.participant.identity, track] as const),
  );
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  const ordered = [...participants].sort((a, b) => {
    if (a.isLocal !== b.isLocal) {
      return a.isLocal ? -1 : 1;
    }
    return a.identity.localeCompare(b.identity);
  });

  return (
    <div className="pointer-events-auto flex w-64 flex-col gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-3 text-white backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-white/50">{t("tiles.title")}</span>
        <span className="text-xs text-white/60">{ordered.length}</span>
      </div>

      <div className="grid grid-cols-2 gap-2" data-testid="media-tiles">
        {ordered.length === 0 ? (
          <p className="col-span-2 text-[0.7rem] text-white/40">{t("tiles.empty")}</p>
        ) : null}
        {ordered.map((participant) => (
          <MediaTile
            key={participant.identity}
            participant={participant}
            track={tracksByIdentity.get(participant.identity)}
          />
        ))}
      </div>

      {role === "player" ? (
        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-2">
          <Button
            size="sm"
            variant={isMicrophoneEnabled ? "overlay" : "default"}
            onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          >
            {isMicrophoneEnabled ? t("tiles.mic.on") : t("tiles.mic.off")}
          </Button>
          {canPublishVideo ? (
            <Button
              size="sm"
              variant={isCameraEnabled ? "overlay" : "default"}
              onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
            >
              {isCameraEnabled ? t("tiles.camera.on") : t("tiles.camera.off")}
            </Button>
          ) : (
            <span className="self-center text-[0.7rem] text-white/50">
              {t("tiles.videoNotAllowed")}
            </span>
          )}
        </div>
      ) : (
        <p className="border-t border-white/10 pt-2 text-[0.7rem] text-white/50">
          {t("tiles.observer")}
        </p>
      )}
    </div>
  );
}

interface MediaTileProps {
  participant: Participant;
  track: TrackReference | undefined;
}

function MediaTile({ participant, track }: MediaTileProps) {
  const t = useTranslations("Media");
  const speaking = useIsSpeaking(participant);
  const label =
    participant.name?.trim() || (participant.isLocal ? t("tiles.you") : participant.identity.slice(0, 8));
  const micLabel = participant.isMicrophoneEnabled ? t("tiles.micStatus.on") : t("tiles.micStatus.off");

  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-lg border bg-slate-900 ${
        speaking ? "border-emerald-400/70" : "border-white/10"
      }`}
    >
      {track ? (
        <VideoTrack trackRef={track} className="h-full w-full object-cover" />
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
          {participant.isMicrophoneEnabled ? "🎤" : "🔇"}
        </span>
        <span className="sr-only">{micLabel}</span>
      </span>
    </div>
  );
}
