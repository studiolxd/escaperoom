"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error" };

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
  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");

  const signInWithGoogle = async () => {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL }),
      });
      const json = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !json?.url) throw new Error("sin url");
      window.location.href = json.url;
    } catch {
      setState({ kind: "error" });
    }
  };

  const sendMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, callbackURL }),
      });
      setState(res.ok ? { kind: "sent" } : { kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardContent>
          <form onSubmit={sendMagicLink}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">{t(`${mode}.title`)}</h1>
                <p className="text-balance text-muted-foreground">{t(`${mode}.subtitle`)}</p>
              </div>
              <Field>
                <FieldLabel htmlFor="auth-email">{t("emailLabel")}</FieldLabel>
                <Input
                  id="auth-email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={state.kind === "sending"}
                />
              </Field>
              <Field>
                <Button type="submit" disabled={state.kind === "sending"}>
                  {t("emailSubmit")}
                </Button>
              </Field>
              {state.kind === "sent" && (
                <p role="status" className="text-center text-sm text-emerald-600">
                  {t("emailSent")}
                </p>
              )}
              {state.kind === "error" && (
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
                  disabled={state.kind === "sending"}
                >
                  {t("google")}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                {mode === "login" ? (
                  <>
                    {t("switchToSignupPrompt")} <Link href="/signup">{t("switchToSignupLink")}</Link>
                  </>
                ) : (
                  <>
                    {t("switchToLoginPrompt")} <Link href="/login">{t("switchToLoginLink")}</Link>
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
