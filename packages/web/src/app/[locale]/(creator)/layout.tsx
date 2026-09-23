import type { ReactNode } from "react";
import { headers } from "next/headers";
import { isAnonymous } from "@escaperoom/shared/services";
import { redirect } from "@/i18n/navigation";
import { resolveActorFromHeaders } from "@/server/context";
import { getTermsAcceptanceService } from "@/server/services";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

/**
 * Gate de reaceptación de Términos/Privacidad para el área de creador. Solo
 * afecta a quien tiene sesión: un visitante anónimo sigue a la página, que
 * decide por su cuenta si pide login (p. ej. `OnboardingLogin`). Con sesión y
 * `termsAcceptedVersion` desactualizada (o nula), no hay paso intermedio: se
 * manda a `/legal/reaccept` antes de renderizar nada de `(creator)`.
 */
export default async function CreatorLayout({ children, params }: Props) {
  const { locale } = await params;
  const actor = await resolveActorFromHeaders(await headers());

  if (!isAnonymous(actor)) {
    const status = await getTermsAcceptanceService().getStatus(actor.userId);
    if (status.needsAcceptance) redirect({ href: "/legal/reaccept", locale });
  }

  return <>{children}</>;
}
