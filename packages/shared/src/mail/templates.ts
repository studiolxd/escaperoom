import { DEFAULT_LOCALE, LOCALES, type Locale } from "@escaperoom/config/locales";

/**
 * Plantillas de los emails de invitación (ticket 5.6, specs/02 §4.4) en los seis
 * idiomas del proyecto (ADR-018). Tres tipos:
 *
 * - `invitation`: invitación individual con su clave.
 * - `bulk`: la misma clave personal, dentro de un envío masivo del organizador.
 * - `reminder`: recordatorio (reenvío a quien aún no confirmó o pidió la clave otra vez).
 *
 * Si el evento exige confirmación, el email lleva el enlace firmado. Minimización
 * (specs/18 §3–§4): el cuerpo solo contiene el título del evento/sala, la clave
 * y, si procede, el enlace; ni nombre del destinatario ni píxeles de
 * seguimiento ni enlaces de terceros.
 */

export const INVITATION_EMAIL_KINDS = ["invitation", "bulk", "reminder"] as const;
export type InvitationEmailKind = (typeof INVITATION_EMAIL_KINDS)[number];

export type InvitationEmailData = {
  kind: InvitationEmailKind;
  locale: Locale;
  eventTitle: string;
  roomTitle: string;
  /** Clave en claro `XXXX-XXXX-XXXX`: el email es la vía por la que llega al asistente. */
  code: string;
  /** Enlace firmado de confirmación; `null` si el evento no la exige. */
  confirmUrl: string | null;
  /** Caducidad de la clave (`hours_after_start`); `null` si no tiene. */
  expiresAt: Date | null;
};

export type RenderedEmail = { subject: string; text: string; html: string };

type Copy = {
  subject: Record<InvitationEmailKind, string>;
  /** Línea de apertura por tipo. */
  intro: Record<InvitationEmailKind, string>;
  keyLabel: string;
  keyHint: string;
  confirmPrompt: string;
  confirmCta: string;
  expires: string;
  footer: string;
};

