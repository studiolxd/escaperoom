/**
 * Set único de idiomas del proyecto (ADR-018): mismos códigos que SLXD, para
 * alinear las claves de `LocalizedText` del RoomPackage (specs/08) y el
 * `reference_id = {id}:{locale}` del audio IA. `es` es el idioma por defecto.
 */
export const LOCALES = ["en", "es", "fr", "de", "nl", "pt"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";
