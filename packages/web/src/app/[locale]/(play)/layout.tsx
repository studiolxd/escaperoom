import type { ReactNode } from "react";
import { headers } from "next/headers";
import { isAnonymous } from "@escaperoom/shared/services";
import { redirect } from "@/i18n/navigation";
import { resolveActorFromHeaders } from "@/server/context";
import { getTermsAcceptanceService } from "@/server/services";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

/**
 * Gate de reaceptación de Términos/Privacidad para el área de juego. Solo
 * afecta a quien tiene sesión: un invitado que entra con clave de acceso
 * (sin cuenta) nunca pasa por aquí como autenticado, así que su partida no se
 * ve afectada. Con sesión y `termsAcceptedVersion` desactualizada (o nula),
 * se manda a `/legal/reaccept` antes de renderizar nada de `(play)`.
 */
export default async function PlayLayout({ children, params }: Props) {
  const { locale } = await params;
  const actor = await resolveActorFromHeaders(await headers());

  if (!isAnonymous(actor)) {
    const status = await getTermsAcceptanceService().getStatus(actor.userId);
    if (status.needsAcceptance) redirect({ href: "/legal/reaccept", locale });
  }

  return <>{children}</>;
}
