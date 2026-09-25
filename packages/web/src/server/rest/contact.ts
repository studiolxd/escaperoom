import { ContactError, type ContactErrorCode, type ContactService } from "@escaperoom/shared/services";
import { errorResponse, handleDomainErrors, NO_STORE, readJson } from "./_http";

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

const handle = handleDomainErrors(ContactError, STATUS_BY_CODE);

/**
 * Handler REST del formulario de contacto público. Adaptador fino sobre
 * `ContactService`: la validación y el envío viven en el servicio.
 */
export function createContactHandler(deps: ContactHandlerDeps) {
  return async function postContact(request: Request): Promise<Response> {
    return handle(async () => {
      if (!deps.contact) {
        return errorResponse(
          "DELIVERY_UNAVAILABLE",
          "El envío de mensajes de contacto no está disponible",
          503,
        );
      }
      const body = await readJson(request, { allowEmpty: true });
      const { messageId } = await deps.contact.submit(body);
      return Response.json({ ok: true, messageId }, { status: 200, headers: NO_STORE });
    });
  };
}
