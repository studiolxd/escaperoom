import { CHAT_CENSOR_MASK } from "./constants";

/**
 * Filtro de lenguaje básico para el chat en vivo (specs/17 §3, §8).
 *
 * Decisión (documentada en `docs/plan/README`/PR): un mensaje que contiene un
 * término prohibido **se censura y se marca `filtered: true`**; no se difunde
 * el texto original. La censura sustituye el término por `*` y el flag permite
 * que el cliente lo muestre como advertencia. Es un filtro *básico*: lista de
 * términos más variantes simples (acentos, mayúsculas, leetspeak y separadores
 * entre letras), no un clasificador de toxicidad.
 */

/** Lista base de términos prohibidos (canónica, sin acentos). */
export const CHAT_BANNED_TERMS: readonly string[] = [
  "tonto",
  "idiota",
  "imbecil",
  "estupido",
  "gilipollas",
  "cabron",
  "maricon",
  "puta",
  "puto",
  "mierda",
  "joder",
  "coño",
  "zorra",
  "pendejo",
  "verga",
  "culo",
];

/**
 * Variantes simples por letra: acentos, mayúsculas (el regex es `i`),
 * sustituciones leetspeak y símbolos habituales.
 */
const CHAR_VARIANTS: Record<string, readonly string[]> = {
  a: ["a", "á", "à", "ä", "@", "4"],
  b: ["b", "8"],
  c: ["c", "ç"],
  e: ["e", "é", "è", "ë", "3"],
  g: ["g", "9"],
  i: ["i", "í", "ì", "ï", "1", "!"],
  l: ["l", "1", "|"],
  n: ["n", "ñ"],
  o: ["o", "ó", "ò", "ö", "0"],
  s: ["s", "5", "$"],
  t: ["t", "7"],
  u: ["u", "ú", "ù", "ü"],
};

/** Separadores permitidos entre letras de un mismo término (`t-o-n-t-o`). */
const LETTER_SEPARATOR = "[\\s._*'\\-]*";

const regexCache = new Map<string, RegExp>();

function escapeForCharClass(value: string): string {
  return value.replace(/[\\\]^-]/g, "\\$&");
}

/** Construye un patrón que admite las variantes simples de cada letra. */
function termToPattern(term: string): string {
  return [...term]
    .map((char) => {
      const variants = CHAR_VARIANTS[char] ?? [char];
      return `[${escapeForCharClass(variants.join(""))}]+`;
    })
    .join(LETTER_SEPARATOR);
}

function termRegex(term: string): RegExp {
  const cached = regexCache.get(term);
  if (cached) {
    return cached;
  }
  // Límites por letra/dígito para no censurar dentro de otra palabra
  // (el clásico problema "Scunthorpe").
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])${termToPattern(term)}(?![\\p{L}\\p{N}])`, "giu");
  regexCache.set(term, regex);
  return regex;
}

const HTML_TAG = /<[^>]*>/g;
const CONTROL_CHARS = /\p{Cc}/gu;

/** Limpia el texto: quita HTML, caracteres de control y normaliza espacios. */
export function sanitizeChatText(raw: string): string {
  return raw.replace(HTML_TAG, "").replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

export interface ChatFilterResult {
  /** Texto final listo para difundir (censurado si había términos). */
  text: string;
  /** `true` si se detectó y censuró al menos un término prohibido. */
  filtered: boolean;
  /** Términos canónicos detectados (sin duplicados, en orden de la lista). */
  matches: string[];
}

/**
 * Censura los términos prohibidos de un texto ya desinfectado. Es puro y no
 * depende de Colyseus ni de red, así que se puede testear sin infraestructura.
 */
export function censorChatText(text: string): ChatFilterResult {
  let output = text;
  const matches: string[] = [];

  for (const term of CHAT_BANNED_TERMS) {
    const replaced = output.replace(termRegex(term), (match) =>
      CHAT_CENSOR_MASK.repeat(match.length),
    );
    if (replaced !== output) {
      matches.push(term);
      output = replaced;
    }
  }

  return { text: output, filtered: matches.length > 0, matches };
}

/** Desinfecta y censura en un solo paso (lo que aplica el servidor). */
export function filterChatText(raw: string): ChatFilterResult {
  return censorChatText(sanitizeChatText(raw));
}
