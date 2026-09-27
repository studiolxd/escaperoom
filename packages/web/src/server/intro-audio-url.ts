import { prisma } from "@escaperoom/shared/db";
import type { IntroAudioUrlResolver } from "@/lib/intro-model";
import { getIntroAudioUrlResolver } from "./services";

/**
 * Qué se está jugando (como `IntroMediaSource` de `intro-media-url.ts`, pero
 * para la narración `audioUrl` de una introducción de texto):
 * - `published`: una versión publicada — solo se sirven claves publicadas
 *   (`r2://assets/rooms/…`).
 * - `draft`: el playtest del borrador de `roomId`. QUIEN LLAMA ya ha
 *   autorizado el acceso al playtest; aquí solo se sirven las subidas del
 *   autor de esa sala (y la biblioteca incluida, siempre pública).
 */
export type IntroAudioSource = { kind: "published" } | { kind: "draft"; roomId: string };

/**
 * `IntroAudioUrlResolver` para `resolveIntroModel` (`@/lib/intro-model`) en
 * las páginas de partida y playtest. Nunca lanza: una referencia que no se
 * puede servir hace que la introducción se muestre igual, solo sin narración.
 */
export function introAudioUrlResolver(source: IntroAudioSource): IntroAudioUrlResolver {
  if (source.kind === "published") {
    return getIntroAudioUrlResolver({ kind: "published" });
  }
  const { roomId } = source;
  return async (ref) => {
    const room = await prisma.room
      .findFirst({ where: { id: roomId, deletedAt: null }, select: { authorId: true } })
      .catch(() => null);
    if (!room) return null;
    return getIntroAudioUrlResolver({ kind: "draft", roomAuthorId: room.authorId })(ref);
  };
}
