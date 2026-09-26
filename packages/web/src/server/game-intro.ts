import type { RoomPackage } from "@escaperoom/shared/schemas";
import { resolveIntroModel, type IntroMediaUrlResolver, type IntroModel } from "@/lib/intro-model";

/**
 * Introducción de la sala para la página de partida/playtest (encargo
 * lobby-diseño): texto al idioma activo o vídeo/subtítulos con URLs firmadas.
 * `resolveMediaUrl` resuelve las referencias de medio (clave del bucket de una
 * versión publicada o `media:<uuid>` de un borrador); sin él, un vídeo no se
 * muestra (la partida sigue: directo al 3-2-1). Nunca lanza: una
 * introducción que no se pueda preparar no debe impedir jugar.
 */
export async function buildGameIntro(
  roomPackage: RoomPackage,
  locale: string,
  resolveMediaUrl?: IntroMediaUrlResolver,
): Promise<IntroModel | null> {
  return resolveIntroModel(roomPackage.meta.intro, {
    locale,
    defaultLanguage: roomPackage.meta.defaultLanguage,
    languages: roomPackage.meta.languages,
    ...(resolveMediaUrl ? { resolveMediaUrl } : {}),
  }).catch(() => null);
}
