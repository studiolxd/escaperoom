import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Maquetación del PDF de tarjetas-clave (ticket 5.7, specs/13 §9).
 *
 * Solo JS puro: `pdf-lib` (MIT) con las fuentes estándar de PDF (Helvetica y
 * Courier, sin leer ficheros de disco) y `qrcode` (MIT) para la matriz del QR,
 * que se dibuja como trazado vectorial. Sin binarios del sistema ni navegador.
 *
 * Una hoja A4 vertical lleva 2 × 4 tarjetas con líneas de corte. Cada tarjeta:
 * título del evento, título de la sala, la clave en grande (legible y dictable:
 * el alfabeto ya excluye `0/O` y `1/I/L`), el QR que abre la URL de canje con la
 * clave, asientos si es compartida, caducidad si la tiene e instrucciones
 * breves en el idioma del evento.
 */

// ── Textos (idioma del evento) ─────────────────────────────────────────────

/** Idiomas de la plataforma (los mismos 6 locales que la UI con next-intl). */
export const CARD_LOCALES = ["es", "en", "fr", "de", "nl", "pt"] as const;
export type CardLocale = (typeof CARD_LOCALES)[number];

export function isCardLocale(value: unknown): value is CardLocale {
  return typeof value === "string" && (CARD_LOCALES as readonly string[]).includes(value);
}

type CardMessages = {
  keyLabel: string;
  /** `{url}`: URL de canje sin la clave. */
  instructions: string;
  /** `{n}`: asientos de una clave compartida. */
  seats: string;
  /** `{date}`: caducidad en UTC. */
  expires: string;
  /** `{title}`: título del evento. */
  documentTitle: string;
};

export const CARD_MESSAGES: Record<CardLocale, CardMessages> = {
  es: {
    keyLabel: "Clave de acceso",
    instructions:
      "Escanea el código QR o entra en {url} e introduce la clave para unirte a la partida.",
    seats: "Válida para {n} personas",
    expires: "Caduca: {date}",
    documentTitle: "Tarjetas de acceso — {title}",
  },
  en: {
    keyLabel: "Access key",
    instructions: "Scan the QR code or go to {url} and enter the key to join the game.",
    seats: "Valid for {n} people",
    expires: "Expires: {date}",
    documentTitle: "Access cards — {title}",
  },
  fr: {
    keyLabel: "Clé d'accès",
    instructions:
      "Scannez le code QR ou rendez-vous sur {url} et saisissez la clé pour rejoindre la partie.",
    seats: "Valable pour {n} personnes",
    expires: "Expire le : {date}",
    documentTitle: "Cartes d'accès — {title}",
  },
  de: {
    keyLabel: "Zugangsschlüssel",
    instructions:
      "Scanne den QR-Code oder öffne {url} und gib den Schlüssel ein, um dem Spiel beizutreten.",
    seats: "Gültig für {n} Personen",
    expires: "Gültig bis: {date}",
    documentTitle: "Zugangskarten — {title}",
  },
  nl: {
    keyLabel: "Toegangscode",
    instructions: "Scan de QR-code of ga naar {url} en voer de code in om mee te spelen.",
    seats: "Geldig voor {n} personen",
    expires: "Verloopt: {date}",
    documentTitle: "Toegangskaarten — {title}",
  },
  pt: {
    keyLabel: "Chave de acesso",
    instructions: "Lê o código QR ou entra em {url} e introduz a chave para te juntares ao jogo.",
    seats: "Válida para {n} pessoas",
    expires: "Expira: {date}",
    documentTitle: "Cartões de acesso — {title}",
  },
};

function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
}

// ── Entrada ────────────────────────────────────────────────────────────────

export type CardPdfCard = {
  code: string;
  /** URL que codifica el QR (canje con la clave ya puesta). */
  redeemUrl: string;
  /** Asientos: >1 en claves compartidas (grupo/rotativa). */
  seats: number;
  expiresAt: Date | null;
};

export type CardPdfInput = {
  eventTitle: string;
  roomTitle: string;
  locale: CardLocale;
  /** URL de canje sin la clave, para las instrucciones impresas. */
  redeemPageUrl: string;
  cards: CardPdfCard[];
  /** Fecha de creación del documento (inyectable: PDF deterministas en tests). */
  createdAt?: Date;
};

// ── Maquetación ────────────────────────────────────────────────────────────

/** A4 vertical en puntos. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 28;
const COLUMNS = 2;
const ROWS = 4;
export const CARDS_PER_PAGE = COLUMNS * ROWS;
const CARD_WIDTH = (PAGE_WIDTH - 2 * PAGE_MARGIN) / COLUMNS;
const CARD_HEIGHT = (PAGE_HEIGHT - 2 * PAGE_MARGIN) / ROWS;
const PADDING = 14;
const QR_SIZE = 92;

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.4, 0.45);
const CUT = rgb(0.72, 0.72, 0.75);

type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont };

/**
 * Las fuentes estándar solo codifican WinAnsi (latín-1 ampliado): cubre los 6
 * idiomas, pero un título con otros caracteres (emoji, alfabetos no latinos)
 * haría fallar `drawText`. Se degrada carácter a carácter: tal cual, sin
 * diacríticos o `?`.
 */
function sanitizer(font: PDFFont): (text: string) => string {
  const supported = new Set(font.getCharacterSet());
  return (text) =>
    Array.from(text.normalize("NFC").replace(/\s+/g, " "))
      .map((ch) => {
        if (supported.has(ch.codePointAt(0)!)) return ch;
        const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
        return base.length > 0 && Array.from(base).every((c) => supported.has(c.codePointAt(0)!))
          ? base
          : "?";
      })
      .join("");
}

