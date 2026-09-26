import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { APIError } from "better-auth";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { AcceptOrganizationInvitation } from "@/components/invitations/accept-organization-invitation";
import { OrganizationInvitationLogin } from "@/components/invitations/organization-invitation-login";
import { SignOutAndRetry } from "@/components/invitations/sign-out-and-retry";
import { auth } from "@/lib/auth";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

/** Enlace personal del email: nunca se indexa. */
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Página de aceptar/rechazar una invitación a organización (A-8): el plugin
 * `organization()` de Better Auth no tiene una pantalla propia (sus rutas
 * `get-invitation`/`accept-invitation` son JSON con sesión, no páginas), así
 * que esta es la que enlaza el email de invitación
 * (`lib/auth.ts#sendInvitationEmail`). Contempla invitado sin cuenta (login
 * y vuelta aquí), caducada/ya usada/inexistente, y sesión con email distinto
 * del invitado.
 */
export default async function AcceptOrganizationInvitationPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("OrganizationInvitation");

  const requestHeaders = await headers();
  const callbackURL = `/${locale}/invitations/organization/${id}/accept`;
  const homeHref = `/${locale}`;

  const session = await auth.api.getSession({ headers: requestHeaders }).catch(() => null);

  let body: ReactNode;
  if (!session) {
    body = (
      <>
        <p className="text-sm text-white/70">{t("intro")}</p>
        <OrganizationInvitationLogin callbackURL={callbackURL} />
      </>
    );
  } else {
    try {
      const invitation = await auth.api.getInvitation({ query: { id }, headers: requestHeaders });
      body = (
        <>
          <p className="text-sm text-white/70">
            {t("details", {
              inviter: invitation.inviterEmail,
              organization: invitation.organizationName,
              role: invitation.role ?? "member",
            })}
          </p>
          <p className="text-xs text-white/50">{t("signedInAs", { email: session.user.email })}</p>
          <AcceptOrganizationInvitation invitationId={id} homeHref={homeHref} />
        </>
      );
    } catch (error) {
      const code = error instanceof APIError ? (error.body as { code?: string } | undefined)?.code : undefined;
      if (code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION") {
        body = (
          <>
            <p role="alert" className="text-sm text-red-300">
              {t("wrongRecipient", { current: session.user.email })}
            </p>
            <SignOutAndRetry />
          </>
        );
      } else if (error instanceof APIError && error.status === "BAD_REQUEST") {
        body = (
          <p role="alert" className="text-sm text-red-300">
            {t("notFound")}
          </p>
        );
      } else {
        body = (
          <p role="alert" className="text-sm text-red-300">
            {t("genericError")}
          </p>
        );
      }
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-white">
      <section className="w-full max-w-md space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        {body}
      </section>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
