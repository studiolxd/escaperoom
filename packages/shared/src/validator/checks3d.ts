import { getModels3DCatalog, type Models3DCatalog } from "../packs";
import type { RoomPackage } from "../schemas";
import { MAX_WORLD3D_CUSTOM_MODELS } from "../schemas/limits";
import { dimensionOf, positionFromTransform, type World3D } from "../schemas/world3d";
import type { SpriteState } from "../schemas/world";
import { resolveModel3D } from "../packs";
import type { ValidationIssue } from "./types";

/**
 * Checks del modo 3D (specs/27 §3 y §4). `checkWorld3D` son errores de
 * integridad del formato; `checkWorld3DModels` son avisos (un modelo que
 * todavía no existe se pinta como caja y no bloquea).
 */

/** Errores de integridad del mundo 3D, o de campos 3D colados en una sala 2D. */
export function checkWorld3D(pkg: RoomPackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (dimensionOf(pkg.meta) === "2d") {
    if (pkg.world3d) {
      issues.push({
        code: "dimension_field_in_2d",
        message: "La sala es 2D pero el documento lleva «world3d»: solo las salas 3D lo admiten",
        ids: [],
      });
    }
    for (const object of pkg.objects) {
      if (object.transform) {
        issues.push({
          code: "dimension_field_in_2d",
          message: `El objeto «${object.id}» lleva «transform» pero la sala es 2D`,
          ids: [object.id],
        });
      }
    }
    for (const room of pkg.map.rooms) {
      for (const spawn of room.spawnPoints) {
        if (spawn.h !== undefined || spawn.yaw !== undefined) {
          issues.push({
            code: "dimension_field_in_2d",
            message: `El spawnPoint «${spawn.id}» de «${room.id}» lleva «h»/«yaw» pero la sala es 2D`,
            ids: [spawn.id],
          });
        }
      }
      for (const light of room.lighting) {
        if (light.type === "torch" && light.h !== undefined) {
          const id = light.objectId ?? `${room.id}:torch`;
          issues.push({
            code: "dimension_field_in_2d",
            message: `La antorcha «${id}» de «${room.id}» lleva «h» pero la sala es 2D`,
            ids: [id],
          });
        }
      }
    }
    return issues;
  }

  const world3d = pkg.world3d;
  if (!world3d) {
    issues.push({
      code: "world3d_missing",
      message: "La sala es 3D pero el documento no lleva «world3d»",
      ids: [],
    });
    return issues;
  }

  const grids = new Map(pkg.map.rooms.map((room) => [room.id, room.grid]));

  for (const room of pkg.map.rooms) {
    if (room.layers.length > 0 || room.decorations.length > 0) {
      issues.push({
        code: "layers_in_3d",
        message: `La habitación «${room.id}» lleva «layers» o «decorations», que no se usan en 3D (la decoración son piezas)`,
        ids: [room.id],
      });
    }
  }

  for (const roomId of Object.keys(world3d.rooms)) {
    if (!grids.has(roomId)) {
      issues.push({
        code: "world3d_unknown_room",
        message: `«world3d.rooms» tiene piezas para «${roomId}», que no es una habitación del mapa`,
        ids: [roomId],
      });
    }
  }

  const outOfBounds = (roomId: string, x: number, y: number, label: string, id: string): void => {
    const grid = grids.get(roomId);
    if (!grid) return;
    if (x < 0 || x > grid.cols || y < 0 || y > grid.rows) {
      issues.push({
        code: "out_of_bounds_3d",
        message: `${label} en (${x}, ${y}) queda fuera de la caja de «${roomId}» (${grid.cols}×${grid.rows} m)`,
        ids: [id],
      });
    }
  };

  for (const object of pkg.objects) {
    if (!object.transform) {
      issues.push({
        code: "transform_missing",
        message: `El objeto «${object.id}» no tiene «transform», obligatorio en salas 3D`,
        ids: [object.id],
      });
    } else {
      const expected = positionFromTransform(object.transform);
      if (object.position.x !== expected.x || object.position.y !== expected.y) {
        issues.push({
          code: "transform_position_mismatch",
          message: `La posición de «${object.id}» (${object.position.x}, ${object.position.y}) no coincide con la derivada de su transform (${expected.x}, ${expected.y})`,
          ids: [object.id],
        });
      }
      outOfBounds(
        object.roomId,
        object.transform.x,
        object.transform.y,
        `el objeto «${object.id}»`,
        object.id,
      );
    }
    if (object.footprint !== undefined) {
      issues.push({
        code: "footprint_in_3d",
        message: `El objeto «${object.id}» declara «footprint», que no se usa en 3D (la huella sale del colisionador del modelo)`,
        ids: [object.id],
      });
    }
  }

  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const [roomId, room] of Object.entries(world3d.rooms)) {
    for (const piece of room.pieces) {
      if (seen.has(piece.id) && !reported.has(piece.id)) {
        reported.add(piece.id);
        issues.push({
          code: "piece_id_duplicate",
          message: `El id de pieza «${piece.id}» está repetido en el paquete`,
          ids: [piece.id],
        });
      }
      seen.add(piece.id);
      outOfBounds(roomId, piece.x, piece.y, `la pieza «${piece.id}»`, piece.id);
    }
  }

  const customCount = Object.keys(world3d.models).length;
  if (customCount > MAX_WORLD3D_CUSTOM_MODELS) {
    issues.push({
      code: "custom_models_limit",
      message: `«world3d.models» tiene ${customCount} modelos propios; el máximo es ${MAX_WORLD3D_CUSTOM_MODELS}`,
      ids: [],
    });
  }

  return issues;
}

