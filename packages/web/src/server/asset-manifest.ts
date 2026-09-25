import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@escaperoom/kit/logger";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import type { AssetManifestInput } from "@escaperoom/shared/validator";
import { findRepoRoot } from "@/lib/repo-root";
import { PACKS_PUBLIC_DIR } from "@/lib/room-preview-pack";

/**
 * Manifiesto del pack gráfico para el check `assets` del validador (auditoría
 * D-13): `publish()` y las tools MCP corrían el validador sin `assetManifest`,
 * así que ese check nunca comprobaba nada («Assets no comprobados»). El
 * manifiesto (`packages/web/public/packs/<tileset>/manifest.json`) NO se
 * versiona (lo genera `pnpm pack:build`), así que en un clon limpio sin
 * paquete generado esto degrada a `undefined` (el check vuelve a avisar en
 * vez de bloquear) en lugar de romper la publicación.
 */
export async function loadAssetManifestFor(
  pkg: RoomPackage,
): Promise<AssetManifestInput | undefined> {
  const tileset = pkg.map.tileset;
  const manifestPath = join(findRepoRoot(), PACKS_PUBLIC_DIR, tileset, "manifest.json");
  try {
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as AssetManifestInput;
    return raw;
  } catch (error) {
    logger.warn(
      { tileset, manifestPath, err: error instanceof Error ? error.message : String(error) },
      "assets: no se pudo leer el manifiesto del pack; el check 'assets' no se comprobará",
    );
    return undefined;
  }
}