/** Parte `text` en líneas de ancho ≤ `width`; si sobran, la última acaba en «…». */
function wrap(text: string, font: PDFFont, size: number, width: number, maxLines: number) {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ").filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    // Una palabra más ancha que la línea se corta a mano.
    while (!fits(current) && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && !fits(current.slice(0, cut))) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (!fits(last) && last.length > 1) last = `${last.slice(0, -2)}…`;
  kept[maxLines - 1] = last;
  return kept;
}

/**
 * Trazado SVG del QR con los módulos oscuros agrupados en tramos horizontales
 * (un rectángulo por tramo, no por módulo: el PDF de 1000 tarjetas no se dispara).
 */
function qrPath(text: string): { path: string; size: number } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const parts: string[] = [];
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!modules.data[row * n + col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && modules.data[row * n + col]) col++;
      parts.push(`M${start} ${row}h${col - start}v1h${start - col}z`);
    }
  }
  return { path: parts.join(""), size: n };
}

function drawCard(
  page: PDFPage,
  fonts: Fonts,
  clean: (text: string) => string,
  input: CardPdfInput,
  card: CardPdfCard,
  originX: number,
  originY: number,
): void {
  const messages = CARD_MESSAGES[input.locale];
  const top = originY + CARD_HEIGHT - PADDING;
  const left = originX + PADDING;
  const textWidth = CARD_WIDTH - 3 * PADDING - QR_SIZE;

  // QR a la derecha, centrado en vertical en la mitad superior.
  const qr = qrPath(card.redeemUrl);
  const scale = QR_SIZE / qr.size;
  page.drawSvgPath(qr.path, {
    x: originX + CARD_WIDTH - PADDING - QR_SIZE,
    y: top,
    scale,
    color: INK,
    borderWidth: 0,
  });

  let y = top - 11;
  for (const line of wrap(clean(input.eventTitle), fonts.bold, 11, textWidth, 2)) {
    page.drawText(line, { x: left, y, size: 11, font: fonts.bold, color: INK });
    y -= 13;
  }
  for (const line of wrap(clean(input.roomTitle), fonts.regular, 8.5, textWidth, 1)) {
    page.drawText(line, { x: left, y, size: 8.5, font: fonts.regular, color: MUTED });
    y -= 10.5;
  }

  y -= 8;
  page.drawText(clean(messages.keyLabel).toUpperCase(), {
    x: left,
    y,
    size: 6.5,
    font: fonts.bold,
    color: MUTED,
  });
  y -= 18;
  // La clave, con el tamaño más grande que quepa (15-18 pt en Courier).
  let codeSize = 18;
  while (codeSize > 12 && fonts.mono.widthOfTextAtSize(card.code, codeSize) > textWidth) {
    codeSize -= 0.5;
  }
  page.drawText(card.code, { x: left, y, size: codeSize, font: fonts.mono, color: INK });

  const details: string[] = [];
  if (card.seats > 1) details.push(format(messages.seats, { n: String(card.seats) }));
  if (card.expiresAt) {
    const date = new Intl.DateTimeFormat(input.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(card.expiresAt);
    details.push(format(messages.expires, { date: `${date} UTC` }));
  }
  for (const detail of details) {
    y -= 12;
    page.drawText(clean(detail), { x: left, y, size: 7.5, font: fonts.bold, color: INK });
  }

  // Instrucciones abajo, a todo el ancho de la tarjeta.
  const instructions = wrap(
    clean(format(messages.instructions, { url: input.redeemPageUrl })),
    fonts.regular,
    7.5,
    CARD_WIDTH - 2 * PADDING,
    4,
  );
  let iy = originY + PADDING + (instructions.length - 1) * 9.5;
  for (const line of instructions) {
    page.drawText(line, { x: left, y: iy, size: 7.5, font: fonts.regular, color: MUTED });
    iy -= 9.5;
  }
}

function drawCutLines(page: PDFPage): void {
  const line = { thickness: 0.5, color: CUT, dashArray: [3, 3] };
  for (let c = 0; c <= COLUMNS; c++) {
    const x = PAGE_MARGIN + c * CARD_WIDTH;
    page.drawLine({
      ...line,
      start: { x, y: PAGE_MARGIN },
      end: { x, y: PAGE_HEIGHT - PAGE_MARGIN },
    });
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = PAGE_MARGIN + r * CARD_HEIGHT;
    page.drawLine({
      ...line,
      start: { x: PAGE_MARGIN, y },
      end: { x: PAGE_WIDTH - PAGE_MARGIN, y },
    });
  }
}

/** Genera el PDF de tarjetas. Una tarjeta por clave, en el orden recibido. */
export async function renderAccessKeyCardsPdf(input: CardPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.CourierBold),
  };
  const clean = sanitizer(fonts.regular);
  const createdAt = input.createdAt ?? new Date();
  doc.setTitle(
    clean(format(CARD_MESSAGES[input.locale].documentTitle, { title: input.eventTitle })),
  );
  doc.setLanguage(input.locale);
  doc.setCreator("Escaperoom");
  doc.setProducer("Escaperoom");
  doc.setCreationDate(createdAt);
  doc.setModificationDate(createdAt);

  for (let i = 0; i < input.cards.length; i += CARDS_PER_PAGE) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawCutLines(page);
    input.cards.slice(i, i + CARDS_PER_PAGE).forEach((card, slot) => {
      const col = slot % COLUMNS;
      const row = Math.floor(slot / COLUMNS);
      const x = PAGE_MARGIN + col * CARD_WIDTH;
      const y = PAGE_HEIGHT - PAGE_MARGIN - (row + 1) * CARD_HEIGHT;
      drawCard(page, fonts, clean, input, card, x, y);
    });
  }
  return doc.save();
}
