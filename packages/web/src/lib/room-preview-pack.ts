import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validatePack,
  validatePackManifest,
  type PackManifest,
  type PackValidationIssue,
  type RuntimeModel,
} from "@escaperoom/game-runtime";
import { findRepoRoot } from "./repo-root";

/**
 * Resuelve el pack gráfico de la previsualización (ticket 1.2). Si existe
 * `packages/web/public/packs/<tileset>/manifest.json` y valida contra el
 * `RoomPackage`, se usa; si no, la previsualización cae al placeholder
 * automático. El `baseUrl` es la ruta pública que sirve Next.
 *
 * Solo se ejecuta en el servidor: el manifiesto es dato plano y viaja al
 * cliente, que carga las imágenes de atlas desde `/packs/<tileset>/…`.
 */

export const PACKS_PUBLIC_DIR = "packages/web/public/packs";

export interface RoomPreviewPack {
  manifest: PackManifest;
  /** URL base (sin barra final) de las imágenes/JSON del pack. */
  baseUrl: string;
}

export interface RoomPreviewPackResult {
  pack?: RoomPreviewPack;
  issues: PackValidationIssue[];
}

export interface ResolveRoomPreviewPackOptions {
  /** Directorio desde el que buscar la raíz del repo (por defecto `process.cwd()`). */
  cwd?: string;
  /** Raíz de packs a usar (por defecto `packages/web/public/packs` del repo). */
  packsRoot?: string;
}

export function resolveRoomPreviewPack(
  tileset: string,
  model: RuntimeModel,
  options: ResolveRoomPreviewPackOptions = {},
): RoomPreviewPackResult {
  const packsRoot =
    options.packsRoot ?? join(findRepoRoot(options.cwd ?? process.cwd()), PACKS_PUBLIC_DIR);
  const packDir = join(packsRoot, tileset);
  const manifestPath = join(packDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { issues: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      issues: [
        {
          path: "manifest.json",
          message: `no se pudo parsear el manifiesto del pack "${tileset}" (${detail}).`,
          severity: "error",
        },
      ],
    };
  }

  const result = validatePack(raw, model);
  if (!result.manifest) {
    return { issues: result.issues };
  }

  // Pack PARCIAL: se admite mientras su estructura sea válida, aunque no cubra
  // todos los frames del RoomPackage. La escena resuelve por nombre y lo que
  // falte cae al placeholder automático, así ir soltando assets se ve al
  // instante (ticket 1.2). Las incidencias se devuelven como aviso.
  const structuralErrors = result.issues.filter((issue) => issue.severity === "error");
  const structural = validatePackManifest(result.manifest);
  const blocking = structural.issues.filter((issue) => issue.severity === "error");
  if (blocking.length > 0) {
    return { issues: [...structuralErrors, ...structural.issues] };
  }

  return {
    pack: { manifest: result.manifest, baseUrl: `/packs/${tileset}` },
    issues: result.issues,
  };
}
