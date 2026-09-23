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
        "Los créditos de generación por IA y el aforo de un evento son contenido digital que se " +
          "suministra al instante a tu saldo o a tu evento: al comprarlos solicitas expresamente que " +
          "la ejecución empiece de inmediato y reconoces que, una vez abonados a tu saldo o " +
          "confirmado el evento, pierdes el derecho de desistimiento sobre ellos (artículo 103.m) del " +
          "Real Decreto Legislativo 1/2007, de 16 de noviembre, por el que se aprueba el texto " +
          "refundido de la Ley General para la Defensa de los Consumidores y Usuarios).",
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
        "La plataforma se presta \"tal cual\" y \"según disponibilidad\". En la medida permitida por la " +
          "ley, EscapeRoom Creator no será responsable de daños indirectos derivados del uso de la " +
          "plataforma, ni de la disponibilidad o el correcto funcionamiento de sistemas de terceros a " +
          "los que se conecta (Stripe, ElevenLabs, LiveKit u otros proveedores listados en la Política " +
          "de Privacidad), ni de los resultados generados por los modelos de inteligencia artificial " +
          "usados en el editor.",
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
      heading: "9. Contrato de encargo de tratamiento (DPA)",
      paragraphs: [
        "El Contrato de Encargo de Tratamiento (DPA) forma parte de estas condiciones y se acepta " +
          "junto con ellas, como anexo incorporado por referencia, para las organizaciones que lo " +
          "necesiten. No hace falta una firma aparte de estos Términos de Servicio: el flujo " +
          "específico de organizaciones B2B/Edu (ticket 5.11) ya implementa la aceptación separada del " +
          "DPA cuando esa organización activa claves de acceso individuales con email.",
      ],
    },
    {
      heading: "10. Ley aplicable y jurisdicción",
      paragraphs: [
        "Estos Términos de Servicio se rigen por la legislación española. Para la resolución de " +
          "cualquier controversia, las partes se someten a los tribunales de Madrid, con renuncia a " +
          "cualquier otro fuero que pudiera corresponderles.",
        "Esta sumisión no se aplica si contratas como consumidor: en ese caso el tribunal competente " +
          "es el que determine la normativa de consumidores, que suele ser el de tu propio domicilio, " +
          "y conservas los derechos que te reconozca la ley de tu país de residencia en la Unión " +
          "Europea si accedes a la plataforma desde otro Estado miembro.",
      ],
    },
  ],
};
