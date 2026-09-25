import { isDevFallbackAllowed } from "@escaperoom/env";
import { loadRoomPackage, toRuntimeModel } from "@escaperoom/game-runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { WorldPreviewShell } from "@/components/world-preview/world-preview-shell";
import { worldPreviewPackage } from "@/lib/world-preview-fixture";

type Props = { params: Promise<{ locale: string }> };

/** Herramienta interna de validación visual: nunca se indexa (F-14). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Ruta de previsualización del sistema de objetos (ticket 1.3). Carga una sala
 * de demo (fixture fija, no una sala real) con el loader puro y monta la
 * escena Phaser + overlay React para validar a mano: hover/brillo, inspección
 * con diálogo, transiciones de estado con animación y un objeto con
 * inventario interno (`distribution`).
 *
 * Deuda técnica (DEUDA.md, "retirar world-preview o dejarlo solo para
 * desarrollo"): es una herramienta de QA interna sin dato real de usuario
 * (siempre la misma fixture), así que se restringe con el mismo criterio que
 * `/play` sin `?session` (`isDevFallbackAllowed`) en vez de retirarla — sigue
 * haciendo falta para validar el runtime a mano en desarrollo.
 */
export default async function WorldPreviewPage({ params }: Props) {
  if (!isDevFallbackAllowed()) notFound();

  const { locale } = await params;
  setRequestLocale(locale);

  const roomPackage = loadRoomPackage(worldPreviewPackage());
  const model = toRuntimeModel(roomPackage, { locale });

  return (
    <main className="relative min-h-dvh bg-background p-4">
      <WorldPreviewShell model={model} />
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
