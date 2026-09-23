import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { RedeemForm } from "@/components/redeem/redeem-form";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string | string[] }>;
};

/** Página personal (lleva la clave en la URL): nunca se indexa. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Canje de una clave de acceso (ticket 5.8, specs/13 §6.2). Es el destino del
 * QR de las tarjetas-clave en PDF (`/{locale}/redeem?code=…`, ticket 5.7), que
 * hasta el ticket 6.5 daba 404. Pública: el invitado puede no tener cuenta.
 */
export default async function RedeemPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { code } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Redeem");

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-white">
      <section className="w-full max-w-md space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-white/70">{t("intro")}</p>
        <RedeemForm initialCode={typeof code === "string" ? code : ""} />
      </section>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
