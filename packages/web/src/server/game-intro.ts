import type { RoomPackage } from "@escaperoom/shared/schemas";
import {
  resolveIntroModel,
  type IntroAudioUrlResolver,
  type IntroMediaUrlResolver,
  type IntroModel,
} from "@/lib/intro-model";

/**
 * Introducción de la sala para la página de partida/playtest (encargo
 * lobby-diseño): texto al idioma activo (con narración opcional) o
 * vídeo/subtítulos, todo con URLs firmadas. `resolveMediaUrl` resuelve las
 * referencias de medio de vídeo/subtítulos (clave del bucket de una versión
 * publicada o `media:<uuid>` de un borrador); `resolveAudioUrl` hace lo mismo
 * para la narración del texto (`library:`/`upload:`/clave publicada). Sin
 * ellos, el vídeo no se muestra o el texto se queda sin narración — nunca
 * lanza: una introducción que no se pueda preparar no debe impedir jugar.
 */
export async function buildGameIntro(
  roomPackage: RoomPackage,
  locale: string,
  resolveMediaUrl?: IntroMediaUrlResolver,
  resolveAudioUrl?: IntroAudioUrlResolver,
): Promise<IntroModel | null> {
  return resolveIntroModel(roomPackage.meta.intro, {
    locale,
    defaultLanguage: roomPackage.meta.defaultLanguage,
    languages: roomPackage.meta.languages,
    ...(resolveMediaUrl ? { resolveMediaUrl } : {}),
    ...(resolveAudioUrl ? { resolveAudioUrl } : {}),
  }).catch(() => null);
}
