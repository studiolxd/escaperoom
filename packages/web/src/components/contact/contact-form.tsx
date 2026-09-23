"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Formulario de contacto público (placeholder, ticket layout-publico-header-footer):
 * no hay backend de contacto todavía, así que solo valida en el cliente y
 * muestra un mensaje de éxito. Sustituir por un envío real (email, ticket,
 * CRM…) cuando exista destino.
 */
export function ContactForm() {
  const t = useTranslations("Contact");
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-card-foreground">
        {t("success")}
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="contact-name">{t("nameLabel")}</Label>
        <Input id="contact-name" name="name" required autoComplete="name" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-email">{t("emailLabel")}</Label>
        <Input id="contact-email" name="email" type="email" required autoComplete="email" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-message">{t("messageLabel")}</Label>
        <Textarea id="contact-message" name="message" required rows={5} />
      </div>

      <Button type="submit">{t("submit")}</Button>

      <p className="text-xs text-muted-foreground">{t("placeholderNotice")}</p>
    </form>
  );
}
