import { DEFAULT_LOCALE, type Locale } from "@escaperoom/config/locales";
import { resolveMailLocale } from "./templates";
import type { MailTransport } from "./transport";

/**
 * Email del enlace mágico (A-1): único login de la app además de Google, así
 * que sin este envío nadie puede entrar. Antes se imprimía la URL de sesión
 * de un solo uso en stdout en vez de enviarla — cualquiera con acceso a los
 * logs podía iniciar sesión como ese email. Ahora se envía con el transporte
 * existente (`createMailTransportFromEnv`, el mismo que `getContactService`)
 * y la URL nunca se loguea.
 */

type MagicLinkCopy = {
  subject: string;
  intro: string;
  cta: string;
  ignore: string;
};

const COPY: Record<Locale, MagicLinkCopy> = {
  es: {
    subject: "Tu enlace de acceso",
    intro: "Usa este enlace para entrar en tu cuenta. Caduca en unos minutos.",
    cta: "Entrar",
    ignore: "Si no has pedido este enlace, puedes ignorar este correo.",
  },
  en: {
    subject: "Your sign-in link",
    intro: "Use this link to sign in to your account. It expires in a few minutes.",
    cta: "Sign in",
    ignore: "If you did not request this link, you can ignore this email.",
  },
  fr: {
    subject: "Votre lien de connexion",
    intro: "Utilisez ce lien pour vous connecter à votre compte. Il expire dans quelques minutes.",
    cta: "Se connecter",
    ignore: "Si vous n’avez pas demandé ce lien, vous pouvez ignorer cet e-mail.",
  },
  de: {
    subject: "Dein Anmeldelink",
    intro: "Nutze diesen Link, um dich anzumelden. Er läuft in wenigen Minuten ab.",
    cta: "Anmelden",
    ignore: "Wenn du diesen Link nicht angefordert hast, kannst du diese E-Mail ignorieren.",
  },
  nl: {
    subject: "Je inloglink",
    intro: "Gebruik deze link om in te loggen. Hij verloopt over een paar minuten.",
    cta: "Inloggen",
    ignore: "Heb je deze link niet aangevraagd? Dan kun je deze e-mail negeren.",
  },
  pt: {
    subject: "O teu link de acesso",
    intro: "Usa este link para entrares na tua conta. Expira dentro de minutos.",
    cta: "Entrar",
    ignore: "Se não pediste este link, podes ignorar este email.",
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type RenderedMagicLinkEmail = { subject: string; text: string; html: string };

/** Renderiza asunto, texto plano y HTML del email del enlace mágico. */
export function renderMagicLinkEmail(locale: Locale, url: string): RenderedMagicLinkEmail {
  const copy = COPY[locale] ?? COPY[DEFAULT_LOCALE];
  const text = [copy.intro, "", `${copy.cta}: ${url}`, "", "—", copy.ignore].join("\n");
  const h = (v: string) => escapeHtml(v);
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(copy.subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${h(copy.intro)}</p>
<p style="margin:0 0 16px"><a href="${h(url)}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">${h(copy.cta)}</a></p>
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#71717a">${h(copy.ignore)}</p>
</td></tr>
</table>
</body>
</html>`;
  return { subject: copy.subject, text, html };
}

export type MagicLinkMailParams = { email: string; url: string; locale?: unknown };

/**
 * Envía el email del enlace mágico. Sin transporte configurado lanza (en vez
 * de fingir un envío que nunca llegó, como hacía el `console.info` original):
 * Better Auth propaga el error y el login responde con fallo en vez de un
 * falso "enlace enviado".
 */
export async function sendMagicLinkEmail(
  deps: { transport: MailTransport | null },
  params: MagicLinkMailParams,
): Promise<void> {
  if (!deps.transport) {
    throw new Error("Magic link: transporte de email no configurado");
  }
  const rendered = renderMagicLinkEmail(resolveMailLocale(params.locale), params.url);
  await deps.transport.send({ to: params.email, ...rendered });
}
