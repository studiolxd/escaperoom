import type { LegalDocument } from "./types";

/**
 * Términos de Servicio — BORRADOR TÉCNICO (ticket 6.2, specs/18 §1–§2).
 *
 * No es un texto legal definitivo: recoge las decisiones de producto ya
 * tomadas que un abogado debe convertir en cláusulas exigibles. Donde
 * specs/18 no fija un detalle jurisdiccional concreto, este documento deja un
 * `[PENDIENTE ASESORÍA LEGAL: …]` en vez de inventarlo.
 */
export const termsOfService: LegalDocument = {
  draftDate: "2026-09-23",
  sections: [
    {
      heading: "0. Qué es este documento",
      paragraphs: [
        "Esta página es un borrador técnico, no un texto legal vigente. Recoge las decisiones de " +
          "producto que EscapeRoom Creator ya ha tomado para que un abogado especializado en " +
          "protección de datos y contratación electrónica las convierta en Términos de Servicio " +
          "exigibles antes de aceptar el primer pago real o el primer evento educativo real.",
        "Mientras este aviso esté presente, ningún párrafo de esta página se puede invocar como " +
          "contrato vinculante.",
      ],
    },
    {
      heading: "1. Quién puede tener cuenta",
      paragraphs: [
        "Para crear una cuenta de jugador, creador u organizador hay que tener 18 años cumplidos. " +
          "Un menor puede participar como jugador en una sala o evento, pero nunca crea cuenta " +
          "propia ni acepta estos términos por sí mismo: participa a través de una clave de acceso " +
          "que gestiona un adulto responsable (el organizador del evento, normalmente un centro " +
          "educativo o una empresa).",
      ],
    },
    {
      heading: "2. Roles en la plataforma",
      paragraphs: [
        "Jugador: cualquier persona con cuenta que juega salas publicadas por otros.",
        "Creador: diseña y publica salas de escape, en solitario o con el editor asistido por IA. " +
          "El creador conserva la propiedad de lo que crea (véase la sección 4, licencia UGC).",
        "Organizador: compra o licencia salas para organizar eventos (grupos, colegios, empresas) y " +
          "reparte claves de acceso a los participantes.",
      ],
    },
    {
      heading: "3. Condiciones económicas",
      paragraphs: [
        "El reparto de ingresos entre la plataforma y el creador, la comisión aplicada y el " +
          "funcionamiento de los créditos de generación asistida por IA se rigen por las condiciones " +
          "económicas vigentes en cada momento, publicadas en la plataforma.",
        "Los créditos de generación por IA no son reembolsables una vez consumidos. El saldo de un " +
          "evento no utilizado (aforo comprado que no se llega a jugar) no se convierte en crédito ni " +
          "se reembolsa salvo que la ley aplicable exija lo contrario.",
        "[PENDIENTE ASESORÍA LEGAL: redactar la cláusula de derecho de desistimiento (o su exclusión, " +
          "si aplica por tratarse de contenido digital ya iniciado) conforme a la normativa de " +
          "consumidores vigente].",
      ],
    },
    {
      heading: "4. Licencia sobre el contenido publicado por el creador (UGC)",
      paragraphs: [
        "El creador conserva la propiedad de su sala (diseño, textos, configuración de puzzles). Al " +
          "publicarla, concede a la plataforma una licencia no exclusiva y mundial para alojarla, " +
          "reproducirla, distribuirla y venderla a jugadores y organizadores mientras la cuenta y la " +
          "sala permanezcan activas. La licencia no es exclusiva: el creador puede llevar el mismo " +
          "contenido a otro sitio.",
        "Si el creador retira su sala voluntariamente, quienes ya la compraron conservan el acceso. " +
          "Si la retirada es por moderación de severidad normal o alta, ocurre lo mismo. Si es por " +
          "severidad crítica (contenido ilegal o que compromete la seguridad de menores), el acceso " +
          "se revoca también para quien ya la compró, sin excepción.",
        "Al subir un asset propio (audio o imagen) que no ha generado con las herramientas de la " +
          "plataforma, el creador declara tener los derechos necesarios sobre ese contenido. La " +
          "plataforma no hace una verificación legal previa de esa declaración; el pipeline de " +
          "moderación automática y los reportes de usuarios son el mecanismo de control posterior.",
        "[PENDIENTE ASESORÍA LEGAL: revisar los Términos de Servicio vigentes de ElevenLabs sobre la " +
          "titularidad del audio generado por IA antes de activar la función de voces en producción " +
          "y reflejar sus condiciones aquí — no se puede asumir titularidad plena de ese audio solo " +
          "por haberlo generado].",
      ],
    },
    {
      heading: "5. Conducta prohibida",
      paragraphs: [
        "Está prohibido publicar contenido ilegal, usar la plataforma para acosar a otras personas, " +
          "usar voces de terceros sin su consentimiento, o manipular fraudulentamente el ranking, las " +
          "reseñas o los reportes de contenido.",
      ],
    },
    {
      heading: "6. Moderación y terminación de cuenta",
      paragraphs: [
        "La plataforma puede retirar contenido y suspender o cerrar cuentas que incumplan estos " +
          "términos, siguiendo la política de strikes descrita en el sistema de moderación (reportes, " +
          "severidad, strikes escalonados y apelaciones con reversión).",
      ],
    },
    {
      heading: "7. Limitación de responsabilidad sobre contenido de terceros",
      paragraphs: [
        "La plataforma aloja contenido creado por sus usuarios y no garantiza su calidad ni su " +
          "exactitud. El remedio frente a una sala problemática es el sistema de reportes, no una " +
          "revisión previa de cada publicación por parte de la plataforma.",
        "[PENDIENTE ASESORÍA LEGAL: cláusula estándar de limitación de responsabilidad conforme a la " +
          "normativa de comercio electrónico y de prestadores de servicios de la sociedad de la " +
          "información aplicable].",
      ],
    },
    {
      heading: "8. Disponibilidad del servicio",
      paragraphs: [
        "En fase MVP/beta el servicio se opera sobre infraestructura propia (self-hosted) sin un " +
          "acuerdo de nivel de servicio (SLA) formal.",
      ],
    },
    {
      heading: "9. Ley aplicable y jurisdicción",
      paragraphs: [
        "[PENDIENTE ASESORÍA LEGAL: confirmar la ley aplicable (previsiblemente España) y el alcance " +
          "geográfico inicial — specs/18 §1 deja pendiente confirmar si hay usuarios de otros países " +
          "de la Unión Europea desde el lanzamiento, lo que puede exigir cláusulas adicionales de " +
          "protección de consumidores transfronteriza].",
      ],
    },
  ],
};