/** Id de modelo de un estado: el suyo, o el del objeto si solo declara animación. */
function stateModel(object: { sprite: string }, state: SpriteState): string {
  if (typeof state === "string") return state;
  return state.sprite ?? object.sprite;
}

/** Avisos de modelos que no se resuelven o clips que el modelo no trae (solo salas 3D). */
export function checkWorld3DModels(pkg: RoomPackage, catalog?: Models3DCatalog): ValidationIssue[] {
  if (dimensionOf(pkg.meta) !== "3d") return [];
  const issues: ValidationIssue[] = [];
  const cat = catalog ?? getModels3DCatalog(pkg.map.tileset);
  const custom: World3D["models"] | undefined = pkg.world3d?.models;

  for (const [roomId, room] of Object.entries(pkg.world3d?.rooms ?? {})) {
    for (const piece of room.pieces) {
      if (!resolveModel3D(piece.model, cat, custom)) {
        issues.push({
          code: "unknown_model",
          message: `La pieza «${piece.id}» de «${roomId}» usa el modelo «${piece.model}», que no está en el catálogo del pack ni entre los propios (se pintará como caja)`,
          ids: [piece.id],
        });
      }
    }
  }

  for (const object of pkg.objects) {
    if (!resolveModel3D(object.sprite, cat, custom)) {
      issues.push({
        code: "unknown_model",
        message: `El objeto «${object.id}» usa el modelo «${object.sprite}», que no está en el catálogo del pack ni entre los propios (se pintará como caja)`,
        ids: [object.id],
      });
    }
    for (const [stateName, state] of Object.entries(object.states)) {
      const modelId = stateModel(object, state);
      const model = resolveModel3D(modelId, cat, custom);
      if (!model) {
        // `object.sprite` ya se avisó arriba; solo los sprites propios del estado.
        if (modelId !== object.sprite) {
          issues.push({
            code: "unknown_model",
            message: `El estado «${stateName}» de «${object.id}» usa el modelo «${modelId}», que no está en el catálogo del pack ni entre los propios (se pintará como caja)`,
            ids: [object.id],
          });
        }
        continue;
      }
      if (typeof state !== "string" && state.animation && !model.clips.includes(state.animation)) {
        issues.push({
          code: "unknown_clip",
          message: `El estado «${stateName}» de «${object.id}» pide el clip «${state.animation}», que el modelo «${modelId}» no trae`,
          ids: [object.id],
        });
      }
    }
  }

  return issues;
}
