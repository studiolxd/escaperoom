"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

export type EmailSignInStatus = "idle" | "sending" | "sent" | "error";

type EmailFormValues = { email: string };

/**
 * Login sin contraseña (Better Auth: Google + enlace mágico) compartido por
 * `AuthForm`, `ConsentLogin` y `OnboardingLogin` — mismo flujo triplicado con
 * distinto envoltorio visual (señalado en `docs/DEUDA.md`): centraliza el
 * envío a las rutas de Better Auth (`/api/auth/sign-in/*`, con su propio
 * rate limiting y CSRF — no son server actions de `@escaperoom/shared`, así
 * que no hay servicio propio que envolver aquí) y la validación de RHF/Zod;
 * el copy y el marcado (tema oscuro/claro, `Field` vs `Label`) siguen en
 * cada componente.
 */
export function useEmailSignIn({
  callbackURL,
  emailInvalidMessage,
  defaultEmail = "",
}: {
  callbackURL: string;
  emailInvalidMessage: string;
  defaultEmail?: string;
}) {
  const [status, setStatus] = useState<EmailSignInStatus>("idle");
  const schema = z.object({
    email: z.string().trim().min(1, emailInvalidMessage).pipe(z.email(emailInvalidMessage)),
  });

  const form = useForm<EmailFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: defaultEmail },
  });

  const signInWithGoogle = async () => {
    setStatus("sending");
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
      setStatus("error");
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus("sending");
    try {
      const res = await fetch("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email, callbackURL }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  });

  return { ...form, status, onSubmit, signInWithGoogle };
}
