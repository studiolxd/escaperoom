"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  RATE_LIMITED_ERROR,
  REDEEM_UNAVAILABLE_ERROR,
  type AccessKeyErrorCode,
} from "@escaperoom/shared/error-codes";
import { redeemAccessKey } from "@/actions/redeem";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { eventPlayPath } from "@/lib/game-net";

/** Códigos de error de `redeemAccessKey` con mensaje propio. */
export const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  ...([
    "ACCESS_KEY_INVALID",
    "ACCESS_KEY_USED",
    "ACCESS_KEY_EXPIRED",
    "ACCESS_KEY_NOT_CONFIRMED",
    "SESSION_FULL",
    "SESSION_REQUIRED",
  ] satisfies readonly AccessKeyErrorCode[]),
  RATE_LIMITED_ERROR,
  REDEEM_UNAVAILABLE_ERROR,
]);

function useRedeemSchema() {
  const t = useTranslations("Redeem.errors");
  return z.object({
    code: z.string().trim().min(1, t("codeRequired")).max(64, t("codeTooLong")),
    name: z.string().trim().max(32, t("nameTooLong")).optional(),
  });
}

type RedeemFormValues = z.infer<ReturnType<typeof useRedeemSchema>>;

export interface RedeemFormProps {
  /** Clave que trae el QR (`?code=`); el asistente también puede teclearla. */
  initialCode: string;
}

/**
 * Formulario de canje: clave + nombre visible → server action
 * `redeemAccessKey` (mismo `RedeemService` que la ruta REST) →
 * `/play?session=…#joinToken=…`. El `joinToken` viaja en el fragmento para
 * que no llegue a logs ni a `Referer`.
 */
export function RedeemForm({ initialCode }: RedeemFormProps) {
  const t = useTranslations("Redeem");
  const schema = useRedeemSchema();
  const locale = useLocale();
  const [serverErrorCode, setServerErrorCode] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RedeemFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: initialCode, name: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerErrorCode(null);
    const result = await redeemAccessKey({
      code: values.code,
      ...(values.name?.trim() ? { displayName: values.name.trim() } : {}),
    });
    if (!result.ok) {
      setServerErrorCode(result.error.code);
      return;
    }
    window.location.assign(
      `/${locale}${eventPlayPath(result.data.sessionId, result.data.joinToken)}`,
    );
  });

  return (
    <form noValidate className="space-y-4" onSubmit={onSubmit}>
      <Field data-invalid={!!errors.code}>
        <FieldLabel htmlFor="redeem-code">{t("codeLabel")}</FieldLabel>
        <Input
          id="redeem-code"
          autoComplete="off"
          spellCheck={false}
          className="font-mono uppercase tracking-widest"
          aria-invalid={!!errors.code}
          aria-describedby={errors.code ? "redeem-code-error" : undefined}
          {...register("code")}
        />
        <FieldError id="redeem-code-error" errors={[errors.code]} />
      </Field>
      <Field data-invalid={!!errors.name}>
        <FieldLabel htmlFor="redeem-name">{t("nameLabel")}</FieldLabel>
        <Input
          id="redeem-name"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "redeem-name-error" : undefined}
          {...register("name")}
        />
        <FieldError id="redeem-name-error" errors={[errors.name]} />
      </Field>
      {serverErrorCode ? (
        <p role="alert" className="text-sm text-destructive">
          {KNOWN_ERRORS.has(serverErrorCode) ? t(`errors.${serverErrorCode}`) : t("errors.UNKNOWN")}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t("redeeming") : t("cta")}
      </Button>
    </form>
  );
}
