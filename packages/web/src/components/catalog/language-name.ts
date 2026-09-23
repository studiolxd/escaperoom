/**
 * Nombre de un código de idioma en el locale de la UI (`Intl.DisplayNames`),
 * con el código como respaldo si el runtime no lo conoce.
 */
export function languageName(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : code;
  } catch {
    return code;
  }
}
