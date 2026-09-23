import type { ReactNode } from "react";
import type { LegalDocument, LegalHref, LegalText } from "@/content/legal/types";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

type LegalPageProps = {
  title: string;
  document: LegalDocument;
  /** `true` si el locale actual no es `es`: el contenido solo existe en español. */
  onlyInSpanishNotice?: string;
  nav: { href: LegalHref; label: string }[];
  currentHref: LegalHref;
  /** Contenido interactivo adicional bajo el documento (p. ej. el enlace de preferencias de cookies). */
  children?: ReactNode;
};

/**
 * Pinta un párrafo o elemento de lista: los fragmentos con `href` son
 * remisiones a otra página legal y se enlazan de verdad (con el `Link` de
 * next-intl, que conserva el locale activo).
 */
function RichText({ text }: { text: LegalText }) {
  if (typeof text === "string") return text;
  return text.map((fragment, i) =>
    typeof fragment === "string" ? (
      fragment
    ) : (
      <Link
        key={i}
        href={fragment.href}
        className="font-medium underline underline-offset-4 hover:text-muted-foreground"
      >
        {fragment.text}
      </Link>
    ),
  );
}

/**
 * Layout compartido de las páginas legales (ticket 6.2, specs/18): TOS,
 * política de privacidad, anexo de encargo de tratamiento (DPA), aviso
 * legal y política de cookies. El contenido en sí (`document`)
 * vive siempre en español — specs/18 fija España como jurisdicción de
 * referencia. `onlyInSpanishNotice` avisa de esto en el resto de locales;
 * el resto de la página (título, navegación entre páginas legales) sí sigue
 * el idioma activo, como el resto de la app.
 */
export function LegalPage({
  title,
  document,
  onlyInSpanishNotice,
  nav,
  currentHref,
  children,
}: LegalPageProps) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                item.href === currentHref
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <header className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {onlyInSpanishNotice ? (
            <p className="text-xs text-muted-foreground">{onlyInSpanishNotice}</p>
          ) : null}
        </header>

        <Card>
          <CardContent className="space-y-6 text-sm leading-relaxed text-foreground">
            {document.sections.map((section) => (
              <section key={section.heading} className="space-y-2">
                <h2 className="text-sm font-semibold text-foreground">{section.heading}</h2>
                {section.paragraphs.map((paragraph, i) => (
                  <p key={i}>
                    <RichText text={paragraph} />
                  </p>
                ))}
                {section.list ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {section.list.map((item, i) => (
                      <li key={i}>
                        <RichText text={item} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </CardContent>
        </Card>

        {children}
      </div>
    </main>
  );
}
