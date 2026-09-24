import { languageVersionsSection } from "./language-versions";
import { legalLink, type LegalDocument } from "./types";

/**
 * Anexo de encargo de tratamiento (DPA) — BORRADOR TÉCNICO (ticket 6.2,
 * specs/18 §3.1).
 *
 * Es el anexo de los Términos de Servicio que regula el tratamiento que la
 * plataforma hace por cuenta de un organizador (art. 28.3 RGPD), no una
 * plantilla suelta: se acepta junto con los Términos, y además un organizador
 * B2B/Edu confirma expresamente su versión vigente antes de generar claves
 * individuales con email. Ese MECANISMO de aceptación (quién puede aceptar,
 * versión aceptada, puerta `DPA_REQUIRED`) ya está implementado desde el
 * ticket 5.11 en `packages/shared/src/services/organizations.ts` y no cambia
 * aquí — esta página solo aporta el contenido legal que ese flujo le muestra
 * al organizador antes de aceptar.
 *
 * Estructura alineada con el anexo equivalente de slxd
 * (`slxd/packages/legal/content/es/dpa.mdx`), adaptada a lo que la plataforma
 * trata de verdad por cuenta del organizador.
 */
export const dpaAnnex: LegalDocument = {
  draftDate: "2026-09-23",
  sections: [
    {
      heading: "0. Qué es este anexo",
      paragraphs: [
        "Esta página es un borrador técnico, no un texto legal vigente. Un abogado debe revisarlo " +
          "antes de que sustituya al texto que hoy acepta el flujo de aceptación del anexo " +
          "(`POST /api/organizations/:id/dpa/sign`).",
        [
          "Este anexo es el contrato de encargo de tratamiento que exige el artículo 28.3 del " +
            "Reglamento (UE) 2016/679 (RGPD) cuando la plataforma trata datos personales por cuenta " +
            "de un organizador. Forma parte de los ",
          legalLink("Términos de Servicio", "/legal/terms"),
          " y se acepta junto con ellos, sin firmar ningún documento aparte. Además, antes de " +
            "generar claves de acceso individuales con email, la organización confirma expresamente " +
            "la versión vigente de este anexo (véase la sección 14).",
        ],
        [
          "Este anexo solo regula los datos que la plataforma trata por cuenta del organizador. El " +
            "tratamiento de los datos propios de la cuenta del organizador (registro, pagos, " +
            "facturación, seguridad) lo hace la plataforma como responsable y se describe en la ",
          legalLink("Política de Privacidad", "/legal/privacy"),
          ".",
        ],
      ],
    },
    {
      heading: "1. Cuándo se aplica",
      paragraphs: [
        "Cuando una organización activa un tipo de clave de acceso `individual` con email para " +
          "repartir invitaciones a sus participantes (por ejemplo, alumnado de un centro educativo o " +
          "empleados de una empresa), la plataforma trata esos emails por cuenta y bajo instrucciones " +
          "de esa organización. Lo mismo ocurre con la grabación de una sesión, cuando quien la " +
          "organiza la activa (solo fuera de eventos con audiencia educativa y con consentimiento " +
          "explícito y unánime de los participantes).",
        "Las claves de tipo `group` o `batch` (código impreso o compartido, sin datos personales de " +
          "un participante concreto) no exigen confirmar este anexo y siguen disponibles sin " +
          "fricción; es la opción recomendada por defecto para centros educativos que quieran " +
          "minimizar los datos personales que comparten con la plataforma.",
      ],
    },
    {
      heading: "2. Partes",
      paragraphs: [
        "Responsable del tratamiento: la organización que acepta este anexo (el organizador del " +
          "evento), con los datos identificativos que consten en su cuenta.",
        [
          "Encargado del tratamiento: Studio LXD, S.L. — NIF B24941411 — Avenida Menéndez Pelayo, " +
            "36, 3.º, D. 28007 Madrid — hello@studiolxd.com, operadora de EscapeRoom Creator. Más " +
            "datos identificativos en el ",
          legalLink("Aviso Legal", "/legal/legal-notice"),
          ".",
        ],
      ],
    },
    {
      heading: "3. Objeto, duración, naturaleza y finalidad del tratamiento",
      paragraphs: [
        "Objeto: generación y envío de claves de acceso individuales a los participantes de un " +
          "evento organizado por el responsable, su seguimiento operativo durante el evento y, " +
          "cuando se activa, la grabación de la sesión.",
        "Duración: el encargo dura mientras la organización use estas funciones en la plataforma, " +
          "y termina con los plazos de conservación y supresión de la sección 10.",
        "Naturaleza del tratamiento: almacenamiento del email del participante, envío del email de " +
          "invitación con la clave de acceso, asociación de esa clave con su progreso en la sala " +
          "mientras dura el evento y, en su caso, almacenamiento de la grabación.",
        "Finalidad: exclusivamente permitir que el participante acceda al evento organizado por el " +
          "responsable. La plataforma no usa estos datos para ningún otro fin (marketing, perfiles " +
          "de producto ajenos al evento, entrenamiento de modelos de inteligencia artificial, etc.).",
      ],
    },
    {
      heading: "4. Tipo de datos y categorías de interesados",
      paragraphs: [
        "Datos tratados: email del participante, el nombre que introduzca opcionalmente al canjear " +
          "su clave, su progreso en la sala y, solo si se activa la grabación, la imagen y la voz " +
          "de la sesión grabada.",
        "Categorías de interesados: participantes del evento organizado por el responsable, que " +
          "pueden incluir menores de edad cuando el responsable es un centro educativo. Ningún " +
          "participante crea una cuenta propia en la plataforma a través de este flujo.",
      ],
    },
    {
      heading: "5. Instrucciones documentadas",
      paragraphs: [
        "La plataforma trata los datos únicamente siguiendo instrucciones documentadas del " +
          "responsable. Constituyen esas instrucciones este anexo, el uso que el organizador hace de " +
          "la plataforma (a quién invita, qué tipo de clave genera, si activa la grabación) y " +
          "cualquier otra instrucción que comunique por escrito y que sea técnicamente posible y " +
          "conforme a derecho.",
        "Si la plataforma considera que una instrucción infringe el RGPD u otra norma de protección " +
          "de datos, lo comunicará de inmediato al responsable (artículo 28.3 del RGPD) y podrá " +
          "suspender su ejecución hasta que se aclare.",
      ],
    },
    {
      heading: "6. Obligaciones del encargado (la plataforma)",
      paragraphs: [
        "Tratar los datos únicamente para la finalidad de la sección 3 y según las instrucciones de " +
          "la sección 5.",
        "Garantizar que el personal autorizado a acceder a estos datos está sujeto a un deber de " +
          "confidencialidad, que se mantiene también después de terminar el encargo.",
        "Aplicar medidas de seguridad técnicas y organizativas apropiadas (artículo 32 del RGPD): " +
          "cifrado en tránsito, control de acceso y registro de auditoría.",
        "Suprimir o devolver los datos personales al terminar el encargo, salvo obligación legal de " +
          "conservación (véase la sección 10).",
      ],
    },
    {
      heading: "7. Subencargados",
      paragraphs: [
        "El responsable autoriza de forma general que la plataforma recurra a los siguientes " +
          "subencargados, que tratan datos de sus participantes solo en la medida necesaria para su " +
          "función y bajo un contrato que les impone las mismas obligaciones de protección de datos " +
          "que este anexo. La plataforma responde frente al responsable de su cumplimiento.",
      ],
      list: [
        "Netcup GmbH — hosting de la plataforma (servidores y base de datos) sobre la que se " +
          "almacenan y procesan estos datos mientras dura el encargo, en Núremberg (Alemania), " +
          "Unión Europea; no supone una transferencia internacional (véase la sección 12).",
        "Resend/Postmark — envío del email de invitación con la clave de acceso.",
        "Cloudflare R2 — almacenamiento de las grabaciones de sesión, solo cuando se activa la " +
          "grabación.",
        "LiveKit Cloud — audio y vídeo en tránsito durante la sesión, solo si se activa como plan de " +
          "contingencia; mientras el servicio se opere en modo self-hosted, este proveedor no " +
          "interviene.",
      ],
    },
    {
      heading: "7.1 Proveedores que no son subencargados de este anexo",
      paragraphs: [
        [
          "Stripe (pagos del organizador), ElevenLabs (voces generadas a partir de los textos de los " +
            "creadores), los proveedores de modelos de lenguaje del editor asistido por IA y las " +
            "herramientas de analítica aparecen en la ",
          legalLink("Política de Privacidad", "/legal/privacy"),
          ", pero no reciben datos de los participantes de un evento: tratan datos de la relación " +
            "de la plataforma con sus propios usuarios, como responsable, y por eso no forman parte " +
            "de este anexo.",
        ],
      ],
    },
    {
      heading: "7.2 Cambios en la lista de subencargados",
      paragraphs: [
        "Antes de incorporar o sustituir un subencargado, la plataforma lo anunciará con una " +
          "antelación mínima de 30 días, actualizando esta lista y avisando a las organizaciones que " +
          "tengan aceptado este anexo, para que puedan oponerse por motivos razonables relacionados " +
          "con la protección de datos (artículo 28.2 del RGPD). Si no se encuentra una alternativa, " +
          "la organización puede dejar de usar la función afectada sin penalización.",
      ],
    },
    {
      heading: "8. Asistencia al responsable",
      paragraphs: [
        "Los participantes deben dirigir sus solicitudes de acceso, rectificación, supresión, " +
          "limitación, oposición o portabilidad al responsable (el organizador), no a la plataforma; " +
          "si la plataforma recibe una solicitud de este tipo, no la atenderá por su cuenta: la " +
          "trasladará al organizador sin dilación indebida. La plataforma asiste al responsable " +
          "mediante las funciones que ya ofrece (exportación y borrado de datos desde la cuenta del " +
          "organizador) y, cuando eso no baste, con el apoyo razonable adicional que el organizador " +
          "solicite.",
        "La plataforma también asiste al responsable, a petición suya, en las evaluaciones de " +
          "impacto relativas a la protección de datos y en las consultas previas a la autoridad de " +
          "control (artículos 35 y 36 del RGPD) — por ejemplo, la que un centro educativo puede " +
          "necesitar por tratar datos de menores —, en la medida en que la información necesaria " +
          "esté en su poder.",
      ],
    },
    {
      heading: "9. Notificación de violaciones de seguridad",
      paragraphs: [
        "La plataforma notificará al responsable, sin dilación indebida y, en todo caso, dentro de " +
          "las 48 horas siguientes a que tenga constancia de ella, cualquier violación de la " +
          "seguridad de estos datos, por correo electrónico a la dirección de contacto de su " +
          "organización.",
        "La notificación describirá, en la medida en que se conozca, la naturaleza de la violación, " +
          "las categorías y el número aproximado de interesados y de registros afectados, las " +
          "consecuencias probables y las medidas adoptadas o propuestas (artículo 33.3 del RGPD); si " +
          "no es posible dar toda esa información a la vez, se irá completando sin más demora. " +
          "Corresponde al responsable decidir sobre la notificación a la autoridad de control y a " +
          "los interesados.",
      ],
    },
    {
      heading: "10. Retención y borrado",
      paragraphs: [
        "El email de un participante asociado a una clave de acceso se conserva 12 meses tras la " +
          "finalización del evento; pasado ese plazo se seudonimiza (se sustituye por un hash " +
          "calculado con una clave que solo conserva la plataforma; no es una anonimización total, " +
          "ya que en teoría el email original podría recalcularse con esa clave).",
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
        "La grabación de una sesión, cuando existe, se conserva 90 días.",
        "En todos los casos el responsable puede pedir en cualquier momento la supresión anticipada " +
          "de los datos de un evento, y la plataforma la ejecuta sin esperar a que venza el plazo " +
          "(artículo 28.3.g del RGPD).",
      ],
    },
    {
      heading: "11. Auditoría e información",
      paragraphs: [
        "La plataforma pone a disposición del responsable, a petición suya y por escrito, toda la " +
          "información necesaria para demostrar el cumplimiento de las obligaciones del artículo 28 " +
          "del RGPD.",
        "El responsable puede además verificar ese cumplimiento mediante una auditoría, propia o de " +
          "un auditor que designe, previo aviso razonable —al menos 30 días naturales—, una vez al " +
          "año como máximo (salvo que lo exija la autoridad de control o haya mediado una violación " +
          "de seguridad), en horario laboral, sin interferir en la actividad, bajo acuerdo de " +
          "confidencialidad y a su costa. Como los sistemas son compartidos con otras organizaciones, " +
          "la verificación no puede alcanzar datos de terceros: se realizará sobre documentación, " +
          "configuración y entornos acotados.",
      ],
    },
    {
      heading: "12. Transferencias internacionales",
      paragraphs: [
        "Los subencargados de la sección 7 que procesen datos fuera del Espacio Económico Europeo " +
          "lo hacen amparados en las Cláusulas Contractuales Tipo aprobadas por la Comisión Europea " +
          "u otro mecanismo de transferencia válido conforme al RGPD.",
      ],
    },
    {
      heading: "13. Responsabilidad",
      paragraphs: [
        [
          "Cada parte responde de los daños que cause por incumplir las obligaciones que el RGPD le " +
            "impone. La responsabilidad derivada de este anexo se rige por lo previsto en los ",
          legalLink("Términos de Servicio", "/legal/terms"),
          ", sin que ello limite la responsabilidad frente a los interesados ni frente a las " +
            "autoridades de control prevista en el artículo 82 del RGPD.",
        ],
      ],
    },
    {
      heading: "14. Vigencia, versión y cambios",
      paragraphs: [
        "Este anexo tiene la versión indicada en el flujo de aceptación de la plataforma. Si el " +
          "texto cambia, la organización debe volver a aceptarlo antes de poder seguir generando " +
          "claves individuales con email: una aceptación de una versión anterior no habilita nada.",
      ],
    },
    {
      heading: "15. Ley aplicable y jurisdicción",
      paragraphs: [
        "Este anexo se rige por la legislación española y por el RGPD. Para la resolución de " +
          "cualquier controversia, las partes se someten a los tribunales de Madrid, con renuncia a " +
          "cualquier otro fuero que pudiera corresponderles.",
      ],
    },
    languageVersionsSection(16),
  ],
};
