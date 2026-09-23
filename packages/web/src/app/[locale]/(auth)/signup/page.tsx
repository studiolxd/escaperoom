import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/auth-form";
import { Link } from "@/i18n/navigation";

export default async function SignupPage() {
  const t = await getTranslations("PublicNav");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="self-center text-sm font-semibold tracking-tight">
          {t("logo")}
        </Link>
        <AuthForm mode="signup" />
      </div>
    </div>
  );
}
