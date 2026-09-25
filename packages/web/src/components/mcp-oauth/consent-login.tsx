"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmailSignIn } from "@/components/auth/use-email-sign-in";

export interface ConsentLoginProps {
  /** Ruta a la que vuelve Better Auth tras el login (el propio consentimiento). */
  callbackURL: string;
}

/**
 * Login con Better Auth dentro del consentimiento OAuth del MCP (ticket 4.7):
 * Google o enlace mágico por email (los métodos de `lib/auth.ts`). Al volver,
 * la pantalla ya tiene sesión y muestra el formulario de consentimiento.
 */
export function ConsentLogin({ callbackURL }: ConsentLoginProps) {
  const t = useTranslations("McpConsent.login");
  const {
    register,
    onSubmit,
    signInWithGoogle,
    status,
    formState: { errors },
  } = useEmailSignIn({ callbackURL, emailInvalidMessage: t("emailInvalid") });

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
        <Label htmlFor="mcp-consent-email" className="text-sm">
          {t("emailLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="mcp-consent-email"
            type="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "mcp-consent-email-error" : undefined}
            className="h-auto min-w-0 flex-1 rounded-lg border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white"
            {...register("email")}
          />
          <Button type="submit" disabled={status === "sending"}>
            {t("emailSubmit")}
          </Button>
        </div>
        <FieldError id="mcp-consent-email-error" className="text-red-300" errors={[errors.email]} />
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
