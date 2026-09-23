// Serialización pura de la cookie de consentimiento de primera parte
// (adaptado del mecanismo de slxd, `packages/public-shell/src/consent/cookie.ts`).
// Genérica sobre el catálogo de categorías: quién decide qué categorías
// existen es `consent-config.ts`.

export type ConsentCategories<K extends string> = Record<K, boolean>;

export type StoredConsent<K extends string> = {
  /** Versión del catálogo de categorías contra la que se tomó la decisión. */
  v: number;
  /** Momento (ms epoch) en que se registró la decisión. */
  ts: number;
  categories: ConsentCategories<K>;
};

export type ConsentCookieConfig = {
  cookieName: string;
  version: number;
  /** Caducidad en segundos. */
  maxAge: number;
};

/** Todas las categorías opcionales denegadas — la base previa al consentimiento. */
export function defaultConsent<K extends string>(categories: readonly K[]): ConsentCategories<K> {
  return categories.reduce(
    (acc, cat) => {
      acc[cat] = false;
      return acc;
    },
    {} as ConsentCategories<K>,
  );
}

/** Serializa una decisión al valor de la cookie (JSON codificado en URL). */
export function encodeConsent<K extends string>(
  categories: ConsentCategories<K>,
  now: number,
  config: Pick<ConsentCookieConfig, "version">,
): string {
  const payload: StoredConsent<K> = { v: config.version, ts: now, categories };
  return encodeURIComponent(JSON.stringify(payload));
}

/** Parsea el valor guardado; null si falta o está corrupto. */
export function decodeConsent<K extends string>(
  raw: string | undefined | null,
  categories: readonly K[],
): StoredConsent<K> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as StoredConsent<K>).v !== "number" ||
      typeof (parsed as StoredConsent<K>).categories !== "object"
    ) {
      return null;
    }
    const stored = parsed as StoredConsent<K>;
    const normalized = categories.reduce(
      (acc, cat) => {
        acc[cat] = stored.categories[cat] === true;
        return acc;
      },
      {} as ConsentCategories<K>,
    );
    return { v: stored.v, ts: stored.ts, categories: normalized };
  } catch {
    return null;
  }
}

/** Una decisión caduca si es de una versión de catálogo distinta o ha expirado. */
export function isConsentStale<K extends string>(
  decoded: StoredConsent<K>,
  now: number,
  config: Pick<ConsentCookieConfig, "version" | "maxAge">,
): boolean {
  if (decoded.v !== config.version) return true;
  return now - decoded.ts > config.maxAge * 1000;
}
