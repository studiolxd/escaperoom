import { DEFAULT_LOCALE, type Locale } from "@escaperoom/config/locales";
import type { RenderedEmail } from "./templates";
import { resolveMailLocale } from "./templates";

/**
 * Plantilla del email de confirmación de compra (specs/18 §3-4), en los seis
 * idiomas del proyecto (ADR-018). Cubre los tres `purchaseType` de Stripe
 * (ticket 5.1/5.4/5.10): venta individual de sala (`room`), licencia entre
 * creadores (`room_license`) y aforo de evento (`event_credits`).
 *
 * Dos huecos legales que el recibo automático de Stripe (si está activado) no
 * cubre, porque solo confirma el cargo, no el contrato:
 *
 * - Art. 27 LSSI: confirmar por escrito qué se ha contratado (no solo que se
 *   ha cobrado una tarjeta).
 * - Art. 97.7/103.m) del texto refundido de la LGDCU (Real Decreto
 *   Legislativo 1/2007): la renuncia al derecho de desistimiento sobre
 *   contenido digital de ejecución inmediata (ya aceptada al comprar, ver
 *   `packages/web/src/content/legal/terms.ts` §4) debe quedar confirmada en
 *   un soporte duradero. Este email es ese soporte.
 */

export const PURCHASE_CONFIRMATION_KINDS = ["room", "room_license", "event_credits"] as const;
export type PurchaseConfirmationKind = (typeof PURCHASE_CONFIRMATION_KINDS)[number];

export type PurchaseConfirmationEmailData = {
  locale: Locale;
  kind: PurchaseConfirmationKind;
  /** Título de la sala (`room`/`room_license`) o del evento (`event_credits`). */
  itemTitle: string;
  amountCents: number;
  currency: string;
  /** Aforo comprado; solo se muestra en `event_credits`. */
  players: number | null;
  /** Enlace a los Términos de Servicio (`/{locale}/legal/terms`). */
  termsUrl: string;
};

type Copy = {
  subject: Record<PurchaseConfirmationKind, string>;
  intro: Record<PurchaseConfirmationKind, string>;
  itemLabel: Record<PurchaseConfirmationKind, string>;
  amountLabel: string;
  playersLabel: string;
  waiver: Record<PurchaseConfirmationKind, string>;
  termsIntro: string;
  termsCta: string;
  footer: string;
};

