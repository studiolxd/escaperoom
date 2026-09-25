"use server";

import { ContactError, type ContactMessageInput } from "@escaperoom/shared/services";
import { getContactService } from "@/server/services";
import {
  actionError,
  actionOk,
  consumeActionRateLimit,
  rateLimitedActionError,
  type ActionResult,
} from "@/server/actions/action-result";

export type ContactActionData = { messageId: string };

/**
 * Server action del formulario de contacto público (`ContactForm`): mismo
 * `ContactService` que `POST /api/contact` (`server/rest/contact.ts`), que
 * sigue existiendo para el resto de clientes. La validación Zod
 * (`ContactMessageInput`) vive en el servicio, compartida con el
 * `zodResolver` del formulario.
 */
export async function sendContactMessage(
  input: ContactMessageInput,
): Promise<ActionResult<ContactActionData>> {
  const rateLimit = await consumeActionRateLimit("contact-write");
  if (!rateLimit.ok) return rateLimitedActionError();

  const contact = getContactService();
  if (!contact) {
    return actionError("DELIVERY_UNAVAILABLE", "El envío de mensajes de contacto no está disponible");
  }

  try {
    const { messageId } = await contact.submit(input);
    return actionOk({ messageId });
  } catch (err) {
    if (err instanceof ContactError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}
