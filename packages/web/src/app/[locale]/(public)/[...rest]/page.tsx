import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ locale: string; rest: string[] }> };

/**
 * Comodín del 404 (auditoría 2026-09-24, DEUDA "404 de URLs que no existen",
 * PR #153): antes, una URL con locale válido pero sin ninguna página que la
 * capture (p. ej. `/es/una-ruta-que-no-existe`) no llamaba a `notFound()` en
 * ningún segmento, así que Next servía su 404 por defecto (en inglés y sin
 * estilos) en vez de `(public)/not-found.tsx` (shell pública).
 *
 * Vive en `(public)` para que el 404 salga con la cabecera/pie públicos: es
 * la menos específica de todas las rutas de `[locale]`, así que solo la
 * alcanzan los caminos que ninguna otra página (de cualquier grupo) capturó.
 * Las URLs sin prefijo de idioma las cubre `app/global-not-found.tsx`.
 */
export default async function CatchAllNotFound({ params }: Props): Promise<never> {
  const { locale } = await params;
  setRequestLocale(locale);
  notFound();
}
