"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "@/components/error-boundary";
import { LobbyHud } from "./lobby-hud";

const LobbyCanvas = dynamic(() => import("./lobby-canvas"), {
  ssr: false,
  loading: () => <LobbyCanvasLoading />,
});

function LobbyCanvasLoading() {
  const t = useTranslations("Lobby");
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      {t("loading")}
    </div>
  );
}

/**
 * El overlay de medios usa `livekit-client`, que necesita APIs del navegador
 * (WebRTC, mediaDevices): se carga solo en cliente, igual que el canvas.
 */
const MediaOverlay = dynamic(() => import("./media-overlay").then((mod) => mod.MediaOverlay), {
  ssr: false,
});

/**
 * Contenedor del lobby multijugador: Phaser debajo (interpolando el estado
 * autoritativo de Colyseus) y overlay React encima, con los tiles de voz y
 * webcam (ticket 2.2).
 */
export function LobbyShell() {
  return (
    <section className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <LobbyCanvas />
      <LobbyHud />
      <ErrorBoundary>
        <MediaOverlay />
      </ErrorBoundary>
    </section>
  );
}
