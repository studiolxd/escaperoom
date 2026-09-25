import { languageVersionsSection } from "./language-versions";
import { legalLink, type LegalDocument } from "./types";

/**
 * Aviso Legal (specs/18).
 *
 * Datos identificativos conforme a la LSSI-CE (Ley 34/2002) para el titular
 * de la plataforma, Studio LXD, S.L.
 */
export const legalNotice: LegalDocument = {
  versionDate: "2026-09-23",
  sections: [
    {
      heading: "1. Datos del titular",
      paragraphs: ["En cumplimiento de la LSSI-CE, se informan los siguientes datos:"],
      list: [
        "Titular: Studio LXD, S.L.",
        "NIF: B24941411",
        "Domicilio: Avenida Menéndez Pelayo, 36, 3.º, D. 28007 Madrid",
        "Contacto: hello@studiolxd.com",
        "Registro mercantil: Inscrita en el Registro Mercantil de Madrid, hoja M-871555, folio " +
          "electrónico IRUS 1000462470258, inscripción 1.ª (1 de diciembre de 2025).",
      ],
    },
    {
      heading: "2. Ámbito de este aviso",
      paragraphs: [
        "[PENDIENTE: el dominio de producción de EscapeRoom Creator todavía no está decidido — no es " +
          "un pendiente de asesoría legal sino operativo, se confirmará antes de publicar este aviso]. " +
          "Este aviso legal se aplica al sitio publicado en ese dominio y a todas las aplicaciones que " +
          "Studio LXD, S.L. sirve desde él: el catálogo público de salas, el editor de creación, el " +
          "flujo de compra y checkout, y la sesión de juego (lobby con voz/vídeo mediante LiveKit).",
      ],
    },
    {
      heading: "3. Propiedad intelectual",
      paragraphs: [
        "Los contenidos de la propia plataforma (textos, diseño, código, marcas y demás elementos de " +
          "EscapeRoom Creator) son propiedad de Studio LXD, S.L. o se utilizan con la autorización " +
          "correspondiente, y están protegidos por la normativa de propiedad intelectual e industrial. " +
          "Queda prohibida su reproducción, distribución o transformación sin autorización previa por " +
          "escrito.",
        [
          "Las salas de escape, textos, configuración de puzzles, portadas y demás contenido que un " +
            "creador diseña y publica en la plataforma siguen siendo suyos: Studio LXD, S.L. solo los " +
            "aloja y distribuye en los términos descritos en los ",
          legalLink("Términos de Servicio", "/legal/terms"),
          " (sección de licencia sobre el contenido publicado por el creador, UGC).",
        ],
      ],
    },
    {
      heading: "4. Responsabilidad sobre contenidos de terceros",
      paragraphs: [
        [
          "Studio LXD, S.L. no se hace responsable del uso indebido que un creador, organizador o " +
            "jugador pueda hacer de la plataforma, ni de la exactitud o calidad de las salas de " +
            "escape publicadas por sus creadores. El remedio frente a una sala problemática es el " +
            "sistema de reportes y moderación descrito en los ",
          legalLink("Términos de Servicio", "/legal/terms"),
          ", no una revisión previa de cada publicación.",
        ],
      ],
    },
    {
      heading: "5. Protección de datos y cookies",
      paragraphs: [
        [
          "El tratamiento de tus datos personales se describe en la ",
          legalLink("Política de Privacidad", "/legal/privacy"),
          ", y el uso de cookies y tecnologías similares en la ",
          legalLink("Política de Cookies", "/legal/cookies"),
          ".",
        ],
        [
          "Cuando un organizador trata en la plataforma datos de sus participantes, esa relación se " +
            "rige por el ",
          legalLink("Anexo de encargo de tratamiento", "/legal/dpa"),
          ".",
        ],
      ],
    },
    {
      heading: "6. Legislación aplicable y jurisdicción",
      paragraphs: [
        "Este aviso legal se rige por la legislación española. Para la resolución de cualquier " +
          "controversia que pudiera surgir del acceso o uso de la plataforma, las partes se someten a " +
          "los tribunales de Madrid, con renuncia a cualquier otro fuero que pudiera corresponderles.",
        [
          "Esta sumisión no se aplica si accedes como consumidor desde otro país de la Unión " +
            "Europea: en ese caso conservas los derechos que te reconozca la ley de tu país de " +
            "residencia, en línea con el mismo punto resuelto en los ",
          legalLink("Términos de Servicio", "/legal/terms"),
          ".",
        ],
      ],
    },
    languageVersionsSection(7),
  ],
};
