"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmailSignIn } from "@/components/auth/use-email-sign-in";

export interface OrganizationInvitationLoginProps {
  /** Ruta a la que vuelve Better Auth tras el login (esta misma página). */
  callbackURL: string;
  /** Email de la invitación, para no obligar a teclearlo otra vez. */
  defaultEmail?: string;
}

/**
 * Login dentro de la página de aceptar invitación a organización (A-8): mismo
 * flujo sin contraseña (Google o enlace mágico) que `ConsentLogin`
 * (`components/mcp-oauth/consent-login.tsx`), vía `useEmailSignIn`.
 */
export function OrganizationInvitationLogin({
  callbackURL,
  defaultEmail,
}: OrganizationInvitationLoginProps) {
  const t = useTranslations("OrganizationInvitation.login");
  const {
    register,
    onSubmit,
    signInWithGoogle,
    status,
    formState: { errors },
  } = useEmailSignIn({ callbackURL, emailInvalidMessage: t("emailInvalid"), defaultEmail });

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/80">{t("intro")}</p>
      <Button
        type="button"
        variant="overlay"
        onClick={signInWithGoogle}
        disabled={status === "sending"}
      >
        {t("google")}
      </Button>
      <form noValidate onSubmit={onSubmit} className="space-y-2">
        <Label htmlFor="org-invitation-email" className="text-sm">
          {t("emailLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="org-invitation-email"
            type="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "org-invitation-email-error" : undefined}
            className="h-auto min-w-0 flex-1 rounded-lg border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white"
            {...register("email")}
          />
          <Button type="submit" disabled={status === "sending"}>
            {t("emailSubmit")}
          </Button>
        </div>
        <FieldError id="org-invitation-email-error" className="text-red-300" errors={[errors.email]} />
      </form>
      {status === "sent" && (
        <p role="status" className="text-sm text-emerald-300">
          {t("emailSent")}
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="text-sm text-red-300">
          {t("error")}
        </p>
      )}
    </div>
  );
}
