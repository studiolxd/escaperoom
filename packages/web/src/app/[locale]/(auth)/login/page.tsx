import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/auth-form";
import { Link } from "@/i18n/navigation";
import { buildPageMetadata } from "@/lib/catalog-seo";

type Props = { params: Promise<{ locale: string }> };

/** F-14: sin `generateMetadata` la página salía sin canónica ni `hreflang`. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return buildPageMetadata({
    locale,
    path: "/login",
    title: t("login.title"),
    description: t("login.subtitle"),
  });
}

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("PublicNav");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="self-center text-sm font-semibold tracking-tight">
          {t("logo")}
        </Link>
        <AuthForm mode="login" />
      </div>
    </div>
  );
}
