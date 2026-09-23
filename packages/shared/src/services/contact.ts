import { z } from "zod";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import type { MailTransport } from "../mail/transport";

/**
 * Contacto público (`/contact`): entrega el mensaje del formulario por email al
 * buzón de la empresa (`CONTACT_TO_EMAIL`, por defecto `hello@studiolxd.com`).
 *
 * A diferencia de las invitaciones (5.6), aquí no hay fila en Postgres que
 * releer al enviar ni varios destinatarios: es un envío único y síncrono
 * dentro de la propia petición REST, sobre el mismo `MailTransport` (Nodemailer
 * por defecto, Resend opcional). `Reply-To` lleva el email de quien escribe,
 * para poder responderle directo desde el cliente de correo.
 */

export const ContactMessageInput = z
  .object({
    name: z.string().trim().min(1, "El nombre es obligatorio").max(200),
    email: z
      .string()
      .trim()
      .min(1, "El email es obligatorio")
      .max(320)
      .pipe(z.email("Email no válido")),
    message: z.string().trim().min(1, "El mensaje es obligatorio").max(5000),
  })
  .strict();

export type ContactMessageInput = z.infer<typeof ContactMessageInput>;

export type ContactErrorCode = "VALIDATION_ERROR" | "DELIVERY_UNAVAILABLE" | "DELIVERY_FAILED";

/** Error de dominio del contacto; el adaptador REST lo traduce a HTTP. */
export class ContactError extends Error {
  readonly code: ContactErrorCode;
  readonly issues: ReadableIssue[];
  constructor(code: ContactErrorCode, message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "ContactError";
    this.code = code;
    this.issues = issues;
  }
}

export type ContactSendResult = { messageId: string };

export interface ContactService {
  submit(input: unknown): Promise<ContactSendResult>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** El nombre va al asunto: sin saltos de línea (inyección de cabeceras) y acotado. */
function oneLine(value: string, max = 120): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function renderContactEmail(data: { name: string; email: string; message: string }) {
  const name = oneLine(data.name);
  const subject = oneLine(`Contacto: ${name}`);
  const text = [
    `Nombre: ${name}`,
    `Email: ${data.email}`,
    "",
    "Mensaje:",
    data.message,
  ].join("\n");
  const h = (v: string) => escapeHtml(v);
  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#52525b">Nombre</p>
<p style="margin:0 0 16px;font-size:15px">${h(name)}</p>
<p style="margin:0 0 4px;font-size:13px;color:#52525b">Email</p>
<p style="margin:0 0 16px;font-size:15px">${h(data.email)}</p>
<p style="margin:0 0 4px;font-size:13px;color:#52525b">Mensaje</p>
<p style="margin:0;font-size:15px;line-height:1.5;white-space:pre-wrap">${h(data.message)}</p>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}

export function createContactService(deps: { transport: MailTransport; to: string }): ContactService {
  return {
    async submit(raw) {
      const parsed = ContactMessageInput.safeParse(raw);
      if (!parsed.success) {
        throw new ContactError(
          "VALIDATION_ERROR",
          "Datos de contacto no válidos",
          toReadableIssues(parsed.error),
        );
      }
      const { name, email, message } = parsed.data;
      const rendered = renderContactEmail({ name, email, message });
      try {
        const { messageId } = await deps.transport.send({
          to: deps.to,
          ...rendered,
          headers: { "Reply-To": email },
        });
        return { messageId };
      } catch (err) {
        throw new ContactError(
          "DELIVERY_FAILED",
          err instanceof Error ? err.message : "Fallo al enviar el email de contacto",
        );
      }
    },
  };
}
