"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmailSignIn } from "@/components/auth/use-email-sign-in";

/**
 * Login del wizard de onboarding (ticket 6.7, specs/20 §1 "Registro"): Google
 * o enlace mágico por email, igual que `ConsentLogin` (4.7) pero con destino
 * al propio wizard en vez del consentimiento del MCP.
 */
export function OnboardingLogin({ callbackURL }: { callbackURL: string }) {
  const t = useTranslations("Onboarding.loginRequired");
  const {
    register,
    onSubmit,
    signInWithGoogle,
    status,
    formState: { errors },
  } = useEmailSignIn({ callbackURL, emailInvalidMessage: t("emailInvalid") });

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground">
      <p className="text-sm">{t("intro")}</p>
      <Button type="button" onClick={signInWithGoogle} disabled={status === "sending"}>
        {t("google")}
      </Button>
      <form noValidate onSubmit={onSubmit} className="space-y-2">
        <Label htmlFor="onboarding-login-email" className="text-sm">
          {t("emailLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="onboarding-login-email"
            type="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "onboarding-login-email-error" : undefined}
            className="h-auto min-w-0 flex-1 rounded-lg px-3 py-1.5 text-sm"
            {...register("email")}
          />
          <Button type="submit" variant="outline" disabled={status === "sending"}>
            {t("emailSubmit")}
          </Button>
        </div>
        <FieldError id="onboarding-login-email-error" className="text-xs" errors={[errors.email]} />
        {status === "sent" && (
          <p role="status" className="text-xs text-emerald-600">
            {t("emailSent")}
          </p>
        )}
        {status === "error" && (
          <p role="alert" className="text-xs text-destructive">
            {t("error")}
          </p>
        )}
      </form>
    </div>
  );
}
