"use client";

import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { canConnectMedia } from "@/lib/media";
import { useMediaStore, type MediaStatus } from "@/store/media-store";
import { MediaTiles } from "./media-tiles";

const STATUS_DOT: Record<MediaStatus, string> = {
  idle: "bg-slate-400",
  connecting: "bg-amber-400",
  connected: "bg-emerald-400",
  disconnected: "bg-slate-400",
  error: "bg-rose-500",
  unavailable: "bg-amber-400",
};

/**
 * Sentinel para `error` en el store cuando LiveKit no da un mensaje (F-10): el
 * store no depende de next-intl (no es un componente), así que guarda esto en
 * vez de un texto fijo en castellano; el overlay lo traduce al pintarlo.
 */
const GENERIC_MEDIA_ERROR = "__generic_media_error__";

// Callbacks estables a propósito: `useLiveKitRoom` tiene `onError` en las
// dependencias del efecto que llama a `room.connect()`. Con arrows inline, cada
// re-render (p. ej. al pasar el estado a "error" o "disconnected") relanzaba
// `connect()`; si el SFU no responde, el fallo alternaba esos dos estados y
// entraba en un bucle de reconexiones que acababa colgando el navegador.
const handleConnected = () => useMediaStore.getState().setStatus("connected");
const handleDisconnected = () => useMediaStore.getState().setStatus("disconnected");
const handleError = (mediaError: Error) =>
  useMediaStore.getState().setError(mediaError.message || GENERIC_MEDIA_ERROR);

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
  const t = useTranslations("Media");
  const status = useMediaStore((state) => state.status);
  const payload = useMediaStore((state) => state.payload);
  const error = useMediaStore((state) => state.error);
  const attempt = useMediaStore((state) => state.attempt);
  const retry = useMediaStore((state) => state.retry);

  const connect = canConnectMedia(payload);
  const statusLabel = t(`status.${status}`);
  const errorText = error ? (error === GENERIC_MEDIA_ERROR ? t("genericError") : error) : null;

  return (
    <div className="pointer-events-none absolute right-4 top-16 z-10 flex flex-col items-end gap-2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-xs text-white backdrop-blur">
        <span aria-hidden className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
        {statusLabel}
        {errorText ? <span className="max-w-[12rem] truncate text-rose-300">· {errorText}</span> : null}
      </div>

      {connect && payload ? (
        <LiveKitRoom
          key={attempt}
          token={payload.token!}
          serverUrl={payload.url!}
          connect
          audio={false}
          video={false}
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onError={handleError}
        >
          <RoomAudioRenderer />
          <MediaTiles role={payload.role} canPublishVideo={payload.canPublishVideo} />
        </LiveKitRoom>
      ) : null}

      {payload && !payload.configured ? (
        <span className="pointer-events-none max-w-[16rem] rounded-lg border border-amber-300/30 bg-black/50 px-2 py-1 text-right text-[0.7rem] text-amber-200 backdrop-blur">
          {t("notConfigured")}
        </span>
      ) : null}

      {status === "error" || status === "disconnected" ? (
        <Button size="sm" variant="overlay" className="pointer-events-auto" onClick={retry}>
          {t("retry")}
        </Button>
      ) : null}
    </div>
  );
}