/** `{item}` se sustituye al renderizar. */
const COPY: Record<Locale, Copy> = {
  es: {
    subject: {
      room: "Confirmación de tu compra: {item}",
      room_license: "Confirmación de tu licencia: {item}",
      event_credits: "Confirmación de tu compra: aforo de «{item}»",
    },
    intro: {
      room: "Gracias por tu compra. Confirmamos por escrito el contrato de la sala que acabas de adquirir.",
      room_license:
        "Gracias por tu compra. Confirmamos por escrito el contrato de la licencia que acabas de adquirir.",
      event_credits:
        "Gracias por tu compra. Confirmamos por escrito el contrato del aforo de evento que acabas de adquirir.",
    },
    itemLabel: {
      room: "Sala",
      room_license: "Licencia de sala",
      event_credits: "Evento",
    },
    amountLabel: "Importe cobrado",
    playersLabel: "Aforo comprado",
    waiver: {
      room:
        "Al completar esta compra aceptaste expresamente que el acceso a esta sala, contenido digital, comenzara de inmediato, y con ello confirmaste la renuncia a tu derecho de desistimiento sobre ella, conforme al artículo 103.m) del Real Decreto Legislativo 1/2007, de 16 de noviembre, por el que se aprueba el texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios.",
      room_license:
        "Al completar esta compra aceptaste expresamente que el acceso a esta licencia, contenido digital, comenzara de inmediato, y con ello confirmaste la renuncia a tu derecho de desistimiento sobre ella, conforme al artículo 103.m) del Real Decreto Legislativo 1/2007, de 16 de noviembre, por el que se aprueba el texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios.",
      event_credits:
        "Al completar esta compra aceptaste expresamente que el aforo de tu evento quedara confirmado de inmediato, y con ello confirmaste la renuncia a tu derecho de desistimiento sobre él, conforme al artículo 103.m) del Real Decreto Legislativo 1/2007, de 16 de noviembre, por el que se aprueba el texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios.",
    },
    termsIntro: "Puedes consultar los Términos de Servicio completos aquí:",
    termsCta: "Ver Términos de Servicio",
    footer:
      "Recibes este correo porque acabas de completar una compra en la plataforma. Consérvalo: es la confirmación de tu contrato.",
  },
  en: {
    subject: {
      room: "Confirmation of your purchase: {item}",
      room_license: "Confirmation of your license: {item}",
      event_credits: "Confirmation of your purchase: capacity for “{item}”",
    },
    intro: {
      room: "Thank you for your purchase. This confirms in writing the contract for the room you just bought.",
      room_license:
        "Thank you for your purchase. This confirms in writing the contract for the license you just bought.",
      event_credits:
        "Thank you for your purchase. This confirms in writing the contract for the event capacity you just bought.",
    },
    itemLabel: {
      room: "Room",
      room_license: "Room license",
      event_credits: "Event",
    },
    amountLabel: "Amount charged",
    playersLabel: "Capacity purchased",
    waiver: {
      room:
        "By completing this purchase you expressly agreed that access to this room, digital content, would begin immediately, thereby confirming your waiver of the right of withdrawal over it, under article 103.m) of Royal Legislative Decree 1/2007, of 16 November, approving the recast text of the General Law for the Defence of Consumers and Users.",
      room_license:
        "By completing this purchase you expressly agreed that access to this license, digital content, would begin immediately, thereby confirming your waiver of the right of withdrawal over it, under article 103.m) of Royal Legislative Decree 1/2007, of 16 November, approving the recast text of the General Law for the Defence of Consumers and Users.",
      event_credits:
        "By completing this purchase you expressly agreed that your event's capacity would be confirmed immediately, thereby confirming your waiver of the right of withdrawal over it, under article 103.m) of Royal Legislative Decree 1/2007, of 16 November, approving the recast text of the General Law for the Defence of Consumers and Users.",
    },
    termsIntro: "You can read the full Terms of Service here:",
    termsCta: "View Terms of Service",
    footer:
      "You are receiving this email because you just completed a purchase on the platform. Keep it: it is the confirmation of your contract.",
  },
  fr: {
    subject: {
      room: "Confirmation de votre achat : {item}",
      room_license: "Confirmation de votre licence : {item}",
      event_credits: "Confirmation de votre achat : places pour « {item} »",
    },
    intro: {
      room: "Merci pour votre achat. Nous confirmons par écrit le contrat de la salle que vous venez d’acquérir.",
      room_license:
        "Merci pour votre achat. Nous confirmons par écrit le contrat de la licence que vous venez d’acquérir.",
      event_credits:
        "Merci pour votre achat. Nous confirmons par écrit le contrat des places d’événement que vous venez d’acquérir.",
    },
    itemLabel: {
      room: "Salle",
      room_license: "Licence de salle",
      event_credits: "Événement",
    },
    amountLabel: "Montant facturé",
    playersLabel: "Places achetées",
    waiver: {
      room:
        "En finalisant cet achat, vous avez expressément accepté que l’accès à cette salle, contenu numérique, commence immédiatement, confirmant ainsi la renonciation à votre droit de rétractation sur celle-ci, conformément à l’article 103.m) du décret-loi royal 1/2007 du 16 novembre portant approbation du texte refondu de la loi générale pour la défense des consommateurs et des usagers.",
      room_license:
        "En finalisant cet achat, vous avez expressément accepté que l’accès à cette licence, contenu numérique, commence immédiatement, confirmant ainsi la renonciation à votre droit de rétractation sur celle-ci, conformément à l’article 103.m) du décret-loi royal 1/2007 du 16 novembre portant approbation du texte refondu de la loi générale pour la défense des consommateurs et des usagers.",
      event_credits:
        "En finalisant cet achat, vous avez expressément accepté que les places de votre événement soient confirmées immédiatement, confirmant ainsi la renonciation à votre droit de rétractation sur celles-ci, conformément à l’article 103.m) du décret-loi royal 1/2007 du 16 novembre portant approbation du texte refondu de la loi générale pour la défense des consommateurs et des usagers.",
    },
    termsIntro: "Vous pouvez consulter les Conditions Générales complètes ici :",
    termsCta: "Voir les Conditions Générales",
    footer:
      "Vous recevez cet e-mail car vous venez de finaliser un achat sur la plateforme. Conservez-le : c’est la confirmation de votre contrat.",
  },
  de: {
    subject: {
      room: "Bestätigung deines Kaufs: {item}",
      room_license: "Bestätigung deiner Lizenz: {item}",
      event_credits: "Bestätigung deines Kaufs: Plätze für „{item}“",
    },
    intro: {
      room: "Danke für deinen Kauf. Wir bestätigen schriftlich den Vertrag über den Raum, den du gerade erworben hast.",
      room_license:
        "Danke für deinen Kauf. Wir bestätigen schriftlich den Vertrag über die Lizenz, die du gerade erworben hast.",
      event_credits:
        "Danke für deinen Kauf. Wir bestätigen schriftlich den Vertrag über die Event-Plätze, die du gerade erworben hast.",
    },
    itemLabel: {
      room: "Raum",
      room_license: "Raumlizenz",
      event_credits: "Event",
    },
    amountLabel: "Berechneter Betrag",
    playersLabel: "Gekaufte Plätze",
    waiver: {
      room:
        "Mit Abschluss dieses Kaufs hast du ausdrücklich zugestimmt, dass der Zugang zu diesem Raum, digitalem Inhalt, sofort beginnt, und damit den Verzicht auf dein Widerrufsrecht daran bestätigt, gemäß Artikel 103.m) des Königlichen Gesetzesdekrets 1/2007 vom 16. November zur Billigung des überarbeiteten Textes des Allgemeinen Gesetzes zum Schutz von Verbrauchern und Nutzern.",
      room_license:
        "Mit Abschluss dieses Kaufs hast du ausdrücklich zugestimmt, dass der Zugang zu dieser Lizenz, digitalem Inhalt, sofort beginnt, und damit den Verzicht auf dein Widerrufsrecht daran bestätigt, gemäß Artikel 103.m) des Königlichen Gesetzesdekrets 1/2007 vom 16. November zur Billigung des überarbeiteten Textes des Allgemeinen Gesetzes zum Schutz von Verbrauchern und Nutzern.",
      event_credits:
        "Mit Abschluss dieses Kaufs hast du ausdrücklich zugestimmt, dass die Plätze deines Events sofort bestätigt werden, und damit den Verzicht auf dein Widerrufsrecht daran bestätigt, gemäß Artikel 103.m) des Königlichen Gesetzesdekrets 1/2007 vom 16. November zur Billigung des überarbeiteten Textes des Allgemeinen Gesetzes zum Schutz von Verbrauchern und Nutzern.",
    },
    termsIntro: "Die vollständigen Nutzungsbedingungen findest du hier:",
    termsCta: "Nutzungsbedingungen ansehen",
    footer:
      "Du erhältst diese E-Mail, weil du gerade einen Kauf auf der Plattform abgeschlossen hast. Bewahre sie auf: Sie ist die Bestätigung deines Vertrags.",
  },
  nl: {
    subject: {
      room: "Bevestiging van je aankoop: {item}",
      room_license: "Bevestiging van je licentie: {item}",
      event_credits: "Bevestiging van je aankoop: plaatsen voor ‘{item}’",
    },
    intro: {
      room: "Bedankt voor je aankoop. We bevestigen schriftelijk de overeenkomst voor de kamer die je zojuist hebt gekocht.",
      room_license:
        "Bedankt voor je aankoop. We bevestigen schriftelijk de overeenkomst voor de licentie die je zojuist hebt gekocht.",
      event_credits:
        "Bedankt voor je aankoop. We bevestigen schriftelijk de overeenkomst voor de evenementplaatsen die je zojuist hebt gekocht.",
    },
    itemLabel: {
      room: "Kamer",
      room_license: "Kamerlicentie",
      event_credits: "Evenement",
    },
    amountLabel: "In rekening gebracht bedrag",
    playersLabel: "Gekochte plaatsen",
    waiver: {
      room:
        "Door deze aankoop af te ronden ging je er uitdrukkelijk mee akkoord dat de toegang tot deze kamer, digitale inhoud, direct zou beginnen, en bevestigde je daarmee dat je afstand doet van je herroepingsrecht daarop, overeenkomstig artikel 103.m) van Koninklijk Wetgevend Besluit 1/2007 van 16 november, houdende goedkeuring van de herziene tekst van de Algemene Wet ter Bescherming van Consumenten en Gebruikers.",
      room_license:
        "Door deze aankoop af te ronden ging je er uitdrukkelijk mee akkoord dat de toegang tot deze licentie, digitale inhoud, direct zou beginnen, en bevestigde je daarmee dat je afstand doet van je herroepingsrecht daarop, overeenkomstig artikel 103.m) van Koninklijk Wetgevend Besluit 1/2007 van 16 november, houdende goedkeuring van de herziene tekst van de Algemene Wet ter Bescherming van Consumenten en Gebruikers.",
      event_credits:
        "Door deze aankoop af te ronden ging je er uitdrukkelijk mee akkoord dat de plaatsen van je evenement direct zouden worden bevestigd, en bevestigde je daarmee dat je afstand doet van je herroepingsrecht daarop, overeenkomstig artikel 103.m) van Koninklijk Wetgevend Besluit 1/2007 van 16 november, houdende goedkeuring van de herziene tekst van de Algemene Wet ter Bescherming van Consumenten en Gebruikers.",
    },
    termsIntro: "De volledige Servicevoorwaarden vind je hier:",
    termsCta: "Servicevoorwaarden bekijken",
    footer:
      "Je ontvangt deze e-mail omdat je zojuist een aankoop op het platform hebt afgerond. Bewaar hem: het is de bevestiging van je overeenkomst.",
  },
  pt: {
    subject: {
      room: "Confirmação da tua compra: {item}",
      room_license: "Confirmação da tua licença: {item}",
      event_credits: "Confirmação da tua compra: lugares para «{item}»",
    },
    intro: {
      room: "Obrigado pela tua compra. Confirmamos por escrito o contrato da sala que acabaste de adquirir.",
      room_license:
        "Obrigado pela tua compra. Confirmamos por escrito o contrato da licença que acabaste de adquirir.",
      event_credits:
        "Obrigado pela tua compra. Confirmamos por escrito o contrato dos lugares do evento que acabaste de adquirir.",
    },
    itemLabel: {
      room: "Sala",
      room_license: "Licença de sala",
      event_credits: "Evento",
    },
    amountLabel: "Valor cobrado",
    playersLabel: "Lugares comprados",
    waiver: {
      room:
        "Ao concluíres esta compra, aceitaste expressamente que o acesso a esta sala, conteúdo digital, começasse de imediato, confirmando assim a renúncia ao teu direito de retratação sobre ela, nos termos do artigo 103.m) do Real Decreto Legislativo 1/2007, de 16 de novembro, que aprova o texto refundido da Lei Geral para a Defesa dos Consumidores e Utilizadores.",
      room_license:
        "Ao concluíres esta compra, aceitaste expressamente que o acesso a esta licença, conteúdo digital, começasse de imediato, confirmando assim a renúncia ao teu direito de retratação sobre ela, nos termos do artigo 103.m) do Real Decreto Legislativo 1/2007, de 16 de novembro, que aprova o texto refundido da Lei Geral para a Defesa dos Consumidores e Utilizadores.",
      event_credits:
        "Ao concluíres esta compra, aceitaste expressamente que os lugares do teu evento ficassem confirmados de imediato, confirmando assim a renúncia ao teu direito de retratação sobre eles, nos termos do artigo 103.m) do Real Decreto Legislativo 1/2007, de 16 de novembro, que aprova o texto refundido da Lei Geral para a Defesa dos Consumidores e Utilizadores.",
    },
    termsIntro: "Podes consultar os Termos de Serviço completos aqui:",
    termsCta: "Ver Termos de Serviço",
    footer:
      "Recebes este e-mail porque acabaste de concluir uma compra na plataforma. Guarda-o: é a confirmação do teu contrato.",
  },
};

