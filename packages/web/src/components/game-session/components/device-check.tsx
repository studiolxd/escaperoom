"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export interface DeviceCheckProps {
  /** La sala permite publicar vídeo (si no, solo se prueba el micrófono). */
  withCamera: boolean;
  /**
   * Arranca la prueba al montar, sin el paso intermedio de pulsar "Probar"
   * (p. ej. dentro de un `Dialog` que el jugador ya abrió a propósito): el
   * estado inicial es "loading", no "idle", para que no se vea el botón
   * "Probar" ni un instante antes de pedir permiso de mic/cámara.
   */
  autoStart?: boolean;
}

type CheckState = "idle" | "loading" | "running" | "denied";

/**
 * Prueba de micrófono y cámara del lobby (encargo lobby-diseño), solo si la
 * partida usa voz/vídeo: abre el dispositivo LOCALMENTE (nada se publica en
 * la sala — eso sigue siendo un gesto explícito en `MediaTiles`, F-3), pinta
 * la vista previa de la cámara (silenciada) y el nivel del micrófono, y lo
 * suelta todo al parar o al salir del lobby.
 */
export function DeviceCheck({ withCamera, autoStart }: DeviceCheckProps) {
  const t = useTranslations("Game");
  const [state, setState] = useState<CheckState>(autoStart ? "loading" : "idle");
  const [level, setLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const start = useCallback(async () => {
    // Reentrada: `autoStart` no debe relanzar `getUserMedia` sobre una prueba
    // ya en marcha (p. ej. si `withCamera` cambiara y reejecutara el efecto).
    if (stopRef.current) return;
    setState("loading");
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
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyser) return;
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
      // Desconectar antes de cerrar (y no cerrar dos veces): reduce, sin
      // eliminarlo del todo, el margen para que el auto-suspend interno del
      // navegador (pestaña en segundo plano) choque con nuestro close() —
      // ver InvalidStateError "Cannot suspend a closed AudioContext",
      // filtrado también en Sentry (`sentry-nextjs-client.ts`).
      source?.disconnect();
      analyser?.disconnect();
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
      for (const track of stream.getTracks()) track.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current = null;
    };
    setState("running");
  }, [withCamera]);

  useEffect(() => {
    if (autoStart) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar, no en cada `start` nuevo por cambio de `withCamera`.
  }, [autoStart]);

  return (
    <div className="flex flex-col gap-2" data-testid="lobby-device-check">
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
      {state === "loading" ? (
        <p className="flex items-center gap-2 text-xs text-white/60">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {withCamera ? t("lobby.deviceCheck.loadingWithCamera") : t("lobby.deviceCheck.loading")}
        </p>
      ) : null}
      {state === "denied" ? (
        <p role="alert" className="text-xs text-amber-200">
          {t("lobby.deviceCheck.denied")}
        </p>
      ) : null}
    </div>
  );
}
