import type { LegalDocument } from "./types";

/**
 * Plantilla de Contrato de Encargo de Tratamiento (DPA) — BORRADOR TÉCNICO
 * (ticket 6.2, specs/18 §3.1).
 *
 * Esto es el TEXTO de la plantilla que un organizador B2B/Edu lee y firma; el
 * MECANISMO de firma (quién puede firmar, versión aceptada, puerta
 * `DPA_REQUIRED`) ya está implementado desde el ticket 5.11 en
 * `packages/shared/src/services/organizations.ts` y no cambia aquí — esta
 * página solo aporta el contenido legal que ese flujo de firma le muestra al
 * organizador antes de aceptar.
 */
export const dpaTemplate: LegalDocument = {
  draftDate: "2026-09-23",
  sections: [
    {
      heading: "0. Qué es este documento",
      paragraphs: [
        "Esta página es un borrador técnico, no un contrato listo para firmar. Describe el contenido " +
          "que debe tener el contrato de encargo de tratamiento (DPA) que un organizador B2B/Edu " +
          "firma antes de generar claves de acceso individuales con el email de sus participantes " +
          "(specs/18 §3.1). Un abogado debe revisarlo antes de que sustituya al texto que hoy acepta " +
          "el flujo de firma (`POST /api/organizations/:id/dpa/sign`).",
      ],
    },
    {
      heading: "1. Cuándo hace falta este contrato",
      paragraphs: [
        "Cuando una organización activa un tipo de clave de acceso `individual` con email para " +
          "repartir invitaciones a sus participantes (por ejemplo, alumnado de un centro educativo o " +
          "empleados de una empresa), la plataforma trata esos emails por cuenta y bajo instrucciones " +
          "de esa organización. El Reglamento General de Protección de Datos exige un contrato entre " +
          "responsable (la organización) y encargado (la plataforma) para ese tratamiento.",
        "Las claves de tipo `group` o `batch` (código impreso o compartido, sin datos personales de " +
          "un participante concreto) no requieren este contrato y siguen disponibles sin fricción; es " +
          "la opción recomendada por defecto para centros educativos que quieran minimizar los datos " +
          "personales que comparten con la plataforma.",
      ],
    },
    {
      heading: "2. Partes",
      paragraphs: [
        "Responsable del tratamiento: la organización que firma (el organizador del evento).",
        "Encargado del tratamiento: Studio LXD, S.L. — NIF B24941411 — Avenida Menéndez Pelayo, 36, " +
          "3.º, D. 28007 Madrid — hello@studiolxd.com, operadora de EscapeRoom Creator.",
      ],
    },
    {
      heading: "3. Objeto, naturaleza y finalidad del tratamiento",
      paragraphs: [
        "Objeto: generación y envío de claves de acceso individuales a los participantes de un " +
          "evento organizado por el responsable, y su seguimiento operativo durante el evento.",
        "Naturaleza del tratamiento: almacenamiento del email del participante, envío del email de " +
          "invitación con la clave de acceso, y asociación de esa clave con su progreso en la sala " +
          "mientras dura el evento.",
        "Finalidad: exclusivamente permitir que el participante acceda al evento organizado por el " +
          "responsable. La plataforma no usa estos emails para ningún otro fin (marketing, perfiles " +
          "de producto ajenos al evento, etc.).",
      ],
    },
    {
      heading: "4. Tipo de datos y categorías de interesados",
      paragraphs: [
        "Datos tratados: email del participante y, opcionalmente, el nombre que introduzca al " +
          "canjear su clave.",
        "Categorías de interesados: participantes del evento organizado por el responsable, que " +
          "pueden incluir menores de edad cuando el responsable es un centro educativo. Ningún " +
          "participante crea una cuenta propia en la plataforma a través de este flujo.",
      ],
    },
    {
      heading: "5. Obligaciones del encargado (la plataforma)",
      paragraphs: [
        "Tratar los datos únicamente siguiendo las instrucciones documentadas del responsable y para " +
          "la finalidad de la sección 3.",
        "Garantizar la confidencialidad del personal autorizado a acceder a estos datos.",
        "Aplicar medidas de seguridad técnicas y organizativas apropiadas (cifrado en tránsito, " +
          "control de acceso, registro de auditoría).",
        "Notificar al responsable, sin dilación indebida, cualquier violación de la seguridad de " +
          "estos datos de la que tenga conocimiento.",
        "Asistir al responsable para que pueda cumplir sus obligaciones de responder a los derechos " +
          "de sus participantes (acceso, rectificación, supresión, etc.). Los participantes deben " +
          "dirigir sus solicitudes al responsable (el organizador), no a la plataforma; si la " +
          "plataforma recibe una solicitud de este tipo, la trasladará al organizador sin dilación " +
          "indebida. La plataforma asiste al responsable mediante las funciones que ya ofrece " +
          "(exportación y borrado de datos desde la cuenta del organizador) y, cuando eso no baste, " +
          "con el apoyo razonable adicional que el organizador solicite.",
        "Suprimir o devolver todos los datos personales al finalizar la prestación del servicio, " +
          "salvo obligación legal de conservación (véase la sección 6).",
        "No subcontratar el tratamiento a un tercero sin autorización previa del responsable, salvo " +
          "los subprocesadores ya listados en la Política de Privacidad §6 (Stripe, ElevenLabs, " +
          "Resend/Postmark, Cloudflare R2 y, si se activa, LiveKit Cloud), que el responsable acepta " +
          "al firmar este contrato.",
      ],
    },
    {
      heading: "6. Retención y borrado",
      paragraphs: [
        "El email de un participante asociado a una clave de acceso se conserva 12 meses tras la " +
          "finalización del evento; pasado ese plazo se sustituye por un valor no reversible (hash) " +
          "que impide reidentificar al participante.",
        "Para eventos con audiencia educativa (los que pueden incluir menores de edad) ese plazo se " +
          "reduce a 3 meses tras la finalización del evento. Los menores merecen una protección " +
          "específica (considerando 38 del RGPD) y el principio de minimización (artículo 5.1.c y " +
          "5.1.e) obliga a no conservar su email más allá de lo que exige la finalidad: el único uso " +
          "posterior al evento es que el responsable compruebe quién participó o reemita una clave, " +
          "y esa necesidad se agota en las semanas siguientes, dentro del mismo trimestre escolar. El " +
          "responsable conserva además su propia lista de alumnado, así que la copia de la " +
          "plataforma no es la fuente de ese dato. Los 12 meses generales se mantienen para eventos " +
          "de empresa, donde el organizador puede necesitar reconstruir la asistencia meses después " +
          "(por ejemplo, para acreditar una formación).",
        "En ambos casos el responsable puede pedir en cualquier momento la supresión anticipada de " +
          "los emails de un evento, y la plataforma la ejecuta sin esperar a que venza el plazo " +
          "(artículo 28.3.g del RGPD).",
      ],
    },
    {
      heading: "7. Transferencias internacionales",
      paragraphs: [
        "Los subprocesadores listados en la Política de Privacidad §6 con sede fuera del Espacio " +
          "Económico Europeo (Stripe y ElevenLabs, en Estados Unidos) tratan datos amparados en las " +
          "Cláusulas Contractuales Tipo aprobadas por la Comisión Europea u otro mecanismo de " +
          "transferencia válido conforme al RGPD; lo mismo aplica a lo que Resend/Postmark y " +
          "Cloudflare R2 procesen fuera de la Unión Europea.",
      ],
    },
    {
      heading: "8. Vigencia y versión",
      paragraphs: [
        "Este contrato tiene la versión indicada en el flujo de firma de la plataforma. Si el texto " +
          "cambia, la organización debe volver a aceptarlo antes de poder seguir generando claves " +
          "individuales con email: una firma de una versión anterior no habilita nada (implementado " +
          "en el ticket 5.11).",
      ],
    },
  ],
};