function fill(template: string, item: string): string {
  return template.replace(/\{item\}/g, item);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sin saltos de línea (inyección de cabeceras) y acotado. */
function oneLine(value: string, max = 120): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatAmount(amountCents: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountCents / 100);
  } catch {
    // Moneda no reconocida por `Intl` (no debería pasar con las de Stripe): fallback plano.
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

/** Renderiza asunto, texto plano y HTML del email de confirmación de compra. */
export function renderPurchaseConfirmationEmail(data: PurchaseConfirmationEmailData): RenderedEmail {
  const locale = resolveMailLocale(data.locale) as Locale;
  const copy = COPY[locale] ?? COPY[DEFAULT_LOCALE];
  const item = oneLine(data.itemTitle);
  const subject = fill(copy.subject[data.kind], item);
  const intro = copy.intro[data.kind];
  const amount = formatAmount(data.amountCents, data.currency, locale);
  const waiver = copy.waiver[data.kind];
  const players = data.kind === "event_credits" && data.players !== null ? data.players : null;

  const text = [
    intro,
    "",
    `${copy.itemLabel[data.kind]}: ${item}`,
    `${copy.amountLabel}: ${amount}`,
    ...(players !== null ? [`${copy.playersLabel}: ${players}`] : []),
    "",
    waiver,
    "",
    copy.termsIntro,
    data.termsUrl,
    "",
    "—",
    copy.footer,
  ].join("\n");

  const h = (v: string) => escapeHtml(v);
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${h(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;font-size:14px;line-height:1.6">
<tr><td style="color:#52525b;padding-right:8px">${h(copy.itemLabel[data.kind])}</td><td style="font-weight:bold">${h(item)}</td></tr>
<tr><td style="color:#52525b;padding-right:8px">${h(copy.amountLabel)}</td><td style="font-weight:bold">${h(amount)}</td></tr>
${players !== null ? `<tr><td style="color:#52525b;padding-right:8px">${h(copy.playersLabel)}</td><td style="font-weight:bold">${players}</td></tr>\n` : ""}</table>
<p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#3f3f46">${h(waiver)}</p>
<p style="margin:0 0 4px;font-size:13px">${h(copy.termsIntro)}</p>
<p style="margin:0 0 16px"><a href="${h(data.termsUrl)}" style="color:#4f46e5;text-decoration:underline;font-size:13px">${h(copy.termsCta)}</a></p>
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#71717a">${h(copy.footer)}</p>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
