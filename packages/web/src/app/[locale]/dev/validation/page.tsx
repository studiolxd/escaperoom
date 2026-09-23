import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { ValidationDemo } from "@/components/editor/validation-demo";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = { params: Promise<{ locale: string }> };

/**
 * Demo de la validación continua del editor (ticket 3.7), solo en desarrollo:
 * reglas del Rey Aldric en un doc Yjs local, grafo con los problemas
 * resaltados y panel de avisos.
 */
export default async function ValidationDevPage({ params }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { locale } = await params;
  setRequestLocale(locale);

  const pkg = parseRoomPackage(JSON.parse(readReyAldricRoomPackageJson()) as unknown);

  return (
    <main className="relative min-h-dvh bg-background p-4">
      <ValidationDemo pkg={pkg} />
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
