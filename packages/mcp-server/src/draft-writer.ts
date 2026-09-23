import { RoomDocError, RoomLanguageError, listIds } from "@escaperoom/editor/room-doc";
import { buildDraftDoc, RoomDraftError, type Actor } from "@escaperoom/shared/services";
import * as Y from "yjs";
import type { CreatorMcpDeps } from "./deps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  defaultSnapshotCache,
  describeValidation,
  DraftSnapshotCache,
  judgeMutation,
  snapshotDraft,
  type DraftSnapshot,
  type MutationValidation,
} from "./mutation-validation";
import { textResult, ToolError } from "./results";
import { draftErrorToToolError, type DraftDoc, type RoomDocToPackage } from "./room-draft-reader";

/**
 * Escritura del MCP en el draft (specs/10 §3, ADR-010): cada tool que muta es
 * UNA transacción Yjs con los comandos de la sala (`@escaperoom/editor/room-doc`,
 * los mismos del editor) sobre el doc reconstruido del draft (3.2). El update
 * resultante se entrega al canal del editor:
 *
 * - con `deps.liveSync` (servidor del WebSocket de edición en el mismo proceso,
 *   3.3), se integra en el doc vivo → los editores conectados lo ven al
 *   instante y se persiste por la misma cola que sus propios updates;
 * - sin él, se persiste con `RoomDraftService.appendUpdate`, igual que
 *   `POST /api/rooms/:roomId/update`; un editor abierto lo recibe al
 *   reconectar (los updates Yjs conmutan: no se pierde nada).
 */

/**
 * Canal del editor en vivo: lo implementa `EditorSyncServer.applyUpdate`
 * (`@escaperoom/editor/sync-server`). Es un puerto para no acoplar el MCP al
 * transporte del WebSocket.
 */
export type LiveDraftSync = {
  applyUpdate(actor: Actor, roomId: string, update: Uint8Array): Promise<void>;
};

/** Mutación ya aplicada en memoria y a punto de confirmarse. */
export type PendingDraftCommit = {
  tool: string;
  roomId: string;
  actor: Actor;
  /** Doc del draft CON la mutación aplicada (solo lectura). */
  doc: DraftDoc;
  /** Update Yjs que se va a persistir. */
  update: Uint8Array;
};

/**
 * Enganche extra previo al commit: corre DESPUÉS del validador incremental de
 * 4.4 (y nunca en dry-run). Si lanza un `ToolError`, no se escribe nada y el
 * agente recibe el error.
 */
export type BeforeDraftCommit = (pending: PendingDraftCommit) => void | Promise<void>;

type DocListing = { label: string; collection: Parameters<typeof listIds>[1] };

/** Colección cuyos ids se sugieren al agente según el error del comando. */
const LISTING_BY_REASON: Partial<Record<RoomDocError["code"], DocListing>> = {
  UNKNOWN_ROOM: { label: "Habitaciones disponibles", collection: "subrooms" },
  UNKNOWN_OBJECT: { label: "Objetos disponibles", collection: "objects" },
  UNKNOWN_PUZZLE: { label: "Puzzles disponibles", collection: "puzzles" },
  UNKNOWN_ITEM: { label: "Items disponibles", collection: "items" },
  UNKNOWN_DIALOG: { label: "Diálogos disponibles", collection: "dialogs" },
};

/**
 * Traduce un error de los comandos de la sala a un error accionable
 * (specs/10 §3): qué falló y, si aplica, qué ids hay disponibles.
 */
export function roomDocErrorToToolError(error: RoomDocError, doc: Y.Doc): ToolError {
  const listing = LISTING_BY_REASON[error.code];
  if (listing) {
    const available = listIds(doc, listing.collection);
    const list = available.length > 0 ? available.join(", ") : "ninguna todavía";
    return new ToolError("NOT_FOUND", `${error.message}. ${listing.label}: [${list}]`, {
      reason: error.code,
      available,
    });
  }
  const hint =
    error.code === "DUPLICATE_ID"
      ? ". Usa otro id o `replace: true` para sustituir la entrada"
      : "";
  return new ToolError("INVALID_INPUT", `${error.message}${hint}`, { reason: error.code });
}

/** Errores de los comandos (sala o idiomas) → `ToolError`; el resto se relanza. */
export function commandErrorToToolError(error: unknown, doc: Y.Doc): unknown {
  if (error instanceof RoomDocError) return roomDocErrorToToolError(error, doc);
  if (error instanceof RoomLanguageError) {
    return new ToolError("INVALID_INPUT", error.message, { reason: error.code });
  }
  return error;
}

/** Entrega un update al canal del editor (sesión viva o persistencia directa). */
async function commitUpdate(
  deps: CreatorMcpDeps,
  actor: Actor,
  roomId: string,
  update: Uint8Array,
): Promise<void> {
  try {
    if (deps.liveSync) await deps.liveSync.applyUpdate(actor, roomId, update);
    else await deps.drafts.appendUpdate(actor, roomId, update);
  } catch (error) {
    if (error instanceof RoomDraftError) throw draftErrorToToolError(error);
    throw error;
  }
}

