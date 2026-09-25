import { isDevFallbackAllowed } from "@escaperoom/env";
import { loadRoomPackage, toRuntimeModel } from "@escaperoom/game-runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { RoomPreviewShell } from "@/components/room-preview/room-preview-shell";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";
import { resolveRoomPreviewPack } from "@/lib/room-preview-pack";

type Props = { params: Promise<{ locale: string }> };

/** Herramienta interna de validación visual: nunca se indexa (F-14). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Ruta de previsualización del runtime (tickets 1.1 y 1.2). Carga el fixture
 * canónico del Rey Aldric en el servidor (no una sala real ni el borrador del
 * editor), valida el `RoomPackage` con el loader puro, detecta si hay un pack
 * gráfico en `public/packs/<tileset>` y proyecta el modelo que monta la
 * escena Phaser. Sin pack, la escena dibuja placeholders procedurales; con
 * pack, los tiles y sprites reales. La validación visual la hace el humano.
 *
 * Deuda técnica (DEUDA.md, "room-preview solo accesible desde el editor"):
 * el editor real no abre esta ruta (usa "Jugar", que crea una partida de
 * prueba de la sala concreta vía `/api/rooms/:roomId/playtest`) — esta ruta
 * siempre renderiza la misma fixture fija, sin `roomId`, así que no hay
 * contenido de autor real que proteger con token/comprobación de autoría.
 * Es una herramienta de QA interna como `world-preview`: mismo criterio
 * (`isDevFallbackAllowed`) en vez del token firmado que sí haría falta si
 * algún día previsualizara una sala real.
 */
export default async function RoomPreviewPage({ params }: Props) {
  if (!isDevFallbackAllowed()) notFound();

  const { locale } = await params;
  setRequestLocale(locale);

  const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
  const model = toRuntimeModel(roomPackage, { locale });
  const { pack, issues } = resolveRoomPreviewPack(roomPackage.map.tileset, model);

  if (issues.length > 0) {
    console.warn(
      `[room-preview] incidencias del pack "${roomPackage.map.tileset}":\n` +
        issues.map((issue) => `  ${issue.severity} ${issue.path}: ${issue.message}`).join("\n"),
    );
  }

  return (
    <main className="relative min-h-dvh bg-background p-4">
      <RoomPreviewShell model={model} pack={pack} />
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