/** `{event}`, `{room}` y `{date}` se sustituyen al renderizar. */
const COPY: Record<Locale, Copy> = {
  es: {
    subject: {
      invitation: "Invitación a {event}",
      bulk: "Tu clave para {event}",
      reminder: "Recordatorio: tu invitación a {event}",
    },
    intro: {
      invitation: "Has sido invitado a «{room}» en el evento «{event}».",
      bulk: "El organizador de «{event}» ha invitado a tu grupo a jugar «{room}». Esta es tu clave personal.",
      reminder: "Te recordamos tu invitación a «{room}» en el evento «{event}».",
    },
    keyLabel: "Tu clave",
    keyHint: "Guárdala: la necesitarás el día del evento para entrar en la partida.",
    confirmPrompt: "El organizador pide que confirmes tu asistencia.",
    confirmCta: "Confirmar asistencia",
    expires: "La clave caduca el {date}.",
    footer:
      "Recibes este correo porque el organizador del evento te ha invitado. Si no esperabas esta invitación, puedes ignorarlo.",
  },
  en: {
    subject: {
      invitation: "Invitation to {event}",
      bulk: "Your key for {event}",
      reminder: "Reminder: your invitation to {event}",
    },
    intro: {
      invitation: "You have been invited to “{room}” at the event “{event}”.",
      bulk: "The organizer of “{event}” has invited your group to play “{room}”. This is your personal key.",
      reminder: "A reminder of your invitation to “{room}” at the event “{event}”.",
    },
    keyLabel: "Your key",
    keyHint: "Keep it safe: you will need it on the day of the event to join the game.",
    confirmPrompt: "The organizer asks you to confirm your attendance.",
    confirmCta: "Confirm attendance",
    expires: "The key expires on {date}.",
    footer:
      "You are receiving this email because the event organizer invited you. If you were not expecting this invitation, you can ignore it.",
  },
  fr: {
    subject: {
      invitation: "Invitation à {event}",
      bulk: "Votre clé pour {event}",
      reminder: "Rappel : votre invitation à {event}",
    },
    intro: {
      invitation: "Vous êtes invité(e) à « {room} » lors de l’événement « {event} ».",
      bulk: "L’organisateur de « {event} » a invité votre groupe à jouer à « {room} ». Voici votre clé personnelle.",
      reminder:
        "Nous vous rappelons votre invitation à « {room} » lors de l’événement « {event} ».",
    },
    keyLabel: "Votre clé",
    keyHint: "Conservez-la : vous en aurez besoin le jour de l’événement pour rejoindre la partie.",
    confirmPrompt: "L’organisateur vous demande de confirmer votre présence.",
    confirmCta: "Confirmer ma présence",
    expires: "La clé expire le {date}.",
    footer:
      "Vous recevez cet e-mail car l’organisateur de l’événement vous a invité(e). Si vous n’attendiez pas cette invitation, vous pouvez l’ignorer.",
  },
  de: {
    subject: {
      invitation: "Einladung zu {event}",
      bulk: "Dein Schlüssel für {event}",
      reminder: "Erinnerung: deine Einladung zu {event}",
    },
    intro: {
      invitation: "Du wurdest zu „{room}“ beim Event „{event}“ eingeladen.",
      bulk: "Die Organisation von „{event}“ hat deine Gruppe eingeladen, „{room}“ zu spielen. Das ist dein persönlicher Schlüssel.",
      reminder: "Wir erinnern dich an deine Einladung zu „{room}“ beim Event „{event}“.",
    },
    keyLabel: "Dein Schlüssel",
    keyHint: "Bewahre ihn gut auf: Du brauchst ihn am Tag des Events, um dem Spiel beizutreten.",
    confirmPrompt: "Die Organisation bittet dich, deine Teilnahme zu bestätigen.",
    confirmCta: "Teilnahme bestätigen",
    expires: "Der Schlüssel läuft am {date} ab.",
    footer:
      "Du erhältst diese E-Mail, weil dich die Organisation des Events eingeladen hat. Wenn du diese Einladung nicht erwartet hast, kannst du sie ignorieren.",
  },
  nl: {
    subject: {
      invitation: "Uitnodiging voor {event}",
      bulk: "Je sleutel voor {event}",
      reminder: "Herinnering: je uitnodiging voor {event}",
    },
    intro: {
      invitation: "Je bent uitgenodigd voor ‘{room}’ tijdens het evenement ‘{event}’.",
      bulk: "De organisator van ‘{event}’ heeft je groep uitgenodigd om ‘{room}’ te spelen. Dit is je persoonlijke sleutel.",
      reminder:
        "We herinneren je aan je uitnodiging voor ‘{room}’ tijdens het evenement ‘{event}’.",
    },
    keyLabel: "Je sleutel",
    keyHint: "Bewaar hem goed: je hebt hem op de dag van het evenement nodig om mee te spelen.",
    confirmPrompt: "De organisator vraagt je je aanwezigheid te bevestigen.",
    confirmCta: "Aanwezigheid bevestigen",
    expires: "De sleutel verloopt op {date}.",
    footer:
      "Je ontvangt deze e-mail omdat de organisator van het evenement je heeft uitgenodigd. Verwachtte je deze uitnodiging niet, dan kun je hem negeren.",
  },
  pt: {
    subject: {
      invitation: "Convite para {event}",
      bulk: "A tua chave para {event}",
      reminder: "Lembrete: o teu convite para {event}",
    },
    intro: {
      invitation: "Foste convidado para «{room}» no evento «{event}».",
      bulk: "O organizador de «{event}» convidou o teu grupo para jogar «{room}». Esta é a tua chave pessoal.",
      reminder: "Lembramos-te do teu convite para «{room}» no evento «{event}».",
    },
    keyLabel: "A tua chave",
    keyHint: "Guarda-a: vais precisar dela no dia do evento para entrar no jogo.",
    confirmPrompt: "O organizador pede-te que confirmes a tua presença.",
    confirmCta: "Confirmar presença",
    expires: "A chave expira a {date}.",
    footer:
      "Recebes este e-mail porque o organizador do evento te convidou. Se não estavas à espera deste convite, podes ignorá-lo.",
  },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Idioma soportado o el por defecto (`es`). */
export function resolveMailLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Los títulos van al asunto: sin saltos de línea (inyección de cabeceras) y acotados. */
function oneLine(value: string, max = 120): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatDate(date: Date, locale: Locale): string {
  // La zona del evento no se conoce: se muestra en UTC y se dice.
  return `${new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

/** Renderiza asunto, texto plano y HTML de un email de invitación. */
export function renderInvitationEmail(data: InvitationEmailData): RenderedEmail {
  const copy = COPY[data.locale] ?? COPY[DEFAULT_LOCALE];
  const vars = {
    event: oneLine(data.eventTitle),
    room: oneLine(data.roomTitle),
    date: data.expiresAt ? formatDate(data.expiresAt, data.locale) : "",
  };
  const subject = fill(copy.subject[data.kind], vars);
  const intro = fill(copy.intro[data.kind], vars);
  const expires = data.expiresAt ? fill(copy.expires, vars) : null;

  const text = [
    intro,
    "",
    `${copy.keyLabel}: ${data.code}`,
    copy.keyHint,
    ...(expires ? [expires] : []),
    ...(data.confirmUrl ? ["", copy.confirmPrompt, `${copy.confirmCta}: ${data.confirmUrl}`] : []),
    "",
    "—",
    copy.footer,
  ].join("\n");

  const h = (v: string) => escapeHtml(v);
  const html = `<!doctype html>
<html lang="${data.locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${h(intro)}</p>
<p style="margin:0 0 4px;font-size:13px;color:#52525b">${h(copy.keyLabel)}</p>
<p style="margin:0 0 12px;font-size:26px;font-weight:bold;letter-spacing:2px;font-family:'Courier New',monospace">${h(data.code)}</p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5">${h(copy.keyHint)}</p>
${expires ? `<p style="margin:0 0 8px;font-size:14px;color:#52525b">${h(expires)}</p>\n` : ""}${
    data.confirmUrl
      ? `<p style="margin:16px 0 12px;font-size:14px">${h(copy.confirmPrompt)}</p>
<p style="margin:0 0 16px"><a href="${h(data.confirmUrl)}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">${h(copy.confirmCta)}</a></p>
`
      : ""
  }<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#71717a">${h(copy.footer)}</p>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
