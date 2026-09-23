import {
  isAnonymous,
  PublishConfirmationError,
  type PublishConfirmationState,
} from "@escaperoom/shared/services";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ConfirmPublish } from "@/components/publish-confirm/confirm-publish";
import { resolveBrowserActorFromHeaders } from "@/server/context";
import { getPublishConfirmationService } from "@/server/services";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
};

/** Enlace personal del creador: nunca se indexa. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Códigos con mensaje propio en `PublishConfirm.errors` (el resto: `UNKNOWN`). */
const KNOWN_ERRORS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_TOKEN",
  "EXPIRED",
  "NOT_FOUND",
  "DRAFT_CHANGED",
  "VERSION_CHANGED",
  "VALIDATION_FAILED",
  "ASSETS_NOT_PUBLISHABLE",
  "ROOM_NOT_PUBLISHABLE",
  "PUBLISH_CONFIRM_DISABLED",
]);

type View = { kind: "error"; code: string } | { kind: "state"; state: PublishConfirmationState };

async function loadView(token: string | undefined): Promise<View> {
  if (!token) return { kind: "error", code: "INVALID_TOKEN" };
  const confirmations = getPublishConfirmationService();
  if (!confirmations) return { kind: "error", code: "PUBLISH_CONFIRM_DISABLED" };
  const actor = await resolveBrowserActorFromHeaders(await headers());
  if (isAnonymous(actor)) return { kind: "error", code: "UNAUTHORIZED" };
  try {
    return { kind: "state", state: await confirmations.inspect(actor, token) };
  } catch (err) {
    if (err instanceof PublishConfirmationError) return { kind: "error", code: err.code };
    throw err;
  }
}

/**
 * Confirmación humana de una publicación pedida por el agente (ticket 4.5,
 * specs/10 §5: «el humano aprueba el git push de la sala»). El MCP nunca
 * publica: devuelve un enlace a esta página, que el creador abre con su
 * sesión. Muestra qué se va a publicar y si sigue siendo confirmable; el
 * botón llama a `POST /api/publish-confirm`.
 */
export default async function PublishConfirmPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { token: rawToken } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("PublishConfirm");
  const format = await getFormatter();
  const token = typeof rawToken === "string" && rawToken.length > 0 ? rawToken : undefined;
  const view = await loadView(token);
  const errorText = (code: string) =>
    KNOWN_ERRORS.has(code) ? t(`errors.${code}`) : t("errors.UNKNOWN");

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-white">
      <section className="w-full max-w-lg space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-white/70">{t("intro")}</p>
        {view.kind === "error" ? (
          <p role="alert" className="text-sm text-red-300">
            {errorText(view.code)}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {view.state.status !== "blocked" ? (
                <>
                  <dt className="text-white/60">{t("room")}</dt>
                  <dd>{view.state.check.title}</dd>
                  <dt className="text-white/60">{t("version")}</dt>
                  <dd>{`v${view.state.check.nextSemver}`}</dd>
                </>
              ) : null}
              <dt className="text-white/60">{t("notes")}</dt>
              <dd className="whitespace-pre-wrap">{view.state.claims.versionNotes}</dd>
              <dt className="text-white/60">{t("expires")}</dt>
              <dd>
                {format.dateTime(new Date(view.state.claims.expiresAt), {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </dd>
            </dl>
            {view.state.status === "ready" ? (
              <>
                <WarningList
                  title={t("warnings")}
                  items={view.state.check.report.checks
                    .filter((c) => c.status === "warning")
                    .map((c) => c.summary)}
                />
                <p className="text-sm text-amber-200">{t("irreversible")}</p>
                <ConfirmPublish token={token!} />
              </>
            ) : view.state.status === "stale" ? (
              <p role="alert" className="text-sm text-red-300">
                {errorText(view.state.reason)}
              </p>
            ) : (
              <div role="alert" className="space-y-2 text-sm text-red-300">
                <p>{errorText(view.state.error.code)}</p>
                <WarningList
                  items={(view.state.error.details.report?.checks ?? [])
                    .filter((c) => c.status === "error")
                    .flatMap((c) =>
                      c.issues.length > 0 ? c.issues.map((i) => i.message) : [c.summary],
                    )}
                />
              </div>
            )}
          </>
        )}
      </section>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}

function WarningList({ title, items }: { title?: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 text-sm">
      {title ? <p className="text-white/60">{title}</p> : null}
      <ul className="list-disc space-y-1 pl-5">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
