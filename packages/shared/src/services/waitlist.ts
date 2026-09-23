import { LOCALES, type Locale } from "@escaperoom/config/locales";

/**
 * Waitlist de la landing pública (ticket 6.7, specs/20 §1, §5): captura el
 * email de un visitante interesado, antes incluso de que exista producto
 * jugable (specs/25 §2.1). Un email solo aparece una vez (`UNIQUE(email)`);
 * repetir el alta es idempotente, nunca un error.
 */
export type WaitlistSignup = {
  id: string;
  email: string;
  locale: Locale;
  source: string | null;
  createdAt: string;
};

export interface WaitlistStore {
  /** Alta o no-op si el email ya está (`UNIQUE(email)`). */
  upsert(input: { email: string; locale: Locale; source: string | null }): Promise<{
    signup: WaitlistSignup;
    created: boolean;
  }>;
}

export type WaitlistErrorCode = "VALIDATION_ERROR";

export class WaitlistError extends Error {
  readonly code: WaitlistErrorCode;
  constructor(code: WaitlistErrorCode, message: string) {
    super(message);
    this.name = "WaitlistError";
    this.code = code;
  }
}

export const WAITLIST_SOURCE_MAX_LENGTH = 100;
/** Cota generosa: RFC 5321 limita a 254; se guarda tal cual (citext = case-insensitive). */
export const WAITLIST_EMAIL_MAX_LENGTH = 254;

/** Entrada cruda de `POST /api/waitlist`. */
export type WaitlistInput = { email: unknown; locale?: unknown; source?: unknown };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida y normaliza el alta (email recortado y en minúsculas, locale conocido). */
export function parseWaitlistInput(input: WaitlistInput): {
  email: string;
  locale: Locale;
  source: string | null;
} {
  const { email, locale, source } = input;
  if (typeof email !== "string") {
    throw new WaitlistError("VALIDATION_ERROR", "El email es obligatorio");
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (
    trimmedEmail.length === 0 ||
    trimmedEmail.length > WAITLIST_EMAIL_MAX_LENGTH ||
    !EMAIL_RE.test(trimmedEmail)
  ) {
    throw new WaitlistError("VALIDATION_ERROR", "El email no es válido");
  }

  const resolvedLocale =
    typeof locale === "string" && (LOCALES as readonly string[]).includes(locale)
      ? (locale as Locale)
      : undefined;
  if (locale !== undefined && resolvedLocale === undefined) {
    throw new WaitlistError("VALIDATION_ERROR", `"locale" debe ser uno de: ${LOCALES.join(", ")}`);
  }

  if (source !== undefined && source !== null && typeof source !== "string") {
    throw new WaitlistError("VALIDATION_ERROR", '"source" debe ser una cadena');
  }
  const trimmedSource = typeof source === "string" ? source.trim() : null;
  if (trimmedSource !== null && trimmedSource.length > WAITLIST_SOURCE_MAX_LENGTH) {
    throw new WaitlistError(
      "VALIDATION_ERROR",
      `"source" admite como mucho ${WAITLIST_SOURCE_MAX_LENGTH} caracteres`,
    );
  }

  return {
    email: trimmedEmail,
    locale: resolvedLocale ?? "es",
    source: trimmedSource && trimmedSource.length > 0 ? trimmedSource : null,
  };
}

/** Servicio de la waitlist: sin autenticación, sin autorización. */
export function createWaitlistService(deps: { store: WaitlistStore }) {
  const { store } = deps;
  return {
    /** Da de alta (o confirma, si ya estaba) el email en la waitlist. */
    async join(
      input: WaitlistInput,
    ): Promise<{ signup: WaitlistSignup; created: boolean }> {
      const parsed = parseWaitlistInput(input);
      return store.upsert(parsed);
    },
  };
}

export type WaitlistService = ReturnType<typeof createWaitlistService>;

/** Store en memoria (tests): misma semántica que Postgres, `UNIQUE(email)`. */
export function createInMemoryWaitlistStore(now: () => Date = () => new Date()): WaitlistStore {
  const byEmail = new Map<string, WaitlistSignup>();
  let seq = 0;
  return {
    async upsert({ email, locale, source }) {
      const existing = byEmail.get(email);
      if (existing) return { signup: existing, created: false };
      const signup: WaitlistSignup = {
        id: `waitlist-${++seq}`,
        email,
        locale,
        source,
        createdAt: now().toISOString(),
      };
      byEmail.set(email, signup);
      return { signup, created: true };
    },
  };
}