/** Resultado de una mutación que ha pasado el pipeline. */
export type MutationOutcome<T> = {
  tool: string;
  result: T;
  /** `false` si la transacción no cambió nada (no se valida ni se escribe). */
  changed: boolean;
  /** `true` si era un ensayo: se validó pero NO se escribió. */
  dryRun: boolean;
  /** Veredicto del validador incremental; `null` si no se validó. */
  validation: MutationValidation | null;
};

/**
 * Pipeline común de las tools que mutan (specs/10 §3, ticket 4.4). El paso 1
 * (Zod) lo hace el SDK con el `inputSchema` de la tool; aquí:
 *
 * 2. dry-run: aplica `mutate` como UNA transacción sobre el doc reconstruido
 *    del draft (una copia en memoria: el doc real es el del canal del editor)
 *    y serializa el resultado una sola vez;
 * 3. validador incremental: compara la foto de después con la de antes (de la
 *    caché si la hay; si no, de una segunda reconstrucción del draft). Si el
 *    paquete no cambia (un `replace` idéntico), se reutiliza el informe;
 * 4. si introduce ❌ nuevos lanza `VALIDATION_FAILED` con el error accionable
 *    (nada se escribe); si solo introduce 🟡, sigue y los devuelve;
 * 5. commit del update de la transacción al canal del editor (salvo `dryRun`).
 *
 * La autorización es la del servicio del draft: solo el autor.
 */
export async function mutateDraft<T>(
  ctx: { actor: Actor; deps: CreatorMcpDeps; tool: string; dryRun?: boolean },
  roomId: string,
  mutate: (doc: DraftDoc) => T,
): Promise<MutationOutcome<T>> {
  const { actor, deps, tool } = ctx;
  const dryRun = ctx.dryRun === true;
  let draft;
  try {
    draft = await deps.drafts.loadDraft(actor, roomId);
  } catch (error) {
    if (error instanceof RoomDraftError) throw draftErrorToToolError(error);
    throw error;
  }
  const doc = buildDraftDoc(draft);
  try {
    const cache = deps.snapshotCache ?? defaultSnapshotCache;
    const toPackage = deps.roomDocToPackage;
    const beforeKey = toPackage ? DraftSnapshotCache.key(roomId, doc) : null;

    let result!: T;
    // El evento `update` de Yjs emite el diff exacto de la transacción, y solo
    // si cambió algo: ese es el update que se confirma.
    let update = null as Uint8Array | null;
    const onUpdate = (diff: Uint8Array) => {
      update = diff;
    };
    doc.on("update", onUpdate);
    try {
      doc.transact(() => {
        result = mutate(doc);
      }, tool);
    } catch (error) {
      throw commandErrorToToolError(error, doc);
    } finally {
      doc.off("update", onUpdate);
    }
    if (!update) return { tool, result, changed: false, dryRun, validation: null };

    let validation: MutationValidation | null = null;
    let afterEntry: { key: string; snapshot: DraftSnapshot } | null = null;
    if (toPackage && beforeKey) {
      const before = cache.get(beforeKey) ?? snapshotBaseline(draft, toPackage);
      cache.set(beforeKey, before);
      const after = snapshotDraft(doc, toPackage, before);
      validation = judgeMutation(tool, before, after, { dryRun });
      afterEntry = { key: DraftSnapshotCache.key(roomId, doc), snapshot: after };
    }
    if (afterEntry) cache.set(afterEntry.key, afterEntry.snapshot);
    if (dryRun) return { tool, result, changed: true, dryRun, validation };

    await deps.beforeCommit?.({ tool, roomId, actor, doc, update });
    await commitUpdate(deps, actor, roomId, update);
    return { tool, result, changed: true, dryRun, validation };
  } finally {
    doc.destroy();
  }
}

/** Foto del draft tal y como estaba (reconstrucción aparte: el doc de trabajo ya mutó). */
function snapshotBaseline(
  draft: Parameters<typeof buildDraftDoc>[0],
  toPackage: RoomDocToPackage,
): DraftSnapshot {
  const doc = buildDraftDoc(draft);
  try {
    return snapshotDraft(doc, toPackage);
  } finally {
    doc.destroy();
  }
}

/**
 * Resultado MCP de una mutación: el texto de éxito de la tool (`✅ tool — …`)
 * más el veredicto del validador (avisos 🟡 nuevos, errores pendientes). En
 * dry-run el prefijo pasa a `🧪 tool (dry-run) —` y se aclara que no se
 * escribió nada.
 */
export function mutationResult(
  outcome: MutationOutcome<unknown>,
  text: string,
  structured: Record<string, unknown>,
): CallToolResult {
  const lines = [
    outcome.dryRun ? text.replace(`✅ ${outcome.tool} —`, `🧪 ${outcome.tool} (dry-run) —`) : text,
  ];
  if (!outcome.changed) lines.push("ℹ️ Sin cambios: el draft ya estaba así.");
  if (outcome.validation) lines.push(...describeValidation(outcome.validation));
  if (outcome.dryRun) lines.push("🧪 dryRun: true — no se ha escrito nada en el draft.");
  return textResult(lines.join("\n"), {
    ...structured,
    ...(outcome.dryRun ? { dryRun: true } : {}),
    ...(outcome.validation ? { validation: outcome.validation } : {}),
  });
}
