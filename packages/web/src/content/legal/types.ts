/**
 * Forma de una página legal (ticket 6.2, specs/18): una lista de secciones
 * con encabezado y párrafos. El contenido de las tres páginas legales vive en
 * español (specs/18 fija España como jurisdicción de referencia, §1) — ver el
 * comentario de `legal-page.tsx` sobre por qué no se traduce.
 */
export type LegalSection = {
  heading: string;
  paragraphs: string[];
  /** Lista con viñetas, opcional, tras los párrafos. */
  list?: string[];
};

export type LegalDocument = {
  /** Fecha de esta versión del borrador (no la de entrada en vigor: no está vigente). */
  draftDate: string;
  sections: LegalSection[];
};
