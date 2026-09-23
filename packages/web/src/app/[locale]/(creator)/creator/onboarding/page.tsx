import { isAnonymous } from "@escaperoom/shared/services";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { OnboardingLogin } from "@/components/onboarding/onboarding-login";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { resolveActorFromHeaders } from "@/server/context";

type Props = { params: Promise<{ locale: string }> };

/** Área privada del creador: nunca se indexa (igual que `creator/chat`, ticket 4.6). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Wizard de onboarding del creador (ticket 6.7, specs/20 §1 §2): registro
 * primero (Google o enlace mágico), después los 5 pasos guiados. Objetivo:
 * primera sala publicada en <30 min (specs/20 §5).
 */
export default async function CreatorOnboardingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await resolveActorFromHeaders(await headers());

  if (isAnonymous(actor)) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <OnboardingLogin callbackURL={`/${locale}/creator/onboarding`} />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-background">
      <OnboardingWizard />
    </main>
  );
}
