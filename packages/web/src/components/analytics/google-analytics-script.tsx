"use client";

import { useEffect } from "react";
import Script from "next/script";
import { useConsent } from "@/components/consent/consent-provider";

/** `_ga` (cliente) y `_ga_<container>` (sesión de esta propiedad concreta). */
function gaCookieNames(measurementId: string): string[] {
  return ["_ga", `_ga_${measurementId.replace(/^G-/, "")}`];
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Google Analytics 4 (docs/DEUDA.md «Claves reales de analítica antes de
 * desplegar en producción»): usa las cookies `_ga`/`_ga_*`, así que —a
 * diferencia de Plausible— nunca se carga sin consentimiento previo de la
 * categoría "analytics" (`ConsentProvider`). No se usa Consent Mode v2
 * (`default: denied` + `update`): ese patrón sigue disparando una petición a
 * Google al cargar la página aunque el consentimiento esté denegado, y aquí
 * la regla es que no debe intervenir NINGÚN proveedor con cookies antes de
 * aceptar. Al rechazar (o retirar un consentimiento ya dado), `gtag` se
 * desactiva con el interruptor oficial `window['ga-disable-<id>']` —necesario
 * porque desmontar el `<script>` no deshace los listeners que ya haya
 * instalado gtag— y se borran las cookies que pudiera haber dejado.
 */
export function GoogleAnalyticsScript({
  measurementId,
  nonce,
}: {
  measurementId: string;
  nonce: string;
}) {
  const { ready, categories } = useConsent();
  const granted = ready && categories.analytics === true;

  useEffect(() => {
    const flag = `ga-disable-${measurementId}`;
    if (granted) {
      // `ready` empieza en `false` (aún sin leer la cookie de consentimiento):
      // ese primer render, con `granted` todavía falso, ya deja el
      // interruptor en `true` más abajo. Si el consentimiento resulta
      // aceptado, hay que revertirlo explícitamente o `gtag` no llegaría a
      // medir nada pese a cargarse.
      (window as unknown as Record<string, boolean>)[flag] = false;
      return;
    }
    (window as unknown as Record<string, boolean>)[flag] = true;
    for (const name of gaCookieNames(measurementId)) deleteCookie(name);
  }, [granted, measurementId]);

  if (!granted) return null;

  return (
    <>
      <Script
        id="ga-loader"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
        nonce={nonce}
      />
      <Script id="ga-init" strategy="afterInteractive" nonce={nonce}>
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}');`}
      </Script>
    </>
  );
}
