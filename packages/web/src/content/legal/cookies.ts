import { languageVersionsSection } from "./language-versions";
import type { LegalDocument } from "./types";

/**
 * Política de Cookies (specs/18).
 *
 * Cookies reales en uso, verificadas por grep en `packages/web/src`: sesión
 * de Better Auth (`better-auth.session_token`, sin configuración de nombre
 * propia en `src/lib/auth.ts`) y `NEXT_LOCALE` de next-intl (`src/i18n/`).
 *
 * `localStorage`/`sessionStorage` (sección 6) también verificados por grep:
 * la guía de cookies de la AEPD los trata como "tecnologías similares".
 */
export const cookiesPolicy: LegalDocument = {
  versionDate: "2026-09-23",
  sections: [
    {
      heading: "1. Resumen",
      paragraphs: [
        "La plataforma usa cookies estrictamente necesarias para funcionar (tu sesión de cuenta y tu " +
          "idioma preferido) y cookies de analítica de producto: Plausible y Google Analytics.",
        "Plausible no deja cookies en tu navegador. Google Analytics sí, y requiere tu consentimiento " +
          "previo antes de cargarse.",
      ],
    },
    {
      heading: "2. Categorías",
      paragraphs: [
        "Necesarias (siempre activas): imprescindibles para el funcionamiento básico de la " +
          "plataforma y exentas de consentimiento. Hoy son tu sesión de autenticación y tu idioma " +
          "preferido.",
        "Analítica: nos ayuda a entender cómo se usa la plataforma (visitas agregadas, fuentes de " +
          "tráfico) para poder mejorarla. Usamos Plausible y Google Analytics (véase la sección 3). " +
          "Esta categoría no requiere banner de consentimiento por Plausible, que no usa cookies; " +
          "Google Analytics, al usarlas, sí lo requiere.",
        "Marketing: mediría la publicidad con píxeles de terceros. Hoy no hay ninguna activa en la " +
          "plataforma.",
        "Preferencias: recordaría personalización opcional, no esencial. Hoy no hay ninguna activa " +
          "más allá del idioma, que se trata como necesaria (véase la sección 4).",
      ],
    },
    {
      heading: "3. Analíticas de producto",
      paragraphs: [
        "La plataforma usa dos herramientas de analítica de producto:",
      ],
      list: [
        "Plausible: mide tráfico agregado sin usar cookies y sin identificar a nadie " +
          "individualmente. Al no usar cookies, no exige banner de consentimiento.",
        "Google Analytics: usa las cookies `_ga` y `_ga_*` para distinguir usuarios y mantener el " +
          "estado de la sesión de medición de forma agregada. Al usar cookies, solo se carga cuando " +
          "das tu consentimiento explícito a la categoría de analítica.",
      ],
    },
    {
      heading: "4. Cookies que utilizamos hoy",
      paragraphs: [
        "Verificadas directamente en el código de la plataforma, sin cookies inventadas ni supuestas:",
      ],
      list: [
        "`better-auth.session_token` — Necesaria — Sesión de tu cuenta (jugador, creador u " +
          "organizador), gestionada por Better Auth — Duración: sesión.",
        "`NEXT_LOCALE` — Necesaria — Recuerda el idioma que has elegido para navegar la plataforma, " +
          "gestionada por next-intl — Duración: hasta que cambies de idioma o borres tus cookies.",
      ],
    },
    {
      heading: "5. Gestionar tus preferencias",
      paragraphs: [
        "Las cookies necesarias no se pueden desactivar sin romper el funcionamiento de la " +
          "plataforma (no podrías mantener sesión iniciada ni conservar tu idioma). Google Analytics " +
          "solo se carga si das tu consentimiento explícito, y puedes retirarlo en cualquier momento.",
        "Puedes revisar o cambiar tus preferencias en cualquier momento desde «Preferencias de " +
          "cookies», en el pie de la plataforma.",
        "También puedes bloquear cookies desde los ajustes de tu navegador, aunque las cookies " +
          "necesarias no se pueden desactivar sin romper el funcionamiento de la plataforma.",
        "Más información sobre cookies en la guía de la Agencia Española de Protección de Datos: " +
          "https://www.aepd.es/guias-y-herramientas/guias/guia-cookies",
      ],
    },
    {
      heading: "6. Otras tecnologías de almacenamiento en tu navegador",
      paragraphs: [
        "Además de las cookies, la plataforma guarda en el almacenamiento local de tu navegador " +
          "(`localStorage` y `sessionStorage`) unos pocos datos para funcionalidades que tú mismo " +
          "usas. No se envían a ningún tercero ni sirven para seguirte, y están exentos de " +
          "consentimiento por ser necesarios para la función que pides o para personalizar la " +
          "interfaz a tu elección:",
      ],
      list: [
        "`escaperoom:join-token:<sesión>` (sessionStorage) — Necesario — Mantiene tu acceso a una " +
          "partida de un evento si recargas la pestaña — Duración: hasta cerrar la pestaña.",
        "`escaperoom:player-name` (localStorage) — Funcional — Recuerda el nombre que usaste en una " +
          "partida para no pedírtelo otra vez — Duración: hasta que borres los datos del navegador.",
        "`er.editorHint.seen.*` y `er.editorHint.disabled` (localStorage) — Preferencias de interfaz " +
          "— Recuerdan qué pistas del editor has visto o si las has desactivado — Duración: hasta " +
          "que borres los datos del navegador.",
      ],
    },
    languageVersionsSection(7),
  ],
};
