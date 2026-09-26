import { languageVersionsSection } from "./language-versions";
import { legalLink, type LegalDocument } from "./types";

/**
 * Términos de Servicio (specs/18 §1–§2).
 *
 * Estructura contrastada con las condiciones de slxd
 * (`slxd/packages/legal/content/es/terms.mdx`, mismo titular): de ahí salen
 * las secciones de titular y aceptación, garantía legal de conformidad,
 * funciones de IA, protección de datos y reclamaciones, adaptadas a este
 * marketplace (sin suscripciones ni periodo de prueba).
 */
export const termsOfService: LegalDocument = {
  versionDate: "2026-09-26-2",
  sections: [
    {
      heading: "1. Quién presta el servicio y aceptación",
      paragraphs: [
        [
          "EscapeRoom Creator es un servicio de Studio LXD, S.L. (sus datos identificativos están " +
            "en el ",
          legalLink("Aviso Legal", "/legal/legal-notice"),
          "). Al crear una cuenta o usar la plataforma aceptas estos Términos de Servicio; si no " +
            "estás de acuerdo con ellos, no debes utilizarla.",
        ],
        "Studio LXD, S.L. puede modificar estos términos. Cuando cambie la versión, la plataforma " +
          "te pedirá que leas y aceptes la nueva al entrar en tu cuenta, y no podrás seguir " +
          "usándola hasta hacerlo; la versión que aceptaste y cuándo la aceptaste quedan registradas.",
      ],
    },
    {
      heading: "2. Quién puede tener cuenta",
      paragraphs: [
        "Para crear una cuenta de jugador, creador u organizador hay que tener 18 años cumplidos. " +
          "Un menor puede participar como jugador en una sala o evento, pero nunca crea cuenta " +
          "propia ni acepta estos términos por sí mismo: participa a través de una clave de acceso " +
          "que gestiona un adulto responsable (el organizador del evento, normalmente un centro " +
          "educativo o una empresa).",
        "Puedes usar la plataforma como consumidor (a título personal, fuera de una actividad " +
          "profesional) o como empresa o profesional (por ejemplo, un centro educativo o una empresa " +
          "que organiza eventos); en ese caso declaras que actúas con poder suficiente para obligar " +
          "a quien representas. Si eres consumidor te amparan además los derechos que te reconoce el " +
          "texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios (Real " +
          "Decreto Legislativo 1/2007), y nada de lo que dicen estos términos puede recortarlos: " +
          "donde una cláusula sea menos favorable que la ley, manda la ley.",
      ],
    },
    {
      heading: "3. Roles en la plataforma",
      paragraphs: [
        "Jugador: cualquier persona con cuenta que juega salas publicadas por otros.",
        "Creador: diseña y publica salas de escape, en solitario o con el editor asistido por IA. " +
          "El creador conserva la propiedad de lo que crea (véase la sección 6, licencia UGC).",
        "Organizador: compra o licencia salas para organizar eventos (grupos, colegios, empresas) y " +
          "reparte claves de acceso a los participantes. Antes de usar una sala con sus " +
          "participantes, en especial si son menores, el organizador debe revisar su contenido " +
          "(textos, imágenes, audios y vídeos) y es el responsable de decidir si es adecuado para " +
          "su grupo.",
      ],
    },
    {
      heading: "4. Condiciones económicas",
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
        "Los precios se muestran en euros (EUR) con el IVA incluido.",
        "Los pagos se procesan a través de Stripe; los datos de tu tarjeta no llegan a los " +
          "servidores de la plataforma.",
      ],
    },
    {
      heading: "5. Garantía legal de conformidad",
      paragraphs: [
        "Las salas, los créditos de generación por IA y el aforo de un evento son contenido o " +
          "servicios digitales, y si contratas como consumidor la plataforma responde de su falta de " +
          "conformidad en los términos de los artículos 114 y siguientes de la Ley General para la " +
          "Defensa de los Consumidores y Usuarios: si lo que compras no es conforme con lo anunciado, " +
          "puedes exigir que se ponga en conformidad sin coste y, si no se consigue en un plazo " +
          "razonable, una reducción del precio o la resolución del contrato con la devolución de lo " +
          "pagado por la parte no conforme.",
        "Al tratarse de un suministro en un acto único (una compra puntual, no una suscripción), la " +
          "plataforma responde de la falta de conformidad que se manifieste en los dos años " +
          "siguientes al suministro (artículo 120.1 de esa misma ley). Para reclamarla, escribe a " +
          "hello@studiolxd.com (véase la sección 13).",
      ],
    },
    {
      heading: "6. Licencia sobre el contenido publicado por el creador (UGC)",
      paragraphs: [
        "El creador conserva la propiedad de su sala (diseño, textos, configuración de puzzles) y de " +
          "cualquier contenido que genere con las herramientas de IA de la plataforma consumiendo sus " +
          "créditos (voces y las que se añadan en el futuro), lo haya creado él mismo o con esas " +
          "herramientas. Al publicarla, concede a la plataforma una licencia no exclusiva y mundial " +
          "para alojarla, reproducirla, distribuirla y venderla a jugadores y organizadores mientras " +
          "la cuenta y la sala permanezcan activas. La licencia no es exclusiva: el creador puede " +
          "llevar el mismo contenido a otro sitio.",
        "Si el creador retira su sala voluntariamente, quienes ya la compraron conservan el acceso. " +
          "Si la retirada es por moderación de severidad normal o alta, ocurre lo mismo. Si es por " +
          "severidad crítica (contenido ilegal o que compromete la seguridad de menores), el acceso " +
          "se revoca también para quien ya la compró, sin excepción.",
        "Al subir un asset propio (audio, imagen o vídeo) que no ha generado con las herramientas de " +
          "la plataforma, el creador declara tener los derechos necesarios sobre ese contenido. El " +
          "creador es el responsable de todo el contenido de su sala, lo haya subido él o lo haya " +
          "generado con las herramientas de la plataforma, y de que sea lícito y coherente con la " +
          "descripción de la sala. La plataforma no revisa ese contenido ni verifica esa " +
          "declaración antes de su publicación; los reportes de usuarios son el mecanismo de " +
          "control posterior.",
      ],
    },
    {
      heading: "7. Funciones de inteligencia artificial",
      paragraphs: [
        [
          "El editor asistido por IA y la generación de voces producen resultados automáticamente " +
            "que pueden ser inexactos o no ajustarse a lo que pediste: son una ayuda, no un contenido " +
            "verificado, y el creador es quien los revisa antes de publicarlos en su sala. Para " +
            "responderte, los datos necesarios se envían al proveedor del modelo correspondiente, en " +
            "los términos de la ",
          legalLink("Política de Privacidad", "/legal/privacy"),
          ".",
        ],
      ],
    },
    {
      heading: "8. Conducta prohibida",
      paragraphs: [
        "Está prohibido publicar contenido ilegal, usar la plataforma para acosar a otras personas, " +
          "usar voces de terceros sin su consentimiento, o manipular fraudulentamente el ranking, las " +
          "reseñas o los reportes de contenido.",
      ],
    },
    {
      heading: "9. Moderación y terminación de cuenta",
      paragraphs: [
        "La plataforma puede retirar contenido y suspender o cerrar cuentas que incumplan estos " +
          "términos, siguiendo la política de strikes descrita en el sistema de moderación (reportes, " +
          "severidad, strikes escalonados y apelaciones con reversión).",
      ],
    },
    {
      heading: "10. Limitación de responsabilidad sobre contenido de terceros",
      paragraphs: [
        "La plataforma aloja contenido creado por sus usuarios y no garantiza su calidad ni su " +
          "exactitud. La plataforma no revisa antes de su publicación los textos, imágenes, audios " +
          "ni vídeos de las salas. El remedio frente a una sala problemática es el sistema de " +
          "reportes, no una revisión previa de cada publicación por parte de la plataforma. Los " +
          "reportes por contenido ilegal o que comprometa la seguridad de menores se atienden con " +
          "prioridad y pueden retirar la sala de inmediato mientras se revisan.",
        [
          "La plataforma se presta \"tal cual\" y \"según disponibilidad\". En la medida permitida por " +
            "la ley, EscapeRoom Creator no será responsable de daños indirectos derivados del uso de " +
            "la plataforma, ni de la disponibilidad o el correcto funcionamiento de sistemas de " +
            "terceros a los que se conecta (Stripe, ElevenLabs, LiveKit u otros proveedores listados " +
            "en la ",
          legalLink("Política de Privacidad", "/legal/privacy"),
          "), ni de los resultados generados por los modelos de inteligencia artificial usados en el " +
            "editor. Esta limitación no afecta a los derechos que la ley reconoce a los consumidores " +
            "(véase la sección 2).",
        ],
      ],
    },
    {
      heading: "11. Disponibilidad del servicio",
      paragraphs: [
        "En fase MVP/beta el servicio se opera sobre infraestructura propia (self-hosted) sin un " +
          "acuerdo de nivel de servicio (SLA) formal.",
      ],
    },
    {
      heading: "12. Protección de datos y encargo de tratamiento",
      paragraphs: [
        [
          "El tratamiento de tus datos personales se describe en la ",
          legalLink("Política de Privacidad", "/legal/privacy"),
          ", y el uso de cookies y tecnologías similares en la ",
          legalLink("Política de Cookies", "/legal/cookies"),
          ".",
        ],
        [
          "Cuando, como organizador, repartes claves de acceso individuales con el email de tus " +
            "participantes o activas la grabación de una sesión, tu organización es la responsable " +
            "de esos datos y Studio LXD, S.L. actúa como encargada. Esa relación se rige por el ",
          legalLink("Anexo de encargo de tratamiento", "/legal/dpa"),
          ", que forma parte de estos Términos de Servicio y se acepta junto con ellos, sin firmar " +
            "ningún documento aparte. Antes de generar claves individuales con email, la plataforma " +
            "pide además a la organización que confirme expresamente la versión vigente del anexo.",
        ],
      ],
    },
    {
      heading: "13. Reclamaciones y atención al cliente",
      paragraphs: [
        [
          "Puedes dirigir cualquier reclamación a hello@studiolxd.com o a la dirección postal que " +
            "figura en el ",
          legalLink("Aviso Legal", "/legal/legal-notice"),
          ". Se acusará recibo y se te responderá por escrito lo antes posible y, como máximo, en el " +
            "plazo de un mes.",
        ],
        "Studio LXD, S.L. no está adherida a ningún sistema arbitral de consumo ni a ninguna " +
          "entidad de resolución alternativa de litigios. Si eres consumidor y la respuesta no te " +
          "satisface, puedes acudir a los servicios de consumo de tu comunidad autónoma o a la vía " +
          "judicial.",
      ],
    },
    {
      heading: "14. Ley aplicable y jurisdicción",
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
    languageVersionsSection(15),
  ],
};
