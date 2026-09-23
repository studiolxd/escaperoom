import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isAnonymous } from "@escaperoom/shared/services";
import { Link, redirect } from "@/i18n/navigation";
import { resolveActorFromHeaders } from "@/server/context";
import { getTermsAcceptanceService } from "@/server/services";
import { AcceptTermsButton } from "@/components/legal/accept-terms-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
};

/** Pantalla de reaceptación: nunca se indexa (como el resto de páginas de sesión). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const DEFAULT_NEXT = "/";

/** Solo admite rutas internas relativas: evita usar `next` como redirección abierta. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return DEFAULT_NEXT;
  return next;
}

/**
 * `/legal/reaccept` (gate de reaceptación de términos/privacidad): un usuario
 * con sesión cuya `termsAcceptedVersion` no coincide con la vigente aterriza
 * aquí (ver `layout.tsx` de `(creator)` y `(play)`) y no puede seguir hasta
 * aceptar. Sin sesión, o ya al día, no hay nada que hacer: se manda a `next`.
 */
export default async function ReacceptTermsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = safeNext((await searchParams).next);

  const actor = await resolveActorFromHeaders(await headers());
  if (isAnonymous(actor)) redirect({ href: next, locale });

  const status = await getTermsAcceptanceService().getStatus(actor.userId);
  if (!status.needsAcceptance) redirect({ href: next, locale });

  const t = await getTranslations("Legal.reaccept");

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md items-center px-4 py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-1 text-sm underline underline-offset-4">
            <li>
              <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">
                {t("termsLink")}
              </Link>
            </li>
            <li>
              <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">
                {t("privacyLink")}
              </Link>
            </li>
          </ul>
          <AcceptTermsButton next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
