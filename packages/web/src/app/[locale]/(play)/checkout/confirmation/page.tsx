import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";

type PurchaseKind = "room" | "room_license" | "event_credits";
const PURCHASE_KINDS: ReadonlySet<string> = new Set(["room", "room_license", "event_credits"]);

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string; status?: string; eventId?: string; roomId?: string }>;
};

/** Página personal (destino de un redirect de Stripe): nunca se indexa. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

function continueHref(locale: string, type: PurchaseKind | null, eventId?: string, roomId?: string): string {
  switch (type) {
    case "event_credits":
      return eventId ? `/${locale}/events/${eventId}` : `/${locale}/creator`;
    case "room_license":
      return `/${locale}/creator`;
    case "room":
    default:
      return roomId ? `/${locale}/rooms/${roomId}` : `/${locale}/rooms`;
  }
}

/**
 * Confirmación tras un Checkout de Stripe (ticket 5.1, specs/13 §5, §6.1,
 * §4.2): destino de `success_url`/`cancel_url` de los tres checkouts
 * (`room`, `room_license`, `event_credits`). El pago ya se liquidó (o no) en
 * el webhook antes de que el navegador llegue aquí; esta página solo informa
 * y ofrece el siguiente paso — no consulta el estado de ninguna compra.
 */
export default async function CheckoutConfirmationPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { type: rawType, status, eventId, roomId } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Checkout");

  const type = (rawType && PURCHASE_KINDS.has(rawType) ? rawType : null) as PurchaseKind | null;
  const success = status === "success";
  const href = continueHref(locale, type, eventId, roomId);
  const kindLabel = t(type ? `kinds.${type}` : "kinds.generic");

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-white">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            {success ? (
              <CheckCircle2 className="size-6 text-emerald-600" aria-hidden />
            ) : (
              <XCircle className="size-6 text-destructive" aria-hidden />
            )}
            <CardTitle>{t(success ? "success.title" : "cancelled.title")}</CardTitle>
          </div>
          <CardDescription>
            {t(success ? "success.description" : "cancelled.description", { kind: kindLabel })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild>
            <Link href={href}>{t(success ? "success.cta" : "cancelled.retryCta")}</Link>
          </Button>
          {!success && (
            <Button asChild variant="ghost">
              <Link href={`/${locale}/rooms`}>{t("cancelled.backCta")}</Link>
            </Button>
          )}
        </CardContent>
      </Card>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
