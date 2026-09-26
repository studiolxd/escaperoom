"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export interface DeviceCheckProps {
  /** La sala permite publicar vídeo (si no, solo se prueba el micrófono). */
  withCamera: boolean;
}

type CheckState = "idle" | "running" | "denied";

/**
 * Prueba de micrófono y cámara del lobby (encargo lobby-diseño), solo si la
 * partida usa voz/vídeo: abre el dispositivo LOCALMENTE (nada se publica en
 * la sala — eso sigue siendo un gesto explícito en `MediaTiles`, F-3), pinta
 * la vista previa de la cámara (silenciada) y el nivel del micrófono, y lo
 * suelta todo al parar o al salir del lobby.
 */
export function DeviceCheck({ withCamera }: DeviceCheckProps) {
  const t = useTranslations("Game");
  const [state, setState] = useState<CheckState>("idle");
  const [level, setLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setLevel(0);
    setState("idle");
  }, []);

  useEffect(() => () => stopRef.current?.(), []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("denied");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withCamera });
    } catch {
      setState("denied");
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;

    let frame = 0;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(samples);
        const peak = samples.reduce((max, value) => Math.max(max, value), 0);
        setLevel(Math.round((peak / 255) * 100));
        frame = window.requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Sin Web Audio: la prueba sigue valiendo para la cámara.
    }
    stopRef.current = () => {
      window.cancelAnimationFrame(frame);
      void context?.close().catch(() => undefined);
      for (const track of stream.getTracks()) track.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current = null;
    };
    setState("running");
  }, [withCamera]);

  return (
    <div className="flex flex-col gap-2" data-testid="lobby-device-check">
      <span className="text-[0.65rem] uppercase tracking-wide text-white/50">
        {withCamera ? t("lobby.deviceCheck.titleWithCamera") : t("lobby.deviceCheck.title")}
      </span>
      {withCamera ? (
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          aria-label={t("lobby.deviceCheck.preview")}
          className={state === "running" ? "aspect-video w-full rounded-md bg-black" : "hidden"}
        />
      ) : null}
      {state === "running" ? (
        <div className="flex items-center gap-2 text-xs text-white/70">
          <span>{t("lobby.deviceCheck.micLevel")}</span>
          <Progress
            value={level}
            aria-label={t("lobby.deviceCheck.micLevel")}
            className="bg-white/10"
          />
        </div>
      ) : null}
      {state === "denied" ? (
        <p role="alert" className="text-xs text-amber-200">
          {t("lobby.deviceCheck.denied")}
        </p>
      ) : null}
      <Button
        size="xs"
        variant="overlayGhost"
        onClick={state === "running" ? stop : () => void start()}
        data-testid="lobby-device-check-toggle"
      >
        {state === "running" ? t("lobby.deviceCheck.stop") : t("lobby.deviceCheck.start")}
      </Button>
    </div>
  );
}
