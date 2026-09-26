"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMediaStore } from "@/store/media-store";
import { DeviceCheck } from "./device-check";

/**
 * Prueba de micrófono/cámara del lobby solo si la partida usa voz/vídeo: el
 * token de medios (specs/12) dice si hay LiveKit configurado y si este
 * jugador puede publicar audio (y vídeo). Sin medios, no se pinta nada.
 *
 * En un popup (`Dialog`), no inline en el panel de "Audio y vídeo": abrir la
 * cámara/mic de prueba ahí competía por espacio con los tiles reales.
 */
export function LobbyDeviceCheck() {
  const payload = useMediaStore((state) => state.payload);
  const t = useTranslations("Game");
  const [open, setOpen] = useState(false);

  if (!payload?.configured || !payload.canPublish) return null;
  const withCamera = payload.canPublishVideo;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="overlayGhost" className="w-fit">
          {t(withCamera ? "lobby.deviceCheck.openWithCamera" : "lobby.deviceCheck.open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-black/80 text-white ring-white/10">
        <DialogHeader>
          <DialogTitle className="sr-only">
            {t(withCamera ? "lobby.deviceCheck.titleWithCamera" : "lobby.deviceCheck.title")}
          </DialogTitle>
        </DialogHeader>
        <DeviceCheck withCamera={withCamera} />
      </DialogContent>
    </Dialog>
  );
}
