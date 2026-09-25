/**
 * Forma de una página legal (ticket 6.2, specs/18): una lista de secciones
 * con encabezado y párrafos. El contenido de las páginas legales vive en
 * español (specs/18 fija España como jurisdicción de referencia, §1) — ver el
 * comentario de `legal-page.tsx` sobre por qué no se traduce.
 */

/** Rutas de las páginas legales, las únicas a las que un documento puede remitir. */
export type LegalHref =
  | "/legal/terms"
  | "/legal/privacy"
  | "/legal/dpa"
  | "/legal/legal-notice"
  | "/legal/cookies";

/** Fragmento de un texto legal: texto plano o un enlace a otra página legal. */
export type LegalInline = string | { text: string; href: LegalHref };

/**
 * Un párrafo o elemento de lista: una cadena simple o, si remite a otro
 * documento, una secuencia de fragmentos donde la remisión es un enlace real
 * (`legal-page.tsx` lo pinta con el `Link` de `@/i18n/navigation`, así que
 * conserva el locale activo).
 */
export type LegalText = string | LegalInline[];

export type LegalSection = {
  heading: string;
  paragraphs: LegalText[];
  /** Lista con viñetas, opcional, tras los párrafos. */
  list?: LegalText[];
};

export type LegalDocument = {
  /** Fecha de la versión vigente de este documento. */
  versionDate: string;
  sections: LegalSection[];
};

/** Enlace a otra página legal dentro de un `LegalText`. */
export function legalLink(text: string, href: LegalHref): LegalInline {
  return { text, href };
}
