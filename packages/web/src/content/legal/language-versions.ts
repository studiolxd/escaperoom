import type { LegalSection } from "./types";

/**
 * Sección de cierre "Versiones lingüísticas", común a los cinco documentos
 * legales (mismo criterio que los documentos legales de slxd, que cierran
 * todos con ella).
 *
 * A diferencia de slxd, aquí el contenido legal NO está traducido: existe una
 * sola versión, en español, y solo la interfaz de la página (título, menú)
 * sigue el idioma activo — ver `onlyInSpanishNotice` en `legal-page.tsx`. Por
 * eso no se copia la fórmula de slxd ("en caso de discrepancia entre
 * versiones prevalece el español"): con una sola versión no hay discrepancia
 * posible hoy, y solo se deja dicho qué versión prevalecerá si algún día se
 * publican traducciones.
 */
export function languageVersionsSection(number: number): LegalSection {
  return {
    heading: `${number}. Versiones lingüísticas`,
    paragraphs: [
      "Este documento solo está disponible en español. El resto de la plataforma (menús, " +
        "formularios y el título de estas páginas legales) sí está traducido a los idiomas que " +
        "ofrecemos, pero el contenido de los documentos legales se mantiene, por ahora, en un único " +
        "idioma: España es la jurisdicción de referencia de la plataforma y todavía no se ofrecen " +
        "traducciones del texto legal.",
      "Al existir una sola versión del texto, no hay traducciones que puedan contradecirla. Si en " +
        "el futuro se publican versiones en otros idiomas, se ofrecerán por comodidad y, en caso de " +
        "discrepancia, prevalecerá la versión en español.",
    ],
  };
}
