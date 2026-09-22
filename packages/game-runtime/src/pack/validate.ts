import { toReadableIssues } from "@escaperoom/shared/schemas";
import type { RuntimeModel } from "../loader";
import { collectRequiredFrames } from "./frames";
import {
  DEFAULT_PACK_PROJECTION,
  PackManifestSchema,
  safeParsePackManifest,
  type PackManifest,
} from "./manifest";

/**
 * Validador de pack (specs/22 §2, specs/26 §10): comprueba que el manifiesto
 * cumple el contrato Zod, que la proyección es 2:1 y que **todo** frame
 * referenciado por el `RoomPackage` (tiles, sprites, iconos) está declarado.
 *
 * Devuelve una lista de incidencias con severidad en lugar de lanzar, para
 * poder reportarlas juntas (CLI `pack:build`, logs del servidor y tests).
 */

export interface PackValidationIssue {
  /** Ruta del campo, p. ej. `tiles.10.collides`; `""` = raíz. */
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface PackValidationResult {
  ok: boolean;
  issues: PackValidationIssue[];
  manifest?: PackManifest;
}

/** `true` si no hay ninguna incidencia de severidad `error`. */
export function hasErrors(issues: readonly PackValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

/** Formatea las incidencias como texto legible de varias líneas. */
export function formatPackIssues(issues: readonly PackValidationIssue[]): string {
  return issues
    .map(
      (issue) =>
        `${issue.severity === "error" ? "✗" : "⚠"} ${issue.path || "(raíz)"}: ${issue.message}`,
    )
    .join("\n");
}

/** Valida el contrato del manifiesto (forma, proyección 2:1, atlas y keys). */
export function validatePackManifest(input: unknown): PackValidationResult {
  const parsed = safeParsePackManifest(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: toReadableIssues(parsed.error).map((issue) => ({
        path: issue.path,
        message: issue.message,
        severity: "error" as const,
      })),
    };
  }

  const manifest = parsed.data;
  const issues: PackValidationIssue[] = [];

  if (
    manifest.projection.tileWidth !== DEFAULT_PACK_PROJECTION.tileWidth ||
    manifest.projection.tileHeight !== DEFAULT_PACK_PROJECTION.tileHeight
  ) {
    issues.push({
      path: "projection",
      message: `la proyección de v1 es ${DEFAULT_PACK_PROJECTION.tileWidth}×${DEFAULT_PACK_PROJECTION.tileHeight} (2:1); recibido ${manifest.projection.tileWidth}×${manifest.projection.tileHeight}.`,
      severity: "warning",
    });
  }

  for (const atlas of manifest.atlases) {
    if (!manifest.keys.includes(atlas.key)) {
      issues.push({
        path: `atlases.${atlas.key}`,
        message: `el atlas "${atlas.key}" no está en keys y no se precargará.`,
        severity: "warning",
      });
    }
  }

  return { ok: !hasErrors(issues), issues, manifest };
}

/**
 * Comprueba que el manifiesto cubre el `RoomPackage`: un frame por cada
 * sprite/icono y una entrada `tiles` (con `collides` explícito) por cada
 * `tileId` no nulo.
 */
export function validatePackAgainstModel(
  manifest: PackManifest,
  model: RuntimeModel,
): PackValidationIssue[] {
  const required = collectRequiredFrames(model);
  const issues: PackValidationIssue[] = [];

  for (const tileId of required.tiles) {
    const entry = manifest.tiles[String(tileId)];
    if (!entry) {
      issues.push({
        path: `tiles.${tileId}`,
        message: `falta la entrada del tileId ${tileId} en manifest.tiles (frame + collides).`,
        severity: "error",
      });
    } else if (typeof entry.collides !== "boolean") {
      issues.push({
        path: `tiles.${tileId}.collides`,
        message: `el tileId ${tileId} debe declarar "collides" de forma explícita.`,
        severity: "error",
      });
    }
  }

  for (const sprite of required.sprites) {
    if (!manifest.sprites[sprite]) {
      issues.push({
        path: `sprites.${sprite}`,
        message: `falta el frame del sprite "${sprite}" en manifest.sprites.`,
        severity: "error",
      });
    }
  }

  for (const icon of required.icons) {
    if (!manifest.ui.icons[icon]) {
      issues.push({
        path: `ui.icons.${icon}`,
        message: `falta el frame del icono "${icon}" en manifest.ui.icons.`,
        severity: "error",
      });
    }
  }

  return issues;
}

/**
 * Valida un pack completo contra un modelo: contrato del manifiesto +
 * cobertura de todos los frames del `RoomPackage`.
 */
export function validatePack(input: unknown, model: RuntimeModel): PackValidationResult {
  const structural = validatePackManifest(input);
  if (!structural.manifest) {
    return structural;
  }

  const issues = [...structural.issues, ...validatePackAgainstModel(structural.manifest, model)];
  return { ok: !hasErrors(issues), issues, manifest: structural.manifest };
}

/**
 * Comprueba que cada frame declarado por el manifiesto existe en alguno de sus
 * atlas. `framesByAtlas` mapea la clave de atlas a sus nombres de frame (se
 * obtiene del JSON de atlas). Se usa en `pack:build` para no publicar packs con
 * frames fantasma.
 */
export function validateAtlasFrames(
  manifest: PackManifest,
  framesByAtlas: Record<string, ReadonlySet<string>>,
): PackValidationIssue[] {
  const declared = new Set<string>();
  for (const atlasFrames of Object.values(framesByAtlas)) {
    for (const frame of atlasFrames) {
      declared.add(frame);
    }
  }

  const referenced = new Set<string>();
  for (const entry of Object.values(manifest.tiles)) {
    referenced.add(entry.frame);
  }
  for (const entry of Object.values(manifest.sprites)) {
    referenced.add(entry.frame);
  }
  for (const frame of Object.values(manifest.ui.icons)) {
    referenced.add(frame);
  }
  referenced.add(manifest.fx.spark);
  for (const anim of manifest.anims) {
    for (const frame of anim.frames) {
      referenced.add(frame);
    }
  }

  const issues: PackValidationIssue[] = [];
  for (const frame of [...referenced].sort()) {
    if (!declared.has(frame)) {
      issues.push({
        path: "atlases",
        message: `el frame "${frame}" está declarado en el manifiesto pero no existe en ningún atlas.`,
        severity: "error",
      });
    }
  }

  return issues;
}

export { PackManifestSchema };
