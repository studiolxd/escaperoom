"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  defaultConsent,
  decodeConsent,
  encodeConsent,
  isConsentStale,
  type ConsentCategories,
} from "@/lib/cookie-consent";
import { ACTIVE_OPTIONAL_CATEGORIES, CONSENT_COOKIE_CONFIG } from "@/lib/cookie-consent-config";

type Categories = ConsentCategories<(typeof ACTIVE_OPTIONAL_CATEGORIES)[number]>;

type ConsentContextValue = {
  /** `false` hasta leer la cookie en el cliente (evita un parpadeo de la banda). */
  ready: boolean;
  decided: boolean;
  categories: Categories;
  acceptAll: () => void;
  rejectAll: () => void;
  onChangeCategories: (categories: Categories) => void;
  prefsOpen: boolean;
  openPreferences: () => void;
  setPrefsOpen: (open: boolean) => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent debe usarse dentro de un ConsentProvider.");
  return ctx;
}

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? (match.split("=")[1] ?? null) : null;
}

/**
 * Estado y persistencia del consentimiento de cookies opcionales: una cookie
 * de primera parte, sin llamar a ningún servicio externo (adaptado de
 * `ConsentProvider` de slxd). Mientras `ACTIVE_OPTIONAL_CATEGORIES` esté
 * vacío no hay nada que consentir, así que en la práctica esto no le enseña
 * ninguna banda al usuario todavía (ver `cookie-consent-config.ts`).
 */
export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [decided, setDecided] = useState(false);
  const [state, setState] = useState<Categories>(() => defaultConsent(ACTIVE_OPTIONAL_CATEGORIES));
  const [prefsOpen, setPrefsOpen] = useState(false);

  useEffect(() => {
    const stored = decodeConsent<(typeof ACTIVE_OPTIONAL_CATEGORIES)[number]>(
      readCookie(CONSENT_COOKIE_CONFIG.cookieName),
      ACTIVE_OPTIONAL_CATEGORIES,
    );
    if (stored && !isConsentStale(stored, Date.now(), CONSENT_COOKIE_CONFIG)) {
      setState(stored.categories);
      setDecided(true);
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: Categories, { closePanel }: { closePanel: boolean }) => {
    document.cookie = `${CONSENT_COOKIE_CONFIG.cookieName}=${encodeConsent(next, Date.now(), CONSENT_COOKIE_CONFIG)}; path=/; max-age=${CONSENT_COOKIE_CONFIG.maxAge}; SameSite=Lax`;
    setState(next);
    setDecided(true);
    if (closePanel) setPrefsOpen(false);
  }, []);

  const acceptAll = useCallback(() => {
    const next = ACTIVE_OPTIONAL_CATEGORIES.reduce((acc, cat) => {
      acc[cat] = true;
      return acc;
    }, {} as Categories);
    persist(next, { closePanel: true });
  }, [persist]);

  const rejectAll = useCallback(
    () => persist(defaultConsent(ACTIVE_OPTIONAL_CATEGORIES), { closePanel: true }),
    [persist],
  );

  const onChangeCategories = useCallback(
    (next: Categories) => persist(next, { closePanel: false }),
    [persist],
  );

  const value = useMemo<ConsentContextValue>(
    () => ({
      ready,
      decided,
      categories: state,
      acceptAll,
      rejectAll,
      onChangeCategories,
      prefsOpen,
      openPreferences: () => setPrefsOpen(true),
      setPrefsOpen,
    }),
    [ready, decided, state, acceptAll, rejectAll, onChangeCategories, prefsOpen],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}
