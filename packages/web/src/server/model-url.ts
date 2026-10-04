import { logger } from "@escaperoom/kit/logger";
import type { IntroMediaService } from "@escaperoom/shared/services";
import type { Pack3D } from "@/lib/game-model";
import { INTRO_MEDIA_URL_TTL_SECONDS, type IntroMediaSource } from "./intro-media-url";
import { getIntroMediaService } from "./services";

/**
 * URLs firmadas (6 h) de todos los modelos propios de un modelo de runtime 3D.
 * Clave = `ref` tal cual está en `model.customModels[id].ref`. Las que no se
 * puedan resolver se omiten (el runtime pintará la caja). Mismo patrón y misma
 * autorización que `introMediaUrlResolver`: `published` solo sirve claves
 * publicadas; `draft` además los `media:<uuid>` listos del autor de `roomId`.
 * Nunca lanza.
 */
export async function customModelUrls(
  model: { customModels: Record<string, { ref: string }> },
  source: IntroMediaSource,
  service: Pick<IntroMediaService, "resolveMediaRef" | "signedUrl"> = getIntroMediaService(),
): Promise<Record<string, string>> {
  const access = source.kind === "published" ? null : { roomId: source.roomId };
  const refs = [...new Set(Object.values(model.customModels).map((m) => m.ref))];
  const urls: Record<string, string> = {};
  await Promise.all(
    refs.map(async (ref) => {
      try {
        const key = await service.resolveMediaRef(access, ref);
        urls[ref] = await service.signedUrl(key, { expiresIn: INTRO_MEDIA_URL_TTL_SECONDS });
      } catch (err) {
        logger.warn({ err, ref }, "customModelUrls: modelo propio no servible (se pinta la caja)");
      }
    }),
  );
  return urls;
}

/** `pack3d` con las URLs de los modelos propios (sin `pack3d`, o sin modelos propios, no cambia). */
export async function withCustomModelUrls(
  pack3d: Pack3D | undefined,
  model: { customModels: Record<string, { ref: string }> },
  source: IntroMediaSource,
): Promise<Pack3D | undefined> {
  if (!pack3d || Object.keys(model.customModels).length === 0) return pack3d;
  return { ...pack3d, customModelUrls: await customModelUrls(model, source) };
}
