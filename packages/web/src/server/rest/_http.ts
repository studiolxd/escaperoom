/**
 * Contrato de error REST único (A-22, auditoría 2026-09-24): ≈20 adaptadores
 * reimplementaban `NO_STORE`/`errorResponse`/`readJson`/`handle`/`queryOf`
 * con variantes menores — `VALIDATION_ERROR` era 400 en algunas rutas y 422
 * en otras, el JSON roto era `BAD_REQUEST`/`VALIDATION_ERROR`/`INVALID_JSON`
 * según el fichero, y algunas rutas privadas u de error no ponían `no-store`.
 * Fijado en specs/13 §1: `VALIDATION_ERROR` = 422 en todas las rutas, JSON
 * roto = `INVALID_JSON` 400, no autenticado = `UNAUTHORIZED` 401, `no-store`
 * en toda respuesta privada o de error.
 */

export const NO_STORE = { "Cache-Control": "no-store" };

export function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: NO_STORE });
}

/** Cuerpo JSON roto (`INVALID_JSON`, distinto de `VALIDATION_ERROR`: la forma, no el contenido). */
export class BadJsonError extends Error {}

/**
 * Cuerpo JSON de la petición. Por defecto un cuerpo vacío es `INVALID_JSON`
 * (el caso normal: casi todo POST/PATCH exige `{...}`); `allowEmpty: true`
 * lo trata como `{}` (rutas con cuerpo opcional, p. ej. `license-checkout`).
 */
export async function readJson(request: Request, opts: { allowEmpty?: boolean } = {}): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) {
    if (opts.allowEmpty) return {};
    throw new BadJsonError("El cuerpo no es JSON válido");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadJsonError("El cuerpo no es JSON válido");
  }
}

/** Subconjunto de `?query=params` presentes en la URL, como `Record<string, string>`. */
export function queryOf(request: Request, keys: readonly string[]): Record<string, string> {
  const url = new URL(request.url);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** Forma mínima de un error de dominio: `code` (unión propia del servicio) + `message`. */
type DomainError = { code: string; message: string };

/**
 * Traduce un error de dominio (`ErrorClass`) a la forma de error REST
 * (specs/13 §1) según `statusByCode`, y un `BadJsonError` a `INVALID_JSON`
 * 400. Cualquier otro error se relanza (500 sin forma conocida: nunca se
 * filtra un stack trace, pero tampoco se disfraza de un código de dominio).
 *
 * Los campos extra del error (`issues`, `resultingRoomId`, `details`, …) se
 * incluyen tal cual si el objeto los trae — cada dominio decide cuáles.
 */
function defaultExtra(raw: DomainError & Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "code" || key === "message" || key === "name" || key === "stack") continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    extra[key] = value;
  }
  return extra;
}

export function handleDomainErrors<E extends DomainError>(
  ErrorClass: new (...args: never[]) => E,
  statusByCode: Record<string, number>,
  /**
   * Campos extra del error, tal cual van en `{ error: { code, message, ... } }`.
   * Por defecto, cada propiedad propia del error salvo `code`/`message`/
   * `name`/`stack` (y descartando `null`/`undefined`/arrays vacíos). Algunos
   * dominios (p. ej. `RoomPublishError.details`) necesitan un objeto anidado
   * SPREADEADO en vez de anidado bajo su propio nombre — para esos, pasa un
   * `toExtra` propio.
   */
  toExtra: (err: E) => Record<string, unknown> = defaultExtra,
) {
  return async function handle(fn: () => Promise<Response>): Promise<Response> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ErrorClass) {
        const status = statusByCode[err.code] ?? 500;
        return errorResponse(err.code, err.message, status, toExtra(err));
      }
      if (err instanceof BadJsonError) return errorResponse("INVALID_JSON", err.message, 400);
      throw err;
    }
  };
}
