"use client";

import { useMediaStore } from "@/store/media-store";
import { DeviceCheck } from "./device-check";

/**
 * Prueba de micrófono/cámara del lobby solo si la partida usa voz/vídeo: el
 * token de medios (specs/12) dice si hay LiveKit configurado y si este
 * jugador puede publicar audio (y vídeo). Sin medios, no se pinta nada.
 */
export function LobbyDeviceCheck() {
  const payload = useMediaStore((state) => state.payload);
  if (!payload?.configured || !payload.canPublish) return null;
  return <DeviceCheck withCamera={payload.canPublishVideo} />;
}
