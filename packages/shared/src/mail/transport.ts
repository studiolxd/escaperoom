import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { isDevFallbackAllowed } from "@escaperoom/env";

/**
 * Transporte de email (ticket 5.6, ADR-020): **Nodemailer (SMTP) por defecto** y
 * **Resend** opcional detrás de la misma interfaz. Es el equivalente propio del
 * patrón de `@slxd/mailer` (un transporte, dos proveedores), que no está en
 * este monorepo. El proveedor se elige por entorno (`EMAIL_PROVIDER`), sin
 * tocar código.
 *
 * Los tests nunca envían correo real: usan `createMemoryMailTransport` o el
 * `jsonTransport` de Nodemailer (serializa el mensaje en vez de enviarlo).
 */

/** Mensaje ya renderizado (asunto + texto plano + HTML). */
export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Cabeceras extra (p. ej. `X-Entity-Ref-ID` para que el cliente no agrupe hilos). */
  headers?: Record<string, string>;
};

export type MailSendResult = { messageId: string };

/** Remitente común a todos los proveedores. */
export type MailSender = { from: string; fromName: string; replyTo?: string | undefined };

export interface MailTransport {
  readonly provider: "nodemailer" | "resend" | "memory";
  /** Envía o lanza: el job del worker propaga el error para que BullMQ reintente. */
  send(message: MailMessage): Promise<MailSendResult>;
}

/** Fallo de entrega del proveedor (red, 4xx/5xx de la API, SMTP rechazado). */
export class MailDeliveryError extends Error {
  readonly provider: string;
  readonly status: number | null;
  constructor(provider: string, message: string, status: number | null = null) {
    super(message);
    this.name = "MailDeliveryError";
    this.provider = provider;
    this.status = status;
  }
}

function formatFrom(sender: MailSender): string {
  // Comillas para que un nombre con comas o `<` no rompa la cabecera.
  const name = sender.fromName.replace(/["\\\r\n]/g, "");
  return `"${name}" <${sender.from}>`;
}

// ── Nodemailer (SMTP por defecto) ──────────────────────────────────────────

export type NodemailerTransportOptions =
  | SMTPTransport.Options
  /** Serializa el mensaje en JSON sin enviarlo (tests y desarrollo sin SMTP). */
  | { jsonTransport: true };

export function createNodemailerTransport(opts: {
  sender: MailSender;
  options: NodemailerTransportOptions;
}): MailTransport & { readonly transporter: Transporter } {
  const transporter = nodemailer.createTransport(opts.options as SMTPTransport.Options);
  return {
    provider: "nodemailer",
    transporter,
    async send(message) {
      try {
        const info = await transporter.sendMail({
          from: formatFrom(opts.sender),
          to: message.to,
          ...(opts.sender.replyTo ? { replyTo: opts.sender.replyTo } : {}),
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.headers ? { headers: message.headers } : {}),
        });
        return { messageId: String(info.messageId) };
      } catch (err) {
        const status = (err as { responseCode?: unknown }).responseCode;
        throw new MailDeliveryError(
          "nodemailer",
          err instanceof Error ? err.message : "Fallo SMTP",
          typeof status === "number" ? status : null,
        );
      }
    },
  };
}

// ── Resend (opcional) ──────────────────────────────────────────────────────

export const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Resend por su API HTTP (sin SDK: un `fetch` inyectable basta y los tests lo
 * sustituyen). Cualquier respuesta no 2xx es un `MailDeliveryError`.
 */
export function createResendTransport(opts: {
  sender: MailSender;
  apiKey: string;
  fetch?: typeof fetch;
  endpoint?: string;
}): MailTransport {
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    provider: "resend",
    async send(message) {
      let response: Response;
      try {
        response = await doFetch(opts.endpoint ?? RESEND_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: formatFrom(opts.sender),
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(opts.sender.replyTo ? { reply_to: opts.sender.replyTo } : {}),
            ...(message.headers ? { headers: message.headers } : {}),
          }),
        });
      } catch (err) {
        throw new MailDeliveryError("resend", err instanceof Error ? err.message : "Fallo de red");
      }
      if (!response.ok) {
        throw new MailDeliveryError(
          "resend",
          `Resend respondió ${response.status}`,
          response.status,
        );
      }
      const body = (await response.json().catch(() => ({}))) as { id?: unknown };
      return { messageId: typeof body.id === "string" ? body.id : "" };
    },
  };
}

// ── Memoria (tests) ────────────────────────────────────────────────────────

/**
 * Transporte de tests: guarda cada mensaje en `sent`. `failNext(n)` hace que
 * los `n` siguientes envíos fallen (simula una caída del proveedor).
 */
export function createMemoryMailTransport(): MailTransport & {
  sent: MailMessage[];
  failNext(times?: number): void;
} {
  const sent: MailMessage[] = [];
  let failures = 0;
  return {
    provider: "memory",
    sent,
    failNext(times = 1) {
      failures += times;
    },
    async send(message) {
      if (failures > 0) {
        failures--;
        throw new MailDeliveryError("memory", "Fallo simulado del transporte");
      }
      sent.push(structuredClone(message));
      return { messageId: `memory-${sent.length}` };
    },
  };
}

// ── Configuración por entorno ──────────────────────────────────────────────

export type MailEnv = Record<string, string | undefined>;

/** Remitente de desarrollo cuando falta `EMAIL_FROM` fuera de producción. */
export const DEV_EMAIL_FROM = "no-reply@escaperoom.local";

/**
 * Transporte según `EMAIL_PROVIDER` (`nodemailer` por defecto, `resend`).
 *
 * - `nodemailer` con `SMTP_HOST` → SMTP real (Mailpit/MailHog en local).
 * - `nodemailer` sin `SMTP_HOST` fuera de producción → `jsonTransport`: el
 *   worker "envía" sin salir de la máquina.
 * - `resend` exige `RESEND_API_KEY`.
 *
 * `null` = email desactivado (configuración incompleta en producción); quien
 * lo llama decide no arrancar el worker de envíos.
 */
export function createMailTransportFromEnv(env: MailEnv = process.env): MailTransport | null {
  const allowDevFallback = isDevFallbackAllowed(env);
  const from = env.EMAIL_FROM?.trim() || (allowDevFallback ? DEV_EMAIL_FROM : undefined);
  if (!from) return null;
  const sender: MailSender = {
    from,
    fromName: env.EMAIL_FROM_NAME?.trim() || env.APP_NAME?.trim() || "EscapeRoom",
    replyTo: env.EMAIL_REPLY_TO?.trim() || undefined,
  };
  const provider = env.EMAIL_PROVIDER?.trim() || "nodemailer";

  if (provider === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    return apiKey ? createResendTransport({ sender, apiKey }) : null;
  }
  if (provider !== "nodemailer") return null;

  const host = env.SMTP_HOST?.trim();
  if (!host) {
    return allowDevFallback
      ? createNodemailerTransport({ sender, options: { jsonTransport: true } })
      : null;
  }
  const port = Number.parseInt(env.SMTP_PORT ?? "", 10);
  const secure = env.SMTP_SECURE === "true" || env.SMTP_SECURE === "1";
  const user = env.SMTP_USER?.trim();
  return createNodemailerTransport({
    sender,
    options: {
      host,
      port: Number.isInteger(port) && port > 0 ? port : secure ? 465 : 587,
      secure,
      ...(user ? { auth: { user, pass: env.SMTP_PASS ?? "" } } : {}),
    },
  });
}
