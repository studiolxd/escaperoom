"use client";

import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { ConnectionError } from "livekit-client";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { canConnectMedia } from "@/lib/media";
import { useMediaStore } from "@/store/media-store";
import { MediaTiles } from "./media-tiles";

/**
 * Sentinel para `error` en el store cuando no se puede identificar el motivo
 * de LiveKit (F-10): el store no depende de next-intl (no es un componente),
 * así que guarda esto en vez de un texto fijo en castellano; el overlay lo
 * traduce al pintarlo.
 */
const GENERIC_MEDIA_ERROR = "__generic_media_error__";

/**
 * Motivos de `ConnectionError` (`livekit-client`) con traducción propia
 * (`Media.connectionError.*`, en vez del `error.message` crudo de la
 * librería, en inglés y pensado para depurar, no para un jugador).
 */
const CONNECTION_ERROR_REASONS = [
  "NotAllowed",
  "ServerUnreachable",
  "InternalError",
  "Cancelled",
  "LeaveRequest",
  "Timeout",
  "WebSocket",
  "ServiceNotFound",
] as const;
type ConnectionErrorReasonName = (typeof CONNECTION_ERROR_REASONS)[number];

function isConnectionErrorReasonName(value: string): value is ConnectionErrorReasonName {
  return (CONNECTION_ERROR_REASONS as readonly string[]).includes(value);
}

// Callbacks estables a propósito: `useLiveKitRoom` tiene `onError` en las
// dependencias del efecto que llama a `room.connect()`. Con arrows inline, cada
// re-render (p. ej. al pasar el estado a "error" o "disconnected") relanzaba
// `connect()`; si el SFU no responde, el fallo alternaba esos dos estados y
// entraba en un bucle de reconexiones que acababa colgando el navegador.
const handleConnected = () => useMediaStore.getState().setStatus("connected");
const handleDisconnected = () => useMediaStore.getState().setStatus("disconnected");

/** Guarda el `reasonName` (p. ej. "Cancelled", "ServerUnreachable"), nunca el mensaje crudo. */
const handleError = (mediaError: Error) => {
  const reason = mediaError instanceof ConnectionError ? mediaError.reasonName : null;
  useMediaStore.getState().setError(reason ?? GENERIC_MEDIA_ERROR);
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
  const t = useTranslations("Media");
  const status = useMediaStore((state) => state.status);
  const payload = useMediaStore((state) => state.payload);
  const error = useMediaStore((state) => state.error);
  const attempt = useMediaStore((state) => state.attempt);
  const retry = useMediaStore((state) => state.retry);

  const connect = canConnectMedia(payload);
  const statusLabel = t(`status.${status}`);
  const errorText = error
    ? isConnectionErrorReasonName(error)
      ? t(`connectionError.${error}`)
      : t("genericError")
    : null;

  return (
    <div className="pointer-events-none absolute right-4 top-16 z-10 flex flex-col items-end gap-2">
      {connect && payload ? (
        <div className="pointer-events-auto flex w-64 flex-col gap-2 rounded-md border border-white/10 bg-black/50 px-3 py-3 text-white backdrop-blur">
          <ErrorBoundary>
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
              <MediaTiles
                role={payload.role}
                canPublishVideo={payload.canPublishVideo}
                status={status}
                statusLabel={statusLabel}
                errorText={errorText}
              />
            </LiveKitRoom>
          </ErrorBoundary>
        </div>
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
