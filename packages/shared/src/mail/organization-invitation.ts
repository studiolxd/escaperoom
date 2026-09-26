import { DEFAULT_LOCALE, type Locale } from "@escaperoom/config/locales";
import { resolveMailLocale } from "./templates";
import type { MailTransport } from "./transport";

/**
 * Email de invitación a una organización (A-8): el plugin `organization()` de
 * Better Auth (`lib/auth.ts`) crea la invitación en base de datos pero, sin
 * `sendInvitationEmail`, nunca avisaba a la persona invitada. Mismo transporte
 * y patrón visual que `mail/magic-link.ts` (A-1).
 */

type OrganizationInvitationCopy = {
  subject: (organizationName: string) => string;
  intro: (organizationName: string, inviterEmail: string) => string;
  cta: string;
  expires: string;
  ignore: string;
};

const COPY: Record<Locale, OrganizationInvitationCopy> = {
  es: {
    subject: (org) => `Invitación a unirte a ${org}`,
    intro: (org, inviter) => `${inviter} te ha invitado a unirte a "${org}" en Escaperoom.`,
    cta: "Ver invitación",
    expires: "Este enlace caduca en unos días.",
    ignore: "Si no esperabas esta invitación, puedes ignorar este correo.",
  },
  en: {
    subject: (org) => `Invitation to join ${org}`,
    intro: (org, inviter) => `${inviter} invited you to join "${org}" on Escaperoom.`,
    cta: "View invitation",
    expires: "This link expires in a few days.",
    ignore: "If you weren't expecting this invitation, you can ignore this email.",
  },
  fr: {
    subject: (org) => `Invitation à rejoindre ${org}`,
    intro: (org, inviter) => `${inviter} vous a invité à rejoindre « ${org} » sur Escaperoom.`,
    cta: "Voir l'invitation",
    expires: "Ce lien expire dans quelques jours.",
    ignore: "Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.",
  },
  de: {
    subject: (org) => `Einladung, ${org} beizutreten`,
    intro: (org, inviter) => `${inviter} hat dich eingeladen, "${org}" auf Escaperoom beizutreten.`,
    cta: "Einladung ansehen",
    expires: "Dieser Link läuft in wenigen Tagen ab.",
    ignore: "Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.",
  },
  nl: {
    subject: (org) => `Uitnodiging om lid te worden van ${org}`,
    intro: (org, inviter) => `${inviter} heeft je uitgenodigd om lid te worden van "${org}" op Escaperoom.`,
    cta: "Uitnodiging bekijken",
    expires: "Deze link verloopt over een paar dagen.",
    ignore: "Verwachtte je deze uitnodiging niet? Dan kun je deze e-mail negeren.",
  },
  pt: {
    subject: (org) => `Convite para te juntares a ${org}`,
    intro: (org, inviter) => `${inviter} convidou-te para te juntares a "${org}" no Escaperoom.`,
    cta: "Ver convite",
    expires: "Este link expira dentro de alguns dias.",
    ignore: "Se não esperavas este convite, podes ignorar este email.",
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

export type RenderedOrganizationInvitationEmail = { subject: string; text: string; html: string };

/** Renderiza asunto, texto plano y HTML del email de invitación a organización. */
export function renderOrganizationInvitationEmail(
  locale: Locale,
  params: { url: string; organizationName: string; inviterEmail: string },
): RenderedOrganizationInvitationEmail {
  const copy = COPY[locale] ?? COPY[DEFAULT_LOCALE];
  const subject = copy.subject(params.organizationName);
  const intro = copy.intro(params.organizationName, params.inviterEmail);
  const text = [intro, "", `${copy.cta}: ${params.url}`, "", copy.expires, "", "—", copy.ignore].join(
    "\n",
  );
  const h = (v: string) => escapeHtml(v);
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${h(intro)}</p>
<p style="margin:0 0 16px"><a href="${h(params.url)}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">${h(copy.cta)}</a></p>
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#71717a">${h(copy.expires)}</p>
<p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:#71717a">${h(copy.ignore)}</p>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}

export type OrganizationInvitationMailParams = {
  email: string;
  url: string;
  organizationName: string;
  inviterEmail: string;
  locale?: unknown;
};

/**
 * Envía el email de invitación a organización. Sin transporte configurado
 * lanza, igual que `sendMagicLinkEmail` (A-1): mejor un fallo visible que una
 * invitación que se crea en base de datos y nunca llega a nadie.
 */
export async function sendOrganizationInvitationEmail(
  deps: { transport: MailTransport | null },
  params: OrganizationInvitationMailParams,
): Promise<void> {
  if (!deps.transport) {
    throw new Error("Invitación de organización: transporte de email no configurado");
  }
  const rendered = renderOrganizationInvitationEmail(resolveMailLocale(params.locale), {
    url: params.url,
    organizationName: params.organizationName,
    inviterEmail: params.inviterEmail,
  });
  await deps.transport.send({ to: params.email, ...rendered });
}
