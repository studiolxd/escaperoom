import { createIntroMediaUrlResolver, type IntroMediaService } from "@escaperoom/shared/services";
import type { IntroMediaUrlResolver } from "@/lib/intro-model";
import { getIntroMediaService } from "./services";

/**
 * Vida de las URLs firmadas del vídeo y los subtítulos de la introducción en
 * partida/playtest: la página se carga una vez y el jugador puede quedarse
 * en la sala de espera mucho rato antes de «Empezar» (o llegar tarde), así que
 * la URL tiene que seguir viva cuando el navegador pide el vídeo.
 */
export const INTRO_MEDIA_URL_TTL_SECONDS = 6 * 60 * 60;

/**
 * Qué se está jugando:
 * - `published`: una versión publicada (cualquier jugador con acceso): solo
 *   se sirven las claves publicadas (`r2://assets/rooms/…`).
 * - `draft`: el playtest del borrador de `roomId`. QUIEN LLAMA ya ha
 *   autorizado el acceso al playtest; aquí solo se sirven los `media:<uuid>`
 *   listos subidos por el autor de esa sala (y las claves publicadas).
 */
export type IntroMediaSource = { kind: "published" } | { kind: "draft"; roomId: string };

/**
 * `IntroMediaUrlResolver` para `resolveIntroModel` (`@/lib/intro-model`) en
 * las páginas de partida y playtest. Nunca lanza: una referencia que no se
 * puede servir devuelve `null` (sin vídeo → directo al 3-2-1; sin esa pista de
 * subtítulos → el vídeo sin ella).
 */
export function introMediaUrlResolver(
  source: IntroMediaSource,
  service: Pick<IntroMediaService, "resolveMediaRef" | "signedUrl"> = getIntroMediaService(),
): IntroMediaUrlResolver {
  return createIntroMediaUrlResolver(
    service,
    source.kind === "published" ? null : { roomId: source.roomId },
    { expiresIn: INTRO_MEDIA_URL_TTL_SECONDS },
  );
}
