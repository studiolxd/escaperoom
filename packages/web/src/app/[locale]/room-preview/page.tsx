import { loadRoomPackage, toRuntimeModel } from "@escaperoom/game-runtime";
import { setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { RoomPreviewShell } from "@/components/room-preview/room-preview-shell";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = { params: Promise<{ locale: string }> };

/**
 * Ruta de previsualización del runtime (ticket 1.1). Carga el fixture canónico
 * del Rey Aldric en el servidor, valida el `RoomPackage` con el loader puro y
 * proyecta el modelo que monta la escena Phaser. La validación visual la hace
 * el humano: aquí deben verse las 3 habitaciones del Rey Aldric.
 */
export default async function RoomPreviewPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
  const model = toRuntimeModel(roomPackage, { locale });

  return (
    <main className="relative min-h-dvh bg-background p-4">
      <RoomPreviewShell model={model} />
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
