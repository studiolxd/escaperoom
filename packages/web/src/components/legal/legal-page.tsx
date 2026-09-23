import type { LegalDocument } from "@/content/legal/types";
import { Link } from "@/i18n/navigation";

type LegalPageProps = {
  title: string;
  draftNotice: string;
  draftDateLabel: string;
  document: LegalDocument;
  /** `true` si el locale actual no es `es`: el contenido solo existe en español. */
  onlyInSpanishNotice?: string;
  nav: {
    href: "/legal/terms" | "/legal/privacy" | "/legal/dpa" | "/legal/legal-notice" | "/legal/cookies";
    label: string;
  }[];
  currentHref: "/legal/terms" | "/legal/privacy" | "/legal/dpa" | "/legal/legal-notice" | "/legal/cookies";
};

/**
 * Layout compartido de las páginas legales (ticket 6.2, specs/18): TOS,
 * política de privacidad, plantilla de DPA, aviso legal y política de
 * cookies. El contenido en sí (`document`)
 * vive siempre en español — specs/18 fija España como jurisdicción de
 * referencia y el alcance de este ticket es un borrador técnico, no una
 * traducción jurídica a seis idiomas de un texto que todavía no ha revisado
 * ningún abogado. `onlyInSpanishNotice` avisa de esto en el resto de locales;
 * el resto de la página (título, navegación entre páginas legales) sí sigue
 * el idioma activo, como el resto de la app.
 */
export function LegalPage({
  title,
  draftNotice,
  draftDateLabel,
  document,
  onlyInSpanishNotice,
  nav,
  currentHref,
}: LegalPageProps) {
  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <nav className="flex flex-wrap gap-2 text-xs">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full border px-3 py-1 transition-colors ${
                item.href === currentHref
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-white/10 text-white/60 hover:bg-white/5"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <header className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          <p className="text-xs text-amber-200/90">
            {draftNotice} ({draftDateLabel}: {document.draftDate})
          </p>
          {onlyInSpanishNotice ? (
            <p className="text-xs text-amber-200/90">{onlyInSpanishNotice}</p>
          ) : null}
        </header>

        <article className="space-y-6 rounded-xl border border-white/10 bg-white/5 p-6 text-sm leading-relaxed text-white/80">
          {document.sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h2 className="text-sm font-semibold text-white">{section.heading}</h2>
              {section.paragraphs.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
              {section.list ? (
                <ul className="list-disc space-y-1 pl-5">
                  {section.list.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
