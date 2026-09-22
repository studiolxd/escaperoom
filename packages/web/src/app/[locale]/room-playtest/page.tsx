import { loadRoomPackage, toRuntimeModel } from "@escaperoom/game-runtime";
import { setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { RoomPlaytestShell } from "@/components/room-playtest/room-playtest-shell";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";
import { resolveRoomPreviewPack } from "@/lib/room-preview-pack";

type Props = { params: Promise<{ locale: string }> };

/**
 * Playtest de la Sala 1 (ticket 1.10): carga el fixture canónico del Rey Aldric,
 * lo valida con el loader y monta el Salón del Trono con el guion jugable
 * (llave → armario → combinación → brasero → candado → cáliz → placas). La
 * validación visual y el recorrido los hace el humano; el test de integración
 * `packages/shared/test/room1-integration.test.ts` cubre el mismo guion sin
 * infraestructura.
 */
export default async function RoomPlaytestPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
  const model = toRuntimeModel(roomPackage, { locale });
  const { pack } = resolveRoomPreviewPack(roomPackage.map.tileset, model);

  return (
    <main className="relative min-h-dvh bg-background p-4">
      <RoomPlaytestShell model={model} roomPackage={roomPackage} pack={pack} />
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
