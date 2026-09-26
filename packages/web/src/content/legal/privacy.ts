import { languageVersionsSection } from "./language-versions";
import { legalLink, type LegalDocument } from "./types";

/**
 * Política de Privacidad (specs/18 §3–§4).
 *
 * Contrastada con la política de slxd (`slxd/packages/legal/content/es/privacy.mdx`,
 * mismo responsable): de ahí salen la lista completa de derechos con la
 * reclamación ante la AEPD, los registros técnicos, el formulario de
 * contacto y la sección de cambios, que el art. 13 RGPD exige o que la
 * plataforma ya hace y no estaban descritos.
 */
export const privacyPolicy: LegalDocument = {
  versionDate: "2026-09-26",
  sections: [
    {
      heading: "1. Roles según el flujo de datos",
      paragraphs: [
        "La plataforma actúa como responsable del tratamiento de los datos de la cuenta " +
          "(jugador, creador u organizador).",
        "Cuando un organizador genera claves de acceso individuales con el email de un participante " +
          "(por ejemplo, alumnado de un centro educativo), la plataforma trata ese email por " +
          "encargo del organizador: el organizador es el responsable de ese tratamiento frente a sus " +
          "participantes y necesita su propia base legal frente a ellos.",
        [
          "Cuando se activa la grabación de una sesión (solo disponible fuera del contexto educativo, " +
            "con consentimiento explícito y unánime de los participantes), la plataforma también " +
            "trata esos datos por encargo de quien organiza la sesión. Las condiciones de ese encargo " +
            "están en el ",
          legalLink("Anexo de encargo de tratamiento", "/legal/dpa"),
          ", que forma parte de los ",
          legalLink("Términos de Servicio", "/legal/terms"),
          ".",
        ],
      ],
    },
    {
      heading: "2. Qué datos tratamos y con qué base legal",
      paragraphs: [
        "Datos de cuenta (email, nombre): para ejecutar el contrato de uso de la plataforma " +
          "(artículo 6.1.b del RGPD).",
        "Datos de pago: los procesa Stripe; la plataforma solo recibe referencias de la transacción, " +
          "necesarias para ejecutar el contrato y cumplir obligaciones de facturación (artículo " +
          "6.1.b y 6.1.c del RGPD).",
        "Mensajes al editor asistido por IA: lo que el creador escribe en el chat del editor y el " +
          "contenido de la sala sobre la que trabaja se envían al proveedor del modelo de lenguaje " +
          "configurado (véase la sección 6) para ejecutar el contrato (artículo 6.1.b del RGPD).",
        [
          "Analítica de producto: Plausible, que no usa cookies, por interés legítimo (artículo " +
            "6.1.f del RGPD) con mecanismo de oposición; Google Analytics, solo con tu consentimiento " +
            "previo (artículo 6.1.a del RGPD). Véase la ",
          legalLink("Política de Cookies", "/legal/cookies"),
          ".",
        ],
        [
          "Emails de participantes en claves de acceso individuales: tratados por encargo del " +
            "organizador (véase la sección 1); exigen que el organizador haya aceptado el ",
          legalLink("Anexo de encargo de tratamiento", "/legal/dpa"),
          " antes de poder usar esa función.",
        ],
        "Chat de la partida: por interés legítimo (es parte de la funcionalidad del juego), sujeto a " +
          "moderación automática y con una retención mínima (véase la sección 4). El pre-check " +
          "automático solo puede retirar contenido o congelar la cuenta a la espera de revisión; " +
          "ninguna suspensión o cierre de cuenta se produce sin que una persona moderadora confirme " +
          "el reporte antes (artículo 22 del RGPD).",
        "Grabación de sesión: solo con consentimiento explícito y unánime de los participantes; nunca " +
          "disponible para eventos con audiencia educativa.",
        "Registros técnicos: la dirección IP y el navegador (user agent) de tus sesiones abiertas, y " +
          "los de cada aceptación de los Términos de Servicio y de esta política, por interés " +
          "legítimo en la seguridad de tu cuenta y en poder acreditar qué versión aceptaste y cuándo " +
          "(artículo 6.1.f del RGPD).",
        "Formulario de contacto: tu nombre, tu email y tu mensaje, que nos llegan por correo " +
          "electrónico y no se guardan en la base de datos de la plataforma, para responderte " +
          "(consentimiento, artículo 6.1.a del RGPD).",
        "Salvo los datos necesarios para crear tu cuenta, prestar cada función que solicitas y " +
          "procesar tus pagos, el resto son opcionales. Si no facilitas los datos necesarios, no " +
          "podremos prestarte el servicio.",
      ],
    },
    {
      heading: "3. Menores de edad",
      paragraphs: [
        "Ningún menor crea una cuenta propia ni acepta estos términos por sí mismo: participa con una " +
          "clave de acceso que reparte un adulto responsable (normalmente un centro educativo o una " +
          "empresa organizadora), que actúa como responsable del tratamiento de los datos de sus " +
          "menores o empleados frente a la plataforma. La plataforma no recaba directamente el " +
          "consentimiento de un padre, madre o tutor; esa relación es del centro u organización con " +
          "las familias.",
        "Por diseño: la cámara y el micrófono están desactivados por defecto, no hay mensajería " +
          "privada entre jugadores y la grabación de sesión está bloqueada sin excepciones cuando la " +
          "audiencia del evento es educativa.",
        "Este diseño es compatible con la edad de consentimiento digital que fija la LOPDGDD " +
          "(artículo 7: 14 años en España) porque esa regla solo se aplica cuando un tratamiento se " +
          "basa en el consentimiento del propio menor, y aquí ningún tratamiento se basa en él: la " +
          "plataforma trata el email del participante por encargo del centro u organización, que es " +
          "quien tiene su propia base legal frente al alumnado o al personal (en un centro educativo, " +
          "la función educativa que le encomienda la legislación de educación, no el consentimiento). " +
          "Es el mismo esquema que la Agencia Española de Protección de Datos describe para las " +
          "plataformas educativas contratadas por un centro: el centro es el responsable y el " +
          "proveedor su encargado, sin que el proveedor recabe consentimiento del alumnado ni de las " +
          "familias.",
        "Por la misma razón, el modelo no depende de dónde esté fijada esa edad: seguiría siendo " +
          "válido si la ley la eleva (por ejemplo, a 16 años, como plantea el proyecto de Ley " +
          "Orgánica de protección de menores en entornos digitales en tramitación). Lo que sí sigue " +
          "siendo obligación de la plataforma, como encargado, es tratar " +
          "esos datos solo según las instrucciones del organizador, aplicar una minimización " +
          "reforzada (plazo de conservación más corto para eventos educativos, véase la sección 4) y " +
          "asistir al centro si necesita una evaluación de impacto por tratar datos de menores.",
      ],
    },
    {
      heading: "4. Cuánto tiempo conservamos los datos",
      paragraphs: ["Los plazos de conservación son:"],
      list: [
        "Cuenta cerrada por el usuario: los campos identificativos se anonimizan de inmediato; se " +
          "conserva un registro transaccional de las compras, sin datos personales visibles, por " +
          "obligación de facturación.",
        "Facturas y registros de facturación: 6 años tras su emisión, conforme al artículo 30 del " +
          "Código de Comercio.",
        [
          "Clave de acceso con email de un participante: 12 meses tras la finalización del evento en " +
            "general, y 3 meses cuando la audiencia del evento es educativa (minimización reforzada " +
            "por la posible presencia de menores; véase la sección 10 del ",
          legalLink("Anexo de encargo de tratamiento", "/legal/dpa"),
          "). Si el evento nunca llega a jugarse, el plazo se cuenta desde su creación en vez de " +
            "desde su finalización. En ambos casos, pasado el plazo el email se seudonimiza (se " +
            "sustituye por un hash calculado con una clave que solo conserva la plataforma; no es una " +
            "anonimización total, ya que en teoría el email original podría recalcularse con esa " +
            "clave).",
        ],
        "Grabación de sesión (cuando existe consentimiento): 90 días.",
        "Dirección IP y navegador (user agent) de tus sesiones abiertas y de cada aceptación de " +
          "los Términos de Servicio y esta política: 90 días, pasados los cuales se seudonimizan (se " +
          "sustituyen por un hash calculado con una clave que solo conserva la plataforma; no es una " +
          "anonimización total). El registro de que hubo una sesión, o una aceptación con su fecha, " +
          "se conserva 2 años; pasado ese plazo la fila se borra por completo.",
        "Eventos de analítica detallados: 24 meses; los datos agregados y anonimizados se conservan " +
          "sin límite de tiempo.",
        "Reportes e historial de moderación: sin borrado automático, para poder detectar reincidencia.",
        "Mensajes del formulario de contacto: hasta que la consulta quede resuelta y, como máximo, " +
          "12 meses después.",
      ],
    },
    {
      heading: "5. Derechos de las personas usuarias",
      paragraphs: [
        "Puedes ejercer en cualquier momento tus derechos de acceso, rectificación, supresión, " +
          "limitación del tratamiento, oposición y portabilidad escribiendo a hello@studiolxd.com. " +
          "Cuando un tratamiento se basa en tu consentimiento (por ejemplo, la grabación de una " +
          "sesión o Google Analytics), puedes retirarlo en cualquier momento, sin que eso afecte a " +
          "la licitud del tratamiento anterior.",
        "Si consideras que no hemos atendido correctamente tu solicitud, puedes presentar una " +
          "reclamación ante la Agencia Española de Protección de Datos (aepd.es, calle Jorge Juan, " +
          "6, 28001 Madrid).",
        "Además, como titular de una cuenta, puedes ejercer dos de esos derechos directamente desde " +
          "la plataforma:",
      ],
      list: [
        "Portabilidad: descargar un export completo de tus datos en formato JSON desde " +
          "GET /api/me/data-export.",
        [
          "Derecho al olvido: cerrar tu cuenta desde DELETE /api/me. Esto anonimiza de inmediato los " +
            "datos que te identifican y revoca tus sesiones activas; no borra de forma instantánea los " +
            "registros que la plataforma debe conservar por obligación legal (por ejemplo, de " +
            "facturación) ni el contenido ya distribuido a terceros que compraron tu sala (véase la " +
            "sección 6 de los ",
          legalLink("Términos de Servicio", "/legal/terms"),
          ").",
        ],
      ],
    },
    {
      heading: "5.1 Participantes sin cuenta (menores con clave de acceso)",
      paragraphs: [
        "Si has participado en un evento con una clave de acceso, sin cuenta propia, el ejercicio de " +
          "tus derechos (o los de tu hijo o hija, si eres su tutor legal) pasa por el organizador del " +
          "evento (el centro educativo o la empresa), que es quien actúa como responsable de ese " +
          "tratamiento frente a ti, no directamente por la plataforma.",
      ],
    },
    {
      heading: "6. Encargados de tratamiento (proveedores) y transferencias internacionales",
      paragraphs: [
        "Los siguientes proveedores tratan datos de usuarios por cuenta de la plataforma, bajo " +
          "contrato de encargo de tratamiento:",
      ],
      list: [
        "Netcup — hosting de la plataforma (servidores y base de datos), en Núremberg (Alemania), " +
          "Unión Europea; no supone una transferencia internacional.",
        "Stripe — pagos y verificación de creadores (Connect). Sede en Estados Unidos; la " +
          "transferencia se ampara en las Cláusulas Contractuales Tipo aprobadas por la Comisión " +
          "Europea.",
        "ElevenLabs — conversión de texto a audio (generación de voces por IA). Sede en Estados " +
          "Unidos; la transferencia se ampara en las Cláusulas Contractuales Tipo aprobadas por la " +
          "Comisión Europea. Sus condiciones de uso vigentes en plan de pago reconocen la titularidad " +
          "de EscapeRoom Creator sobre el audio generado, pero ElevenLabs se reserva una licencia " +
          "perpetua sobre las voces y el contenido que se le envía para entrenar sus propios modelos.",
        "Anthropic, OpenAI o Google — modelo de lenguaje del editor asistido por IA. La plataforma " +
          "usa uno solo de los tres a la vez, según su configuración, y solo recibe datos cuando un " +
          "creador usa el chat del editor. Los tres tienen sede en Estados Unidos; la transferencia se " +
          "ampara en las Cláusulas Contractuales Tipo aprobadas por la Comisión Europea.",
        "Resend/Postmark — envío de emails transaccionales. Cuando procesan datos fuera del Espacio " +
          "Económico Europeo, la transferencia se ampara en las Cláusulas Contractuales Tipo " +
          "aprobadas por la Comisión Europea u otro mecanismo de transferencia válido conforme al " +
          "RGPD.",
        "Cloudflare R2 — almacenamiento de assets y grabaciones. Cuando procesa datos fuera del " +
          "Espacio Económico Europeo, la transferencia se ampara en las Cláusulas Contractuales Tipo " +
          "aprobadas por la Comisión Europea u otro mecanismo de transferencia válido conforme al " +
          "RGPD.",
        "Magnific (Freepik Company, S.L.U.) — generación y edición de assets visuales " +
          "(imágenes) con IA para el editor. Recibe los prompts y las imágenes de referencia que " +
          "el creador decida subir. Sede en Málaga, España, Unión Europea. Para generar las " +
          "imágenes, Magnific puede recurrir a subencargados propios (proveedores de modelos de IA " +
          "y de infraestructura en la nube) que tratan los datos fuera del Espacio Económico " +
          "Europeo; en ese caso, la transferencia se ampara en las Cláusulas Contractuales Tipo " +
          "aprobadas por la Comisión Europea u otro mecanismo de transferencia válido conforme al " +
          "RGPD.",
        [
          "Plausible — analítica de producto agregada, sin cookies ni identificación individual. " +
            "Empresa y servidores en la Unión Europea; no supone una transferencia internacional " +
            "(véase la ",
          legalLink("Política de Cookies", "/legal/cookies"),
          ").",
        ],
        [
          "Google Analytics — analítica de producto; usa cookies (`_ga`/`_ga_*`) y solo se carga con " +
            "tu consentimiento previo. Sede en Estados Unidos; la transferencia se ampara en las " +
            "Cláusulas Contractuales Tipo aprobadas por la Comisión Europea (véase la ",
          legalLink("Política de Cookies", "/legal/cookies"),
          ").",
        ],
      ],
    },
    {
      heading: "7. Responsable del tratamiento y contacto",
      paragraphs: [
        [
          "Responsable del tratamiento: Studio LXD, S.L. — NIF B24941411 — Avenida Menéndez Pelayo, " +
            "36, 3.º, D. 28007 Madrid — hello@studiolxd.com. Más datos identificativos en el ",
          legalLink("Aviso Legal", "/legal/legal-notice"),
          ".",
        ],
      ],
    },
    {
      heading: "8. Cambios en esta política",
      paragraphs: [
        "Esta política puede actualizarse para reflejar cambios en el servicio o en la normativa " +
          "aplicable. Cuando cambie su versión, la plataforma te pedirá que la leas y la aceptes al " +
          "entrar en tu cuenta, junto con los Términos de Servicio.",
      ],
    },
    languageVersionsSection(9),
  ],
};
