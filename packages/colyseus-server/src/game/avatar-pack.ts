import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "./room-packages.js";

/**
 * Lista de personajes seleccionables del pack gráfico (A1/B4, specs/26 §6):
 * el servidor es la autoridad de `characterId` (lo valida al unirse y en el
 * mensaje `select_character`), así que necesita conocer `manifest.avatars`
 * sin arrastrar el schema completo del pack (que vive en `game-runtime`, un
 * paquete pensado para el navegador/Phaser).
 */

const PackAvatarsSchema = z.object({
  avatars: z.array(z.object({ id: z.string().min(1) })).optional(),
});

const DEFAULT_PACK_ID = "medieval-v1";
/** Personaje de reserva (A1): el maniquí SVG tintado, no aparece en `manifest.avatars`. */
export const FALLBACK_CHARACTER_ID = "maniqui";

let cachedIds: readonly string[] | undefined;

function manifestPath(packId: string): string {
  return join(findRepoRoot(), "packages/web/public/packs", packId, "manifest.json");
}

/**
 * Ids de personajes seleccionables del pack (cacheados por proceso). Sin
 * manifiesto generado (`pnpm pack:build` aún no se corrió) o sin `avatars`
 * declarados, devuelve una lista vacía: todos los jugadores caen al maniquí
 * de reserva, como hoy.
 */
export function loadAvatarCharacterIds(packId: string = DEFAULT_PACK_ID): readonly string[] {
  if (cachedIds) return cachedIds;
  const path = manifestPath(packId);
  if (!existsSync(path)) {
    cachedIds = [];
    return cachedIds;
  }
  const parsed = PackAvatarsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  cachedIds = parsed.success ? (parsed.data.avatars ?? []).map((avatar) => avatar.id) : [];
  return cachedIds;
}

/** Solo para tests: limpia la caché entre casos que usan manifiestos distintos. */
export function resetAvatarPackCache(): void {
  cachedIds = undefined;
}
