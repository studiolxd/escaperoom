import { resolveLocalizedText } from "@escaperoom/shared/hints";
import { MAX_INTRO_SUBTITLES_BYTES, type RoomIntro } from "@escaperoom/shared/schemas";

/**
 * Introducción de la sala lista para mostrar (encargo lobby-diseño, specs/04
 * §7): lo que la página de partida/playtest manda al navegador junto al
 * modelo del runtime. Se resuelve en el servidor: el texto al idioma activo y
 * el vídeo/subtítulos (referencias `media:<uuid>` del borrador o claves del
 * bucket de una versión publicada) a URLs firmadas de vida corta.
 */
export type IntroModel =
  | { kind: "text"; text: string }
  | {
      kind: "video";
      videoUrl: string;
      /**
       * Pistas WebVTT por idioma (`srclang`), en el orden de `meta.languages`,
       * con su CONTENIDO (no la URL firmada): el navegador las monta como
       * `blob:` del mismo origen — un `<track>` de otro origen (bucket) exige
       * CORS y `crossorigin` en el `<video>`, y sin ellos no carga.
       */
      subtitles: { lang: string; vtt: string }[];
    };

/**
 * Resuelve una referencia de medio de la introducción (`media:<uuid>` o clave
 * del bucket) a una URL firmada; `null` si no existe o no se puede servir.
 */
export type IntroMediaUrlResolver = (ref: string) => Promise<string | null>;

/**
 * `IntroModel` de `intro` para `locale`; `null` sin introducción (o con un
 * vídeo que no se puede servir: la partida sigue, directo al 3-2-1).
 */
export async function resolveIntroModel(
  intro: RoomIntro | undefined,
  options: {
    locale: string;
    defaultLanguage: string;
    languages: readonly string[];
    resolveMediaUrl?: IntroMediaUrlResolver;
    /** Lee el texto de un WebVTT a partir de su URL (por defecto, `fetch`); inyectable en tests. */
    readMediaText?: (url: string) => Promise<string | null>;
  },
): Promise<IntroModel | null> {
  if (!intro) return null;
  if (intro.type === "text") {
    const text = resolveLocalizedText(intro.text, options.locale, options.defaultLanguage);
    return text.trim() ? { kind: "text", text } : null;
  }
  const resolve = options.resolveMediaUrl;
  if (!resolve) return null;
  const videoUrl = await resolve(intro.video).catch(() => null);
  if (!videoUrl) return null;
  const readText = options.readMediaText ?? fetchSubtitles;
  const subtitles: { lang: string; vtt: string }[] = [];
  for (const lang of options.languages) {
    const ref = intro.subtitles?.[lang];
    if (!ref) continue;
    const url = await resolve(ref).catch(() => null);
    const vtt = url ? await readText(url).catch(() => null) : null;
    if (vtt) subtitles.push({ lang, vtt });
  }
  return { kind: "video", videoUrl, subtitles };
}

/** Descarga un WebVTT (servidor a servidor) sin pasar de `MAX_INTRO_SUBTITLES_BYTES`. */
async function fetchSubtitles(url: string): Promise<string | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_INTRO_SUBTITLES_BYTES) return null;
  return text.startsWith("WEBVTT") || text.startsWith("\uFEFFWEBVTT") ? text : null;
}
