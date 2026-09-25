import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
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
 * Lleva el header y el footer del resto de páginas públicas (`(public)`) en
 * vez de un chrome propio; idioma y tema ya viven en `PublicFooter`.
 */
export default async function RedeemPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { code } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Redeem");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-14">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("intro")}</p>

      <div className="mt-8 space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground">
        <RedeemForm initialCode={typeof code === "string" ? code : ""} />
      </div>
    </main>
  );
}
