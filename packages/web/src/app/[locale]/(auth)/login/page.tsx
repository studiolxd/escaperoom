import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/auth-form";
import { PublicShell } from "@/components/layout/public-shell";
import { buildPageMetadata } from "@/lib/catalog-seo";
import { safeCallbackURL } from "@/lib/callback-url";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackURL?: string | string[] }>;
};

/** F-14: sin `generateMetadata` la página salía sin canónica ni `hreflang`. */
export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return buildPageMetadata({
    locale,
    path: "/login",
    title: t("login.title"),
    description: t("login.subtitle"),
  });
}

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { callbackURL } = await searchParams;

  return (
    <PublicShell>
      <main className="flex w-full flex-1 items-center justify-center p-6 md:p-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <AuthForm mode="login" callbackURL={safeCallbackURL(callbackURL)} />
        </div>
      </main>
    </PublicShell>
  );
}
