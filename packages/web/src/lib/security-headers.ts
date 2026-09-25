/**
 * Cabeceras de seguridad de la web (ticket 6.3, specs/13 §11 «CSP estricta en
 * el frontend»). Lógica pura, sin Next: la usan `proxy.ts` (CSP por petición,
 * con nonce) y `next.config.ts` (cabeceras fijas de todas las respuestas).
 *
 * Las excepciones a `'self'` y su porqué están en `docs/reference/seguridad.md` §3.
 */

export type SecurityEnv = Partial<
  Record<
    | "NODE_ENV"
    | "NEXT_PUBLIC_COLYSEUS_URL"
    | "NEXT_PUBLIC_EDITOR_SYNC_URL"
    | "NEXT_PUBLIC_LIVEKIT_URL"
    | "LIVEKIT_URL"
    | "STORAGE_ENDPOINT"
    | "CSP_EXTRA_CONNECT_SRC"
    | "NEXT_PUBLIC_SENTRY_DSN"
    | "NEXT_PUBLIC_PLAUSIBLE_DOMAIN"
    | "NEXT_PUBLIC_PLAUSIBLE_SRC"
    | "NEXT_PUBLIC_GA_MEASUREMENT_ID",
    string
  >
>;

/** Mismos valores por defecto que `lib/colyseus.ts` y `lib/editor-sync.ts` (dev). */
const DEFAULT_COLYSEUS_URL = "ws://localhost:2567";
const DEFAULT_EDITOR_SYNC_URL = "ws://localhost:2568";

const PAIRED_SCHEME: Record<string, string> = {
  "ws:": "http:",
  "wss:": "https:",
  "http:": "ws:",
  "https:": "wss:",
};

/**
 * Orígenes de una URL de servicio en tiempo real, en sus dos esquemas: el SDK
 * de Colyseus hace HTTP (matchmaking) y luego WebSocket al mismo host; el de
 * LiveKit, WebSocket y HTTP (validación) al suyo. Una URL inválida no añade nada.
 */
export function serviceOrigins(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) return [];
  try {
    const url = new URL(value);
    const paired = PAIRED_SCHEME[url.protocol];
    if (!paired) return [];
    return [`${url.protocol}//${url.host}`, `${paired}//${url.host}`];
  } catch {
    return [];
  }
}

/** LiveKit Cloud reparte las conexiones entre hosts regionales del mismo dominio. */
function liveKitOrigins(raw: string | undefined): string[] {
  const origins = serviceOrigins(raw);
  const host = origins[0] ? new URL(origins[0]).host : "";
  return host.endsWith(".livekit.cloud")
    ? [...origins, "wss://*.livekit.cloud", "https://*.livekit.cloud"]
    : origins;
}

function httpOrigin(raw: string | undefined): string[] {
  return serviceOrigins(raw).filter((origin) => origin.startsWith("http"));
}

