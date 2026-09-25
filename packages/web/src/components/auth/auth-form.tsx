"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { useEmailSignIn } from "./use-email-sign-in";

/** Conserva `callbackURL` al cambiar entre login/sign up (por defecto "/", no hace falta arrastrarlo). */
function switchHref(path: "/login" | "/signup", callbackURL: string): string {
  return callbackURL === "/" ? path : `${path}?callbackURL=${encodeURIComponent(callbackURL)}`;
}

export interface AuthFormProps extends React.ComponentProps<"div"> {
  mode: "login" | "signup";
  /** Ruta a la que vuelve Better Auth tras el login (por defecto, home). */
  callbackURL?: string;
}

/**
 * Formulario compartido de login y sign up (adaptado del bloque `login-04`
 * de shadcn — specs/pendiente). No hay contraseña: Better Auth
 * (`lib/auth.ts`) solo tiene Google OAuth y enlace mágico, y crea la cuenta
 * automáticamente en el primer uso, así que login y sign up son el mismo
 * flujo y solo cambia el copy de alrededor.
 */
export function AuthForm({ mode, callbackURL = "/", className, ...props }: AuthFormProps) {
  const t = useTranslations("Auth");
  const {
    register,
    onSubmit,
    signInWithGoogle,
    status,
    formState: { errors },
  } = useEmailSignIn({ callbackURL, emailInvalidMessage: t("emailInvalid") });

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardContent>
          <form noValidate onSubmit={onSubmit}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">{t(`${mode}.title`)}</h1>
                <p className="text-balance text-muted-foreground">{t(`${mode}.subtitle`)}</p>
              </div>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="auth-email">{t("emailLabel")}</FieldLabel>
                <Input
                  id="auth-email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  disabled={status === "sending"}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "auth-email-error" : undefined}
                  {...register("email")}
                />
                <FieldError id="auth-email-error" errors={[errors.email]} />
              </Field>
              <Field>
                <Button type="submit" disabled={status === "sending"}>
                  {t("emailSubmit")}
                </Button>
              </Field>
              {status === "sent" && (
                <p role="status" className="text-center text-sm text-emerald-600">
                  {t("emailSent")}
                </p>
              )}
              {status === "error" && (
                <p role="alert" className="text-center text-sm text-destructive">
                  {t("error")}
                </p>
              )}
              <FieldSeparator>{t("continueWith")}</FieldSeparator>
              <Field>
                <Button
                  variant="outline"
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={status === "sending"}
                >
                  {t("google")}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                {mode === "login" ? (
                  <>
                    {t("switchToSignupPrompt")}{" "}
                    <Link href={switchHref("/signup", callbackURL)}>{t("switchToSignupLink")}</Link>
                  </>
                ) : (
                  <>
                    {t("switchToLoginPrompt")}{" "}
                    <Link href={switchHref("/login", callbackURL)}>{t("switchToLoginLink")}</Link>
                  </>
                )}
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
