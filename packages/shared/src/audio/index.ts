/**
 * Audio del creador (ticket 3.11, specs/15 §1): biblioteca incluida,
 * referencias estables del borrador y análisis de MP3. Módulo puro, seguro para
 * el navegador; el servicio con persistencia y moderación está en
 * `@escaperoom/shared/services` (`createAudioAssetService`).
 */
export * from "./library";
export * from "./mp3";
export * from "./refs";
