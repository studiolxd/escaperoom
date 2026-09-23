import type { LegalDocument } from "./types";

/**
 * Política de Privacidad — BORRADOR TÉCNICO (ticket 6.2, specs/18 §3–§4).
 *
 * Mismo aviso que `terms.ts`: no es un texto legal definitivo, es la base
 * técnica para que un abogado redacte el texto real antes del primer evento
 * educativo real o el primer pago.
 */
export const privacyPolicy: LegalDocument = {
  draftDate: "2026-09-23",
  sections: [
    {
      heading: "0. Qué es este documento",
      paragraphs: [
        "Esta página es un borrador técnico, no un texto legal vigente. Describe qué datos trata " +
          "EscapeRoom Creator, con qué base legal y durante cuánto tiempo, a partir de las decisiones " +
          "de producto ya tomadas (specs/18 §3). Un abogado especializado en protección de datos " +
          "(RGPD/LOPDGDD) debe revisarlo y convertirlo en el texto vigente.",
      ],
    },
    {
      heading: "1. Roles según el flujo de datos",
      paragraphs: [
        "La plataforma actúa como responsable del tratamiento de los datos de la cuenta " +
          "(jugador, creador u organizador).",
        "Cuando un organizador genera claves de acceso individuales con el email de un participante " +
          "(por ejemplo, alumnado de un centro educativo), la plataforma trata ese email por " +
          "encargo del organizador: el organizador es el responsable de ese tratamiento frente a sus " +
          "participantes y necesita su propia base legal frente a ellos.",
        "Cuando se activa la grabación de una sesión (solo disponible fuera del contexto educativo, " +
          "con consentimiento explícito y unánime de los participantes), la plataforma también trata " +
          "esos datos por encargo de quien organiza la sesión.",
      ],
    },
    {
      heading: "2. Qué datos tratamos y con qué base legal",
      paragraphs: [
        "Datos de cuenta (email, nombre): para ejecutar el contrato de uso de la plataforma.",
        "Datos de pago: los procesa Stripe; la plataforma solo recibe referencias de la transacción, " +
          "necesarias para ejecutar el contrato y cumplir obligaciones de facturación.",
        "Analítica de producto: por interés legítimo, con mecanismo de oposición disponible.",
        "Emails de participantes en claves de acceso individuales: tratados por encargo del " +
          "organizador (véase la sección 1); exigen que el organizador tenga firmado un contrato de " +
          "encargo de tratamiento (DPA) con la plataforma antes de poder usar esa función.",
        "Chat de la partida: por interés legítimo (es parte de la funcionalidad del juego), sujeto a " +
          "moderación automática y con una retención mínima (véase la sección 4).",
        "Grabación de sesión: solo con consentimiento explícito y unánime de los participantes; nunca " +
          "disponible para eventos con audiencia educativa.",
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
        "[PENDIENTE ASESORÍA LEGAL: confirmar con asesoría que este diseño ('sin cuenta propia del " +
          "menor, responsable = el centro u organización') es una garantía suficiente frente a la edad " +
          "de consentimiento propio de la LOPDGDD (14 años en España), tal y como pide specs/18 §4].",
      ],
    },
    {
      heading: "4. Cuánto tiempo conservamos los datos",
      paragraphs: [
        "[PENDIENTE ASESORÍA LEGAL: confirmar con asesoría fiscal el plazo exacto de conservación de " +
          "los registros de facturación tras el cierre de una cuenta (specs/18 §3.3 propone 4–6 años " +
          "como orientación en España, sin confirmar)]. Los plazos propuestos para el resto de datos, " +
          "a falta también de confirmación con asesoría, son:",
      ],
      list: [
        "Cuenta cerrada por el usuario: los campos identificativos se anonimizan de inmediato; se " +
          "conserva un registro transaccional de las compras, sin datos personales visibles, por " +
          "obligación de facturación.",
        "Clave de acceso con email de un participante: 12 meses tras el evento, después el email se " +
          "sustituye por un valor no reversible (hash).",
        "Grabación de sesión (cuando existe consentimiento): 90 días.",
        "Eventos de analítica detallados: 24 meses; los datos agregados y anonimizados se conservan " +
          "sin límite de tiempo.",
        "Reportes e historial de moderación: sin borrado automático, para poder detectar reincidencia.",
      ],
    },
    {
      heading: "5. Derechos de las personas usuarias",
      paragraphs: [
        "Como titular de una cuenta, puedes ejercer los siguientes derechos directamente desde la " +
          "plataforma:",
      ],
      list: [
        "Portabilidad: descargar un export completo de tus datos en formato JSON desde " +
          "GET /api/me/data-export.",
        "Derecho al olvido: cerrar tu cuenta desde DELETE /api/me. Esto anonimiza de inmediato los " +
          "datos que te identifican y revoca tus sesiones activas; no borra de forma instantánea los " +
          "registros que la plataforma debe conservar por obligación legal (por ejemplo, de " +
          "facturación) ni el contenido ya distribuido a terceros que compraron tu sala (véase la " +
          "sección 4 de los Términos de Servicio).",
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
        "Los siguientes proveedores tratan datos de usuarios por cuenta de la plataforma. " +
          "[PENDIENTE ASESORÍA LEGAL: confirmar, para cada uno, la ubicación exacta del procesamiento " +
          "y las garantías de transferencia internacional vigentes (cláusulas contractuales tipo u " +
          "otro mecanismo), y firmar el contrato de encargo de tratamiento correspondiente antes de " +
          "procesar datos reales (specs/18 §3.5)]:",
      ],
      list: [
        "Stripe — pagos y verificación de creadores (Connect).",
        "ElevenLabs — conversión de texto a audio (generación de voces por IA).",
        "Resend/Postmark — envío de emails transaccionales.",
        "Cloudflare R2 — almacenamiento de assets y grabaciones.",
        "LiveKit Cloud — solo si se activa como plan de contingencia para audio/vídeo en tránsito; " +
          "mientras el servicio se opere en modo self-hosted, este proveedor no interviene.",
        "Plausible — analítica de producto planificada, no activa todavía; no usa cookies. Mientras " +
          "no se active, este proveedor no interviene (véase la Política de Cookies).",
        "Google Analytics — analítica de producto planificada, no activa todavía; usa cookies " +
          "(`_ga`/`_ga_*`) y solo se cargaría con consentimiento previo. Mientras no se active, este " +
          "proveedor no interviene (véase la Política de Cookies).",
      ],
    },
    {
      heading: "7. Contacto",
      paragraphs: [
        "[PENDIENTE ASESORÍA LEGAL: incluir aquí los datos identificativos del responsable del " +
          "tratamiento y, si aplica, del delegado de protección de datos, conforme a lo que exija la " +
          "asesoría legal].",
      ],
    },
  ],
};
