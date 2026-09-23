import { setRequestLocale } from "next-intl/server";
import { LobbyShell } from "@/components/game/lobby-shell";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";

type Props = { params: Promise<{ locale: string }> };

export default async function LobbyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="relative min-h-dvh bg-background p-4">
      <LobbyShell />
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
