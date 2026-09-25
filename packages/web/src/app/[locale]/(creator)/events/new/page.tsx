import { isAnonymous } from "@escaperoom/shared/services";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { NewEventForm } from "@/components/events/new-event-form";
import { OnboardingLogin } from "@/components/onboarding/onboarding-login";
import { resolveActorFromHeaders } from "@/server/context";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ roomVersionId?: string | string[] }>;
};

/** Área privada del organizador: nunca se indexa. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * "Organizar un evento con esta sala" (punto h de "CTA Jugar",
 * `docs/DEUDA.md`): flujo MÍNIMO de creación — título y jugadores, con el
 * precio por jugador visible (specs/02 §3.1). `createEvent` (`events.ts`)
 * valida `saleEvents`/autoría; esta página solo exige sesión y un
 * `roomVersionId` con forma de UUID, y deja la configuración fina (sesiones
 * simultáneas, agrupación, confirmación) al panel del organizador existente
 * (`/events/:id`), a donde redirige tras crear el evento.
 */
export default async function NewEventPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { roomVersionId } = await searchParams;
  const version = typeof roomVersionId === "string" ? roomVersionId : undefined;
  if (!version || !UUID_RE.test(version)) notFound();

  const actor = await resolveActorFromHeaders(await headers());
  const t = await getTranslations({ locale, namespace: "NewEvent" });

  if (isAnonymous(actor)) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <OnboardingLogin callbackURL={`/${locale}/events/new?roomVersionId=${version}`} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">{t("heading")}</h1>
      <NewEventForm roomVersionId={version} />
    </main>
  );
}
