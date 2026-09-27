/**
 * Constantes puras de audio del creador (subida propia + generación con IA,
 * ticket 3.11/4.9, specs/15 §1-2), sin dependencias de dominio (Prisma,
 * ElevenLabs, colas…): viven en `@escaperoom/shared/audio` — el subpath
 * seguro para importar desde un componente cliente — en vez de en
 * `@escaperoom/shared/services`, cuyo barril arrastra BullMQ y otros paquetes
 * solo-servidor y rompe el build de Next si un `"use client"` lo importa
 * (`worker_threads` no existe en el navegador). `services/audio-assets.ts` y
 * `services/audio-generation.ts` re-exportan estos símbolos para no romper a
 * quien ya los importaba de ahí.
 */

/** Límites de subida de un MP3 propio (specs/15 §1). */
export type AudioUploadLimits = { maxBytes: number; maxDurationMs: number };

export const DEFAULT_AUDIO_UPLOAD_LIMITS: AudioUploadLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxDurationMs: 10 * 60 * 1000,
};

/**
 * Coste contable de la generación por IA (specs/15 §2, specs/02 §6):
 * caracteres × tarifa ElevenLabs → créditos internos, redondeo a la unidad,
 * mínimo 1 crédito. Ver `docs/reference/registro-de-decisiones.md` (ADR sobre
 * la tarifa, aún abierta a revisar cuando 5.1/5.2 fijen el precio del crédito).
 */
export const CHARACTERS_PER_CREDIT = 40;

/** Límite de caracteres por generación (evita una factura de ElevenLabs desbocada). */
export const MAX_GENERATION_CHARACTERS = 5000;

export function calculateAudioGenerationCost(characterCount: number): number {
  if (characterCount <= 0) {
    throw new RangeError("El texto no puede estar vacío");
  }
  return Math.max(1, Math.ceil(characterCount / CHARACTERS_PER_CREDIT));
}
