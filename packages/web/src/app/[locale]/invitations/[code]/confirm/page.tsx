import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ConfirmAttendance } from "@/components/invitations/confirm-attendance";

type Props = {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
};

/** Enlace personal del email: nunca se indexa. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Página del enlace de confirmación del email de invitación (ticket 5.6,
 * specs/02 §4.4). Pública: el asistente puede no tener cuenta. La firma y la
 * caducidad del token las comprueba `POST /api/access-keys/:code/confirm`.
 */
export default async function ConfirmInvitationPage({ params, searchParams }: Props) {
  const { locale, code: rawCode } = await params;
  const { token } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("InvitationConfirm");
  const code = decodeURIComponent(rawCode);

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-white">
      <section className="w-full max-w-md space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-white/70">{t("intro")}</p>
        <p className="font-mono text-xl tracking-widest" aria-label={t("keyLabel")}>
          {code}
        </p>
        {typeof token === "string" && token.length > 0 ? (
          <ConfirmAttendance code={code} token={token} />
        ) : (
          <p role="alert" className="text-sm text-red-300">
            {t("errors.CONFIRMATION_INVALID")}
          </p>
        )}
      </section>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
