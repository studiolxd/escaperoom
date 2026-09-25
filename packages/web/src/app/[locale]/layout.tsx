import type { ReactNode } from "react";
import { Geist } from "next/font/google";
import { cookies, headers } from "next/headers";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cn } from "@/lib/utils";
import { routing } from "@/i18n/routing";
import { ConsentProvider } from "@/components/consent/consent-provider";
import { CookieBanner, CookiePreferencesDialog } from "@/components/consent/cookie-consent-ui";
import { PlausibleScript } from "@/components/analytics/plausible-script";
import { GoogleAnalyticsScript } from "@/components/analytics/google-analytics-script";
import { NONCE_HEADER } from "@/lib/security-headers";
import { DEFAULT_THEME, isTheme, THEME_COOKIE_NAME, THEME_INIT_SCRIPT } from "@/lib/theme";
import "../globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Props["params"] }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("title"), description: t("description") };
}

/**
 * Layout raíz del App Router para el segmento `[locale]` (specs/03 §1): valida
 * el idioma y expone los mensajes a los Client Components vía
 * `NextIntlClientProvider`.
 *
 * Renderizado dinámico (ticket 6.3): la CSP lleva un nonce por petición
 * (`src/proxy.ts`) y Next solo lo pone en sus `<script>` al renderizar la
 * petición; una página prerenderizada en el build saldría sin nonce y la CSP
 * bloquearía su JavaScript. `connection()` lo fuerza para todo el segmento.
 *
 * Tema (claro/oscuro/sistema, ver `lib/theme.ts`): para "light"/"dark"
 * explícitos, la clase `dark` de `<html>` ya sale correcta del servidor. Para
 * "system" (por defecto) hace falta `THEME_INIT_SCRIPT`, que resuelve
 * `prefers-color-scheme` en el cliente antes del primer pintado — de ahí el
 * `nonce` (la CSP no permite `unsafe-inline`) y `suppressHydrationWarning`
 * (el script puede cambiar la clase de `<html>` respecto a lo que renderizó
 * el servidor).
 */
export default async function LocaleLayout({ children, params }: Props) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();
  const themeCookie = (await cookies()).get(THEME_COOKIE_NAME)?.value;
  const theme = isTheme(themeCookie) ? themeCookie : DEFAULT_THEME;
  // Un único nonce por petición para el script de tema y los de analítica.
  const nonce = (await headers()).get(NONCE_HEADER) ?? "";
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <html
      lang={locale}
      className={cn("font-sans", geist.variable, theme === "dark" && "dark")}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider messages={messages}>
          <ConsentProvider>
            {children}
            <CookieBanner />
            <CookiePreferencesDialog />
            <PlausibleScript nonce={nonce} />
            {gaMeasurementId ? (
              <GoogleAnalyticsScript measurementId={gaMeasurementId} nonce={nonce} />
            ) : null}
          </ConsentProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
