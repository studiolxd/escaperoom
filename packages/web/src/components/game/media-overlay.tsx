"use client";

import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { Button } from "@/components/ui/button";
import { canConnectMedia } from "@/lib/media";
import { useMediaStore, type MediaStatus } from "@/store/media-store";
import { MediaTiles } from "./media-tiles";

const STATUS_LABEL: Record<MediaStatus, string> = {
  idle: "medios: esperando",
  connecting: "conectando medios…",
  connected: "medios en directo",
  disconnected: "medios desconectados",
  error: "error de medios",
  unavailable: "sin medios",
};

const STATUS_DOT: Record<MediaStatus, string> = {
  idle: "bg-slate-400",
  connecting: "bg-amber-400",
  connected: "bg-emerald-400",
  disconnected: "bg-slate-400",
  error: "bg-rose-500",
  unavailable: "bg-amber-400",
};

/**
 * Overlay de voz/webcam (specs/12). Lee el payload `media_token` que la room
 * volcó en el store:
 *
 * - Sin claves LiveKit o sin token → estado "sin medios"; la partida sigue.
 * - Con token → conecta al SFU y reproduce el audio remoto, pero **sin
 *   publicar mic/cámara automáticamente** (F-3, privacidad): `audio={false}
 *   video={false}` en `LiveKitRoom`. El jugador los activa desde `MediaTiles`
 *   con un gesto explícito (`setMicrophoneEnabled`/`setCameraEnabled`).
 * - Observador → entra en solo-suscripción (`canPublish: false` en el token y
 *   sin publicar audio/vídeo local).
 *
 * Se carga solo en cliente (`ssr: false`) porque `livekit-client` usa APIs del
 * navegador (WebRTC, mediaDevices).
 */
export function MediaOverlay() {
  const status = useMediaStore((state) => state.status);
  const payload = useMediaStore((state) => state.payload);
  const error = useMediaStore((state) => state.error);
  const attempt = useMediaStore((state) => state.attempt);
  const setStatus = useMediaStore((state) => state.setStatus);
  const setError = useMediaStore((state) => state.setError);
  const retry = useMediaStore((state) => state.retry);

  const connect = canConnectMedia(payload);

  return (
    <div className="pointer-events-none absolute right-4 top-16 z-10 flex flex-col items-end gap-2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-xs text-white backdrop-blur">
        <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
        {STATUS_LABEL[status]}
        {error ? <span className="max-w-[12rem] truncate text-rose-300">· {error}</span> : null}
      </div>

      {connect && payload ? (
        <LiveKitRoom
          key={attempt}
          token={payload.token!}
          serverUrl={payload.url!}
          connect
          audio={false}
          video={false}
          onConnected={() => setStatus("connected")}
          onDisconnected={() => setStatus("disconnected")}
          onError={(mediaError) => setError(mediaError.message || "No se pudo conectar a LiveKit")}
        >
          <RoomAudioRenderer />
          <MediaTiles role={payload.role} canPublishVideo={payload.canPublishVideo} />
        </LiveKitRoom>
      ) : null}

      {payload && !payload.configured ? (
        <span className="pointer-events-none max-w-[16rem] rounded-lg border border-amber-300/30 bg-black/50 px-2 py-1 text-right text-[0.7rem] text-amber-200 backdrop-blur">
          LiveKit no configurado: la partida sigue sin voz ni webcam.
        </span>
      ) : null}

      {status === "error" || status === "disconnected" ? (
        <Button size="sm" variant="overlay" className="pointer-events-auto" onClick={retry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
