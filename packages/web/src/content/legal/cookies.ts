import { languageVersionsSection } from "./language-versions";
import { legalLink, type LegalDocument } from "./types";

/**
 * Política de Cookies — BORRADOR TÉCNICO (ticket 6.2, specs/18).
 *
 * Cookies reales en uso, verificadas por grep en `packages/web/src`: sesión
 * de Better Auth (`better-auth.session_token`, sin configuración de nombre
 * propia en `src/lib/auth.ts`) y `NEXT_LOCALE` de next-intl (`src/i18n/`).
 * Plausible y Google Analytics se describen como PLANIFICADOS, no activos
 * todavía — mismo patrón de aviso que `dpa.ts`/`privacy.ts` usan
 * para LiveKit Cloud.
 *
 * `localStorage`/`sessionStorage` (sección 6) también verificados por grep:
 * la guía de cookies de la AEPD los trata como "tecnologías similares".
 */
export const cookiesPolicy: LegalDocument = {
  draftDate: "2026-09-23",
  sections: [
    {
      heading: "0. Qué es este documento",
      paragraphs: [
        "Esta página es un borrador técnico, no un texto legal vigente. Explica qué cookies utiliza " +
          "hoy EscapeRoom Creator y cuáles están planificadas pero no activas todavía, a partir de una " +
          "revisión del código. Un abogado especializado en protección de datos debe revisarlo.",
      ],
    },
    {
      heading: "1. Resumen",
      paragraphs: [
        "Hoy la plataforma solo usa cookies estrictamente necesarias para funcionar: tu sesión de " +
          "cuenta y tu idioma preferido. No hay ninguna cookie de analítica, marketing ni preferencias " +
          "activa.",
        "Cuando se active la analítica de producto (véase la sección 3), Plausible no dejará cookies " +
          "en tu navegador; Google Analytics sí, y requerirá tu consentimiento previo antes de " +
          "cargarse.",
      ],
    },
    {
      heading: "2. Categorías",
      paragraphs: [
        "Necesarias (siempre activas): imprescindibles para el funcionamiento básico de la " +
          "plataforma y exentas de consentimiento. Hoy son tu sesión de autenticación y tu idioma " +
          "preferido.",
        "Analítica: nos ayudaría a entender cómo se usa la plataforma (visitas agregadas, fuentes de " +
          "tráfico) para poder mejorarla. Planificado, no activo todavía: Plausible y Google Analytics " +
          "(véase la sección 3). Mientras no se activen, esta categoría no tiene ninguna cookie ni " +
          "requiere ningún banner de consentimiento; cuando se active Google Analytics, sí lo " +
          "requerirá, al ser el único de los dos que usa cookies.",
        "Marketing: mediría la publicidad con píxeles de terceros. Hoy no hay ninguna activa en la " +
          "plataforma.",
        "Preferencias: recordaría personalización opcional, no esencial. Hoy no hay ninguna activa " +
          "más allá del idioma, que se trata como necesaria (véase la sección 4).",
      ],
    },
    {
      heading: "3. Analíticas planificadas (no activas todavía)",
      paragraphs: [
        [
          "La plataforma tiene planificada la incorporación de dos herramientas de analítica de " +
            "producto. Mientras no se activen, ninguno de estos dos proveedores interviene y no se " +
            "establece ninguna cookie relacionada con ellos — el mismo patrón que ya usa la ",
          legalLink("Política de Privacidad", "/legal/privacy"),
          " para LiveKit Cloud.",
        ],
      ],
      list: [
        "Plausible: mide tráfico agregado sin usar cookies y sin identificar a nadie individualmente. " +
          "Al no usar cookies, no exigiría banner de consentimiento cuando se active.",
        "Google Analytics: usa las cookies `_ga` y `_ga_*` para distinguir usuarios y mantener el " +
          "estado de la sesión de medición de forma agregada. Al usar cookies, no se cargaría hasta " +
          "que dieras tu consentimiento explícito a la categoría de analítica.",
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
          "plataforma (no podrías mantener sesión iniciada ni conservar tu idioma). Cuando se activen " +
          "las analíticas planificadas de la sección 3, Google Analytics solo se cargará si das tu " +
          "consentimiento explícito, y podrás retirarlo en cualquier momento.",
        "El mecanismo de gestión (banda de consentimiento y panel de preferencias) ya está construido " +
          "y listo para cuando se active la primera cookie opcional; hasta entonces no le aparece a " +
          "nadie porque no hay ninguna categoría opcional activa. Puedes revisarlo o cambiarlo en " +
          "cualquier momento desde «Preferencias de cookies», debajo y en el pie de la plataforma.",
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
