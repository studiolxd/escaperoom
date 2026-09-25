import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "./room-packages.js";

/**
 * Lista de personajes seleccionables del pack gráfico (A1/B4, specs/26 §6):
 * el servidor es la autoridad de `characterId` (lo valida al unirse y en el
 * mensaje `select_character`), así que necesita conocer la lista de
 * personajes sin arrastrar el schema completo del pack (que vive en
 * `game-runtime`, un paquete pensado para el navegador/Phaser).
 *
 * Se lee de `pack.config.json` (fuente **versionada** de la que
 * `build-pack.ts` deriva `manifest.avatars`), no de `manifest.json`: ese es
 * un artefacto generado por `pnpm pack:build` y está en `.gitignore` — en un
 * clon limpio, en CI o en producción sin ese paso manual no existe, y leerlo
 * haría que el servidor no reconociera ningún personaje (todos caerían al
 * maniquí de reserva) aunque el pack tenga personajes de sobra declarados.
 */

const PackConfigAvatarsSchema = z.object({
  avatars: z.array(z.object({ id: z.string().min(1) })).optional(),
});

const DEFAULT_PACK_ID = "medieval-v1";
/** Personaje de reserva (A1): el maniquí SVG tintado, no aparece en `manifest.avatars`. */
export const FALLBACK_CHARACTER_ID = "maniqui";

let cachedIds: readonly string[] | undefined;

function packConfigPath(packId: string): string {
  return join(findRepoRoot(), "packages/web/public/packs", packId, "pack.config.json");
}

/**
 * Ids de personajes seleccionables del pack (cacheados por proceso). Sin
 * `pack.config.json` (pack sin configurar aún) o sin `avatars` declarados,
 * devuelve una lista vacía: todos los jugadores caen al maniquí de reserva,
 * como hoy.
 */
export function loadAvatarCharacterIds(packId: string = DEFAULT_PACK_ID): readonly string[] {
  if (cachedIds) return cachedIds;
  const path = packConfigPath(packId);
  if (!existsSync(path)) {
    cachedIds = [];
    return cachedIds;
  }
  const parsed = PackConfigAvatarsSchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  cachedIds = parsed.success ? (parsed.data.avatars ?? []).map((avatar) => avatar.id) : [];
  return cachedIds;
}

/** Solo para tests: limpia la caché entre casos que usan manifiestos distintos. */
export function resetAvatarPackCache(): void {
  cachedIds = undefined;
}
