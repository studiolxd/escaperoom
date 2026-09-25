import type { ReactNode } from "react";
import type { LegalDocument, LegalText } from "@/content/legal/types";
import { Link } from "@/i18n/navigation";

type LegalPageProps = {
  title: string;
  document: LegalDocument;
  /** `true` si el locale actual no es `es`: el contenido solo existe en español. */
  onlyInSpanishNotice?: string;
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
 * referencia. `onlyInSpanishNotice` avisa de esto en el resto de locales; el
 * título sí sigue el idioma activo, como el resto de la app.
 *
 * Mismo ancho (`max-w-6xl`) que home, catálogo y detalle de sala, sin card
 * envolviendo el contenido. La navegación entre páginas legales no se repite
 * aquí: ya la da el `PublicFooter` compartido del layout `(public)`.
 */
export function LegalPage({
  title,
  document,
  onlyInSpanishNotice,
  children,
}: LegalPageProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 bg-background px-4 py-8 text-foreground">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {onlyInSpanishNotice ? (
          <p className="text-xs text-muted-foreground">{onlyInSpanishNotice}</p>
        ) : null}
      </header>

      <div className="max-w-2xl space-y-6 text-sm leading-relaxed text-foreground">
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
      </div>

      {children}
    </main>
  );
}
