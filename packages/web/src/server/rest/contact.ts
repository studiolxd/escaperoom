import { ContactError, type ContactErrorCode, type ContactService } from "@escaperoom/shared/services";

/** Dependencias inyectables del handler de contacto (testeable sin SMTP). */
export type ContactHandlerDeps = {
  /** `null` = email sin configurar (falta destino/remitente en producción). */
  contact: ContactService | null;
};

const STATUS_BY_CODE: Record<ContactErrorCode, number> = {
  VALIDATION_ERROR: 422,
  DELIVERY_UNAVAILABLE: 503,
  DELIVERY_FAILED: 502,
};

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number, extra = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: NO_STORE });
}

class BadJsonError extends Error {}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadJsonError("El cuerpo no es JSON válido");
  }
}

/**
 * Handler REST del formulario de contacto público. Adaptador fino sobre
 * `ContactService`: la validación y el envío viven en el servicio.
 */
export function createContactHandler(deps: ContactHandlerDeps) {
  return async function postContact(request: Request): Promise<Response> {
    try {
      if (!deps.contact) {
        return errorResponse(
          "DELIVERY_UNAVAILABLE",
          "El envío de mensajes de contacto no está disponible",
          503,
        );
      }
      const body = await readJson(request);
      const { messageId } = await deps.contact.submit(body);
      return Response.json({ ok: true, messageId }, { status: 200, headers: NO_STORE });
    } catch (err) {
      if (err instanceof ContactError) {
        const extra = err.issues.length > 0 ? { issues: err.issues } : {};
        return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code], extra);
      }
      if (err instanceof BadJsonError) return errorResponse("BAD_REQUEST", err.message, 400);
      throw err;
    }
  };
}
