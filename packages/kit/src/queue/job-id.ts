/**
 * Identificadores de job propios (`jobId`).
 *
 * BullMQ usa `:` como separador de sus claves de Redis y **rechaza** todo
 * `jobId` propio que lo lleve (`Custom Id cannot contain :`). También rechaza
 * uno que sea un entero (`Custom Id cannot be integers`), porque colisionaría
 * con los ids que genera él. Y lo rechaza *dentro* de `queue.add()`, así que el
 * fallo llega como una promesa rota del encolado y es facilísimo confundirlo
 * con «Redis está caído».
 *
 * El separador es `-`: BullMQ lo admite y conserva la propiedad que se busca
 * con un id propio, que dos encolados con las mismas partes sean el mismo job.
 *
 * Política de fallo: un `jobId` inválido es un **defecto de programación**, no
 * una avería de infraestructura. Por eso revienta en desarrollo y en los tests
 * —donde hay alguien mirando— y en producción se registra con `logger.error`
 * tras reparar el id, para no tumbar la petición de nadie por un separador.
 *
 * Adaptado de @slxd/kit/queue/job-id (ADR-017).
 */

/** El separador que BullMQ admite en un `jobId` propio. */
export const JOB_ID_SEPARATOR = "-";

/** Carácter con el que se repara un `jobId` inválido en producción. */
const REPLACEMENT = JOB_ID_SEPARATOR;

/** Marcador de una parte vacía: el id sigue siendo válido y se ve que falta. */
const EMPTY_PART = "_";

function isIntegerLike(id: string): boolean {
  return `${parseInt(id, 10)}` === id;
}

/**
 * Qué le pasa a este `jobId`, o `null` si está bien. El texto es el que se
 * registra y el que ve quien escribe el código, así que dice el porqué.
 */
export function jobIdProblem(id: string): string | null {
  if (id.length === 0) return "está vacío";
  if (id.includes(":")) {
    return `contiene ":", que BullMQ reserva como separador de claves (usa "${JOB_ID_SEPARATOR}")`;
  }
  if (isIntegerLike(id)) {
    return "es un entero, y BullMQ los reserva para los ids que genera él";
  }
  return null;
}

/** ¿BullMQ aceptaría este `jobId` propio? */
export function isValidJobId(id: string): boolean {
  return jobIdProblem(id) === null;
}

/**
 * Registra un defecto de `jobId`: ruidoso donde hay alguien mirando, visible
 * donde no lo hay. Devuelve siempre; quien llama decide qué hacer después.
 */
export function reportJobIdDefect(problem: string, details: Record<string, unknown>): void {
  const err = new Error(`queue: jobId inválido — ${problem}`);
  if (process.env.NODE_ENV !== "production") throw err;
  // El logger se carga aquí y no arriba a propósito: este módulo lo importan
  // sitios que no quieren arrastrar pino ni bullmq. Solo se paga en la rama de
  // producción, que es la única que registra en vez de lanzar.
  void import("../logger")
    .then(({ logger }) => logger.error({ err, ...details }, "queue: jobId inválido"))
    .catch(() => console.error(err, details));
}

/** Repara un `jobId` para que BullMQ lo acepte (solo en producción). */
function repairJobId(id: string): string {
  const repaired = id.split(":").join(REPLACEMENT);
  if (repaired.length === 0) return EMPTY_PART;
  return isIntegerLike(repaired) ? `${repaired}${JOB_ID_SEPARATOR}` : repaired;
}

/**
 * Construye un `jobId` propio a partir de sus partes, unidas por `-`.
 *
 *     safeJobId("holded-sync", organizationId) // "holded-sync-org_123"
 *
 * Una parte que BullMQ no admitiría (lleva `:`, o está vacía) es un defecto:
 * lanza en desarrollo y en los tests, y en producción se repara y se registra.
 */
export function safeJobId(...parts: (string | number)[]): string {
  const cleaned = parts.map((part) => {
    const raw = String(part).trim();
    if (raw.length === 0) {
      reportJobIdDefect("una de sus partes está vacía", { parts });
      return EMPTY_PART;
    }
    if (raw.includes(":")) {
      reportJobIdDefect(
        `la parte "${raw}" contiene ":", que BullMQ reserva como separador de claves`,
        { parts },
      );
      return raw.split(":").join(REPLACEMENT);
    }
    return raw;
  });

  const id = cleaned.join(JOB_ID_SEPARATOR);
  const problem = jobIdProblem(id);
  if (!problem) return id;

  // Solo llega aquí lo que no se ve parte a parte (un id entero, p. ej.
  // `safeJobId(12)`): mismo trato, defecto y reparación.
  reportJobIdDefect(problem, { parts });
  return repairJobId(id);
}
