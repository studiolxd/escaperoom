import { loadRoomPackage } from "@escaperoom/game-runtime";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { RulesGraphDemo } from "@/components/rules-graph/rules-graph-demo";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = { params: Promise<{ locale: string }> };

/**
 * Demo del grafo de reglas (ticket 3.6), solo en desarrollo: carga las reglas
 * del fixture del Rey Aldric en un doc Yjs local y monta `<RulesGraph>`. El
 * editor real (`/editor/[roomId]`) lo montará sobre el doc sincronizado de 3.3.
 */
export default async function RulesGraphDevPage({ params }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { locale } = await params;
  setRequestLocale(locale);

  const { rules } = loadRoomPackage(readReyAldricRoomPackageJson());

  return (
    <main className="relative min-h-dvh bg-background p-4">
      <RulesGraphDemo rules={rules} />
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
