import { CHAT_BANNED_TERMS, censorChatText, sanitizeChatText } from "../chat";
import type { RoomPackage } from "../schemas";

/**
 * Pre-check automático de contenido al publicar (ticket 6.1, specs/17 §3).
 *
 * Corre de forma síncrona dentro de `POST /api/rooms/:roomId/publish`, junto al
 * validador de solvabilidad, y tiene que ser rápido (<2 s): aquí no hay red.
 * El proveedor va detrás de `ContentPrecheckProvider` para poder cambiarlo por
 * un clasificador de toxicidad sin tocar la publicación; la implementación
 * incluida (`createLocalContentPrecheck`) reutiliza el filtro de lenguaje del
 * chat (2.1) con dos umbrales y NUNCA llama a un servicio externo:
 *
 * - 🛑 `block`: términos graves (insultos de odio, contenido sexual explícito).
 * - 🟡 `flag`: lenguaje ofensivo leve (la lista del chat) o datos personales
 *   (emails, teléfonos). No bloquea: la sala se publica y el contenido entra en
 *   la cola humana con severidad normal.
 */

export type PrecheckText = { path: string; text: string };

export type PrecheckFindingKind = "severe_language" | "language" | "pii_email" | "pii_phone";

export type PrecheckFinding = { path: string; kind: PrecheckFindingKind; match: string };

export type PrecheckVerdict = {
  action: "allow" | "flag" | "block";
  /** Tipos de hallazgo distintos, ordenados (lo que se guarda en `contentReport.flags`). */
  flags: PrecheckFindingKind[];
  findings: PrecheckFinding[];
};

export interface ContentPrecheckProvider {
  check(texts: readonly PrecheckText[]): Promise<PrecheckVerdict>;
}

/**
 * Términos que bloquean la publicación (umbral alto). Lista corta y
 * conservadora a propósito: un falso positivo aquí impide publicar (aunque se
 * pueda apelar), así que solo entran insultos de odio y sexualidad explícita.
 */
export const PRECHECK_SEVERE_TERMS: readonly string[] = [
  "maricon",
  "sudaca",
  "negrata",
  "porno",
  "porn",
  "follar",
];

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** Teléfono: 9+ dígitos con separadores opcionales (los códigos de candado son más cortos). */
const PHONE_RE = /(?<![\p{L}\p{N}])\+?\d(?:[\s.-]?\d){8,14}(?![\p{L}\p{N}])/gu;

const KIND_ORDER: PrecheckFindingKind[] = ["severe_language", "language", "pii_email", "pii_phone"];

/** Pre-check local sobre el filtro del chat. `terms`/`severeTerms` configurables. */
export function createLocalContentPrecheck(
  opts: { terms?: readonly string[]; severeTerms?: readonly string[] } = {},
): ContentPrecheckProvider {
  const severe = opts.severeTerms ?? PRECHECK_SEVERE_TERMS;
  const severeSet = new Set(severe);
  const mild = (opts.terms ?? CHAT_BANNED_TERMS).filter((t) => !severeSet.has(t));

  return {
    async check(texts) {
      const findings: PrecheckFinding[] = [];
      for (const { path, text } of texts) {
        const clean = sanitizeChatText(text);
        if (!clean) continue;
        for (const match of censorChatText(clean, severe).matches) {
          findings.push({ path, kind: "severe_language", match });
        }
        for (const match of censorChatText(clean, mild).matches) {
          findings.push({ path, kind: "language", match });
        }
        for (const m of clean.matchAll(EMAIL_RE)) {
          findings.push({ path, kind: "pii_email", match: m[0] });
        }
        for (const m of clean.matchAll(PHONE_RE)) {
          findings.push({ path, kind: "pii_phone", match: m[0] });
        }
      }
      const kinds = new Set(findings.map((f) => f.kind));
      const flags = KIND_ORDER.filter((k) => kinds.has(k));
      const action = kinds.has("severe_language") ? "block" : flags.length > 0 ? "flag" : "allow";
      return { action, flags, findings };
    },
  };
}

/**
 * Textos moderables de un `RoomPackage` (specs/17 §2): título y descripción de
 * la sala y todo `LocalizedText` (diálogos, pistas, textos de objetos…), con
 * la ruta JSON de cada uno para que el moderador y el creador sepan dónde está.
 */
export function collectModerationTexts(pkg: RoomPackage): PrecheckText[] {
  const texts: PrecheckText[] = [
    { path: "meta.title", text: pkg.meta.title },
    { path: "meta.description", text: pkg.meta.description },
  ];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (key === "text" && typeof v === "string") texts.push({ path: next, text: v });
      else walk(v, next);
    }
  };
  for (const [key, value] of Object.entries(pkg)) {
    if (key !== "meta") walk(value, key);
  }
  return texts;
}
