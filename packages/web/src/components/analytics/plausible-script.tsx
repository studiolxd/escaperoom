import Script from "next/script";

/**
 * Plausible (docs/DEUDA.md «Claves reales de analítica antes de desplegar en
 * producción»): mide tráfico agregado sin cookies y sin identificar a nadie
 * individualmente, así que no requiere consentimiento (a diferencia de
 * Google Analytics, ver `google-analytics-script.tsx`) — se carga siempre
 * que `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` esté configurado. `nonce` es el de la
 * CSP de la petición (`src/lib/security-headers.ts`), sin el cual
 * `script-src` bloquearía el script.
 */
export function PlausibleScript({ nonce }: { nonce: string }) {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  if (!domain) return null;

  const src = process.env.NEXT_PUBLIC_PLAUSIBLE_SRC || "https://plausible.io/js/script.js";

  return (
    <Script
      id="plausible-script"
      src={src}
      data-domain={domain}
      strategy="afterInteractive"
      nonce={nonce}
    />
  );
}