/** Origen de ingesta del DSN de Sentry (F-12): sin él, la CSP bloquea el envío. */
function sentryOrigin(dsn: string | undefined): string[] {
  if (!dsn) return [];
  try {
    const url = new URL(dsn);
    return [`${url.protocol}//${url.host}`];
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Origen del script de Plausible: el SaaS por defecto o un self-host propio. */
function plausibleOrigin(rawSrc: string | undefined): string[] {
  const src = rawSrc?.trim() || "https://plausible.io/js/script.js";
  try {
    return [new URL(src).origin];
  } catch {
    return [];
  }
}

/** Dominios de Google Analytics 4 / Google Tag Manager (gtag.js los usa juntos). */
const GOOGLE_TAG_MANAGER_ORIGIN = "https://www.googletagmanager.com";
const GOOGLE_ANALYTICS_CONNECT_ORIGINS = [
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  GOOGLE_TAG_MANAGER_ORIGIN,
];

/**
 * Endpoint de reporte de violaciones de CSP de Sentry (A-23), construido a
 * partir del DSN (https://docs.sentry.io/security-legal-pii/security/csp/):
 * `{protocolo}//{host}/api/{projectId}/security/?sentry_key={clave}`.
 */
function sentryReportUri(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\//u, "");
    if (!key || !projectId) return null;
    return `${url.protocol}//${url.host}/api/${projectId}/security/?sentry_key=${key}`;
  } catch {
    return null;
  }
}

const CSP_REPORT_GROUP = "csp-endpoint";

/**
 * Valor de la cabecera `Report-To` (RFC 9116-adyacente, la que consume la
 * directiva `report-to` de la CSP) — `null` sin Sentry configurado.
 */
export function reportToHeaderValue(dsn: string | undefined): string | null {
  const uri = sentryReportUri(dsn);
  if (!uri) return null;
  return JSON.stringify({ group: CSP_REPORT_GROUP, max_age: 10886400, endpoints: [{ url: uri }] });
}

/** Cabecera de la petición con su nonce, por si un Server Component lo necesita. */
export const NONCE_HEADER = "x-nonce";

/**
 * Nonce por petición (128 bits en base64). Web Crypto: vale en el runtime de
 * `proxy.ts` y en Node.
 */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * CSP de las páginas. `script-src` es estricta: solo scripts con el nonce de la
 * petición y lo que ellos carguen (`'strict-dynamic'`: los chunks de Next,
 * Phaser y el editor). Sin `'unsafe-inline'` ni `'unsafe-eval'` para scripts
 * fuera de desarrollo (React en dev necesita `eval` para sus trazas).
 */
export function buildContentSecurityPolicy(nonce: string, env: SecurityEnv = {}): string {
  const dev = env.NODE_ENV === "development";
  const storage = httpOrigin(env.STORAGE_ENDPOINT);
  // A-23: los `localhost` por defecto son solo para dev — sin la variable en
  // producción, la CSP no debe autorizar `ws://localhost:2567` (antes lo
  // hacía siempre, con o sin `NEXT_PUBLIC_COLYSEUS_URL`).
  const realtime = unique([
    ...serviceOrigins(env.NEXT_PUBLIC_COLYSEUS_URL || (dev ? DEFAULT_COLYSEUS_URL : undefined)),
    ...serviceOrigins(env.NEXT_PUBLIC_EDITOR_SYNC_URL || (dev ? DEFAULT_EDITOR_SYNC_URL : undefined)),
    ...liveKitOrigins(env.NEXT_PUBLIC_LIVEKIT_URL || env.LIVEKIT_URL),
  ]);
  const extraConnect = (env.CSP_EXTRA_CONNECT_SRC ?? "").split(/\s+/u).filter(Boolean);
  const sentry = sentryOrigin(env.NEXT_PUBLIC_SENTRY_DSN);
  // Plausible/GA solo entran en la CSP si sus variables están configuradas
  // (docs/DEUDA.md «Claves reales de analítica antes de desplegar en producción»).
  const plausible = env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN
    ? plausibleOrigin(env.NEXT_PUBLIC_PLAUSIBLE_SRC)
    : [];
  const googleAnalyticsScript = env.NEXT_PUBLIC_GA_MEASUREMENT_ID
    ? [GOOGLE_TAG_MANAGER_ORIGIN]
    : [];
  const googleAnalyticsConnect = env.NEXT_PUBLIC_GA_MEASUREMENT_ID
    ? GOOGLE_ANALYTICS_CONNECT_ORIGINS
    : [];

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        ...(dev ? ["'unsafe-eval'"] : []),
        ...plausible,
        ...googleAnalyticsScript,
      ],
    ],
    // Estilos en línea: atributos `style` de React (paneles, editor de nodos)
    // y el CSS de next/font. No ejecutan código.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // `data:`/`blob:`: texturas por defecto de Phaser y miniaturas generadas.
    ["img-src", ["'self'", "data:", "blob:", ...storage]],
    ["font-src", ["'self'", "data:"]],
    ["media-src", ["'self'", "data:", "blob:", ...storage]],
    [
      "connect-src",
      unique([
        "'self'",
        ...realtime,
        ...storage,
        ...sentry,
        ...plausible,
        ...googleAnalyticsConnect,
        ...extraConnect,
      ]),
    ],
    // Los workers de LiveKit (cifrado E2EE) se crean desde `blob:`.
    ["worker-src", ["'self'", "blob:"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // El login con Google redirige a su pantalla de consentimiento.
    ["form-action", ["'self'", "https://accounts.google.com"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!dev) policy.push("upgrade-insecure-requests");
  // A-23: con Sentry configurado, las violaciones de CSP se reportan (antes
  // no había `report-to`/`report-uri`: el navegador las descartaba en silencio).
  const reportUri = sentryReportUri(env.NEXT_PUBLIC_SENTRY_DSN);
  if (reportUri) {
    policy.push(`report-to ${CSP_REPORT_GROUP}`);
    policy.push(`report-uri ${reportUri}`);
  }
  return policy.join("; ");
}

/** CSP de las respuestas de API (JSON): no cargan nada ni se pueden enmarcar. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/**
 * Cabeceras fijas de TODAS las respuestas (páginas, API, estáticos). HSTS solo
 * en producción: en dev obligaría al navegador a HTTPS en `localhost`.
 */
export function staticSecurityHeaders(
  env: SecurityEnv = {},
): Array<{ key: string; value: string }> {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    // Cámara y micro solo para la propia web (LiveKit, specs/12); lo demás, fuera.
    {
      key: "Permissions-Policy",
      value:
        "camera=(self), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // A-23: nada de esta API/web se sirve para ser cargado desde otro origen.
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ...(env.NODE_ENV === "production"
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
      : []),
    ...(reportToHeaderValue(env.NEXT_PUBLIC_SENTRY_DSN)
      ? [{ key: "Report-To", value: reportToHeaderValue(env.NEXT_PUBLIC_SENTRY_DSN)! }]
      : []),
  ];
}
