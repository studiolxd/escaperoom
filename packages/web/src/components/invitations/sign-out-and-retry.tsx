"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Cierra la sesión actual y recarga (A-8: invitación aceptada por una sesión
 * con otro email) para que la persona pueda volver a entrar con el email
 * invitado desde el formulario que aparece sin sesión.
 */
export function SignOutAndRetry() {
  const t = useTranslations("OrganizationInvitation");
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } finally {
      window.location.reload();
    }
  };

  return (
    <Button type="button" variant="overlay" disabled={signingOut} onClick={() => void signOut()}>
      {t("signOutCta")}
    </Button>
  );
}
