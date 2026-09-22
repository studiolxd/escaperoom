import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { deepMergeMessages } from "./messages";
import { routing } from "./routing";

/**
 * Carga los mensajes del locale activo y los fusiona sobre el catálogo `es`:
 * así una clave que falte en un idioma aún en stub no rompe la app (ADR-018).
 * `onError`/`getMessageFallback` cubren el caso extremo de una clave ausente
 * incluso en el catálogo base.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  const [defaultMessages, localeMessages] = await Promise.all([
    import(`../../messages/${routing.defaultLocale}.json`),
    import(`../../messages/${locale}.json`),
  ]);

  return {
    locale,
    messages: deepMergeMessages(defaultMessages.default, localeMessages.default),
    onError(error) {
      if (process.env.NODE_ENV !== "production") {
        console.error(error);
      }
    },
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join(".");
    },
  };
});
