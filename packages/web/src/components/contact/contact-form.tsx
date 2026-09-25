"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { sendContactMessage } from "@/actions/contact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

/**
 * Límites en sincronía con `ContactMessageInput`
 * (`@escaperoom/shared/services/contact.ts`), la validación real que corre en
 * `sendContactMessage`; aquí solo se repiten para dar feedback inmediato con
 * los textos traducidos (el servicio no traduce sus mensajes).
 */
function useContactSchema() {
  const t = useTranslations("Contact.errors");
  return z.object({
    name: z.string().trim().min(1, t("nameRequired")).max(200, t("nameTooLong")),
    email: z
      .string()
      .trim()
      .min(1, t("emailRequired"))
      .max(320, t("emailTooLong"))
      .pipe(z.email(t("emailInvalid"))),
    message: z.string().trim().min(1, t("messageRequired")).max(5000, t("messageTooLong")),
  });
}

type ContactFormValues = z.infer<ReturnType<typeof useContactSchema>>;

/** Formulario de contacto público: server action `sendContactMessage`. */
export function ContactForm() {
  const t = useTranslations("Contact");
  const schema = useContactSchema();
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { name: "", email: "", message: "" },
  });

  if (success) {
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-card-foreground">
        {t("success")}
      </p>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await sendContactMessage(values);
    if (result.ok) {
      setSuccess(true);
      return;
    }
    if (result.error.issues && result.error.issues.length > 0) {
      for (const issue of result.error.issues) {
        const field = issue.path as keyof ContactFormValues;
        if (field === "name" || field === "email" || field === "message") {
          setError(field, { message: issue.message });
        }
      }
      return;
    }
    setFormError(t("error"));
  });

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="contact-name">{t("nameLabel")}</FieldLabel>
          <Input
            id="contact-name"
            autoComplete="name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "contact-name-error" : undefined}
            {...register("name")}
          />
          <FieldError id="contact-name-error" errors={[errors.name]} />
        </Field>

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="contact-email">{t("emailLabel")}</FieldLabel>
          <Input
            id="contact-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "contact-email-error" : undefined}
            {...register("email")}
          />
          <FieldError id="contact-email-error" errors={[errors.email]} />
        </Field>

        <Field data-invalid={!!errors.message}>
          <FieldLabel htmlFor="contact-message">{t("messageLabel")}</FieldLabel>
          <Textarea
            id="contact-message"
            rows={5}
            aria-invalid={!!errors.message}
            aria-describedby={errors.message ? "contact-message-error" : undefined}
            {...register("message")}
          />
          <FieldError id="contact-message-error" errors={[errors.message]} />
        </Field>
      </FieldGroup>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("sending") : t("submit")}
        </Button>
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
      </div>
    </form>
  );
}
