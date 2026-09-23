import { isAnonymous } from "@escaperoom/shared/services";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { OnboardingLogin } from "@/components/onboarding/onboarding-login";
import { PayoutsPanel } from "@/components/payouts/payouts-panel";
import { resolveActorFromHeaders } from "@/server/context";

type Props = { params: Promise<{ locale: string }> };

/** Área privada del creador: nunca se indexa (igual que `creator/onboarding`). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `/creator/payouts` (ticket 5.1, specs/02 §2, specs/13 §2): estado del
 * onboarding de Stripe Connect del creador y el CTA para completarlo o
 * abrir el dashboard Express una vez completo.
 */
export default async function CreatorPayoutsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await resolveActorFromHeaders(await headers());
  const t = await getTranslations("Payouts");

  if (isAnonymous(actor)) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <OnboardingLogin callbackURL={`/${locale}/creator/payouts`} />
      </main>
    );
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-lg font-semibold">{t("pageTitle")}</h1>
        <PayoutsPanel />
      </div>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
