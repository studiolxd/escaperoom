import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ConsentLogin } from "@/components/mcp-oauth/consent-login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { auth } from "@/lib/auth";
import { hasAuthorizationHeader } from "@/server/context";
import { getMcpOAuthProvider } from "@/server/mcp-oauth";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Pantalla de un flujo OAuth en curso: nunca se indexa. */
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Origen de la petición SSR (detrás de proxy, `x-forwarded-*`). */
function requestOrigin(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Destino legible de la redirección (los esquemas de app nativa no tienen `origin`). */
function redirectTarget(uri: string): string {
  const url = new URL(uri);
  return url.origin !== "null" ? url.origin : `${url.protocol}//${url.host}`;
}

/**
 * Consentimiento del OAuth del MCP del creador (ticket 4.7, specs/10 §5): un
 * cliente MCP remoto (Claude, un IDE…) pide actuar con los permisos del
 * creador. El login se resuelve contra la sesión de Better Auth; la decisión
 * se envía por POST a `/api/mcp/oauth/authorize`, que lo revalida todo.
 */
export default async function McpConsentPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("McpConsent");

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  const requestHeaders = await headers();
  const provider = getMcpOAuthProvider({ url: requestOrigin(requestHeaders) });
  const parsed = await provider.parseAuthorizationRequest(query);
  // Solo la sesión del navegador: con `Authorization` (un token) no hay humano.
  const session =
    parsed.ok && !hasAuthorizationHeader(requestHeaders)
      ? await auth.api.getSession({ headers: requestHeaders }).catch(() => null)
      : null;

  let body: ReactNode;
  if (!parsed.ok) {
    body = (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-red-300">{t("errors.invalid")}</p>
        <p className="font-mono text-xs text-white/60">{parsed.description}</p>
      </div>
    );
  } else if (!session) {
    body = (
      <>
        <p className="text-sm text-white/70">{t("intro", { client: parsed.request.clientName })}</p>
        <ConsentLogin callbackURL={`/${locale}/oauth/consent?${query.toString()}`} />
      </>
    );
  } else {
    const { request } = parsed;
    body = (
      <form method="post" action="/api/mcp/oauth/authorize" className="space-y-4">
        <p className="text-sm text-white/70">{t("intro", { client: request.clientName })}</p>
        <p className="text-xs text-white/50">
          {t("signedInAs", { user: session.user.email ?? session.user.name ?? session.user.id })}
        </p>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("permissionsTitle")}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-white/80">
            <li>{t("permissions.drafts")}</li>
            <li>{t("permissions.noForeign")}</li>
            <li>{t("permissions.expiry")}</li>
          </ul>
        </div>
        <p className="text-xs text-white/50">
          {t("redirectTo", { target: redirectTarget(request.redirectUri) })}
        </p>
        {[...query.entries()].map(([key, value]) => (
          <Input key={key} type="hidden" name={key} value={value} />
        ))}
        <div className="flex gap-3">
          <Button type="submit" name="decision" value="approve">
            {t("approve")}
          </Button>
          <Button type="submit" name="decision" value="deny" variant="overlay">
            {t("deny")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-white">
      <section className="w-full max-w-md space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        {body}
      </section>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
