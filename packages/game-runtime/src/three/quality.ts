export type Quality3D = "high" | "low";

/** Ventana (s) de la media móvil de FPS. */
export const QUALITY_WINDOW_S = 5;
/** FPS medios por debajo de los cuales se baja a calidad baja. */
export const QUALITY_MIN_FPS = 30;
const EPSILON = 1e-6;

/**
 * Monitor de FPS para la calidad automática: media móvil de los últimos 5 s.
 * Solo avisa de bajar (una única vez); nunca de subir.
 */
export function createQualityMonitor(): {
  sample(dtSeconds: number): void;
  /** `true` una sola vez, cuando toca bajar. */
  shouldDowngrade(): boolean;
} {
  const samples: number[] = [];
  let total = 0;
  let fired = false;

  return {
    sample(dtSeconds) {
      if (!(dtSeconds > 0) || fired) return;
      samples.push(dtSeconds);
      total += dtSeconds;
      // Descarta lo más viejo mientras la ventana siga cubriendo 5 s sin ello.
      while (samples.length > 1 && total - samples[0]! >= QUALITY_WINDOW_S - EPSILON) {
        total -= samples.shift()!;
      }
    },
    shouldDowngrade() {
      if (fired || total < QUALITY_WINDOW_S - EPSILON) return false;
      const fps = samples.length / total;
      if (fps >= QUALITY_MIN_FPS - 1e-3) return false;
      fired = true;
      return true;
    },
  };
}
