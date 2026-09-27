"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useConsent } from "@/components/consent/consent-provider";
import { ACTIVE_OPTIONAL_CATEGORIES, hasConsentUI } from "@/lib/cookie-consent-config";

/**
 * Banda de consentimiento fija abajo (adaptada de `CookieBanner` de slxd,
 * repintada con shadcn/ui — ver CLAUDE.md). No pinta nada mientras
 * `hasConsentUI()` sea `false`: hoy no hay ninguna categoría opcional activa
 * (ver `cookie-consent-config.ts`), así que esto no le aparece a nadie
 * todavía.
 */
export function CookieBanner() {
  const t = useTranslations("CookieConsent.banner");
  const { ready, decided, acceptAll, rejectAll, openPreferences } = useConsent();

  if (!hasConsentUI() || !ready || decided) return null;

  return (
    <Card className="fixed bottom-4 right-4 z-50 max-w-xl [--card-spacing:--spacing(6)]">
      <CardContent className="flex flex-col gap-6">
        <p className="text-sm text-foreground">{t("description")}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="w-full sm:w-auto" onClick={openPreferences}>
            {t("preferences")}
          </Button>
          <Button className="w-full sm:w-auto" onClick={rejectAll}>
            {t("rejectAll")}
          </Button>
          <Button className="w-full sm:w-auto" onClick={acceptAll}>
            {t("acceptAll")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Enlace que reabre el panel de preferencias — para usar dentro de prosa
 * (la política de cookies) o en el pie de página. No navega: el `href` es un
 * ancla local y el click abre el diálogo vía `useConsent().openPreferences()`.
 * No pinta nada mientras `hasConsentUI()` sea `false`.
 */
export function CookieSettingsLink({ className }: { className?: string }) {
  const t = useTranslations("CookieConsent");
  const { openPreferences } = useConsent();

  if (!hasConsentUI()) return null;

  return (
    <a
      href="#cookie-preferences"
      className={className ?? "text-muted-foreground hover:text-foreground underline underline-offset-4"}
      onClick={(event) => {
        event.preventDefault();
        openPreferences();
      }}
    >
      {t("settingsLink")}
    </a>
  );
}

/**
 * Panel de preferencias por categorías (adaptado de `CookiePreferencesDialog`
 * de slxd sobre `Dialog`/`Switch` de shadcn). "Necesarias" siempre activa y
 * deshabilitada; el resto se conmuta y persiste al instante, sin un botón de
 * guardar aparte (igual que slxd).
 */
export function CookiePreferencesDialog() {
  const t = useTranslations("CookieConsent");
  const { categories, onChangeCategories, prefsOpen, setPrefsOpen } = useConsent();

  return (
    <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
      <DialogContent className="gap-6 p-6">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">{t("dialog.title")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                {t("categories.necessary.name")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("categories.necessary.description")}
              </p>
            </div>
            <Switch checked disabled aria-label={t("categories.necessary.name")} />
          </div>
          {ACTIVE_OPTIONAL_CATEGORIES.map((id) => (
            <div key={id} className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{t(`categories.${id}.name`)}</p>
                <p className="text-sm text-muted-foreground">
                  {t(`categories.${id}.description`)}
                </p>
              </div>
              <Switch
                checked={categories[id]}
                onCheckedChange={(checked) => onChangeCategories({ ...categories, [id]: checked })}
                aria-label={t(`categories.${id}.name`)}
              />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
