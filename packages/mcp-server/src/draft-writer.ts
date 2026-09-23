import { RoomDocError, RoomLanguageError, listIds } from "@escaperoom/editor/room-doc";
import { buildDraftDoc, RoomDraftError, type Actor } from "@escaperoom/shared/services";
import * as Y from "yjs";
import type { CreatorMcpDeps } from "./deps";
import { ToolError } from "./results";
import { draftErrorToToolError, type DraftDoc } from "./room-draft-reader";

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
 * Enganche previo al commit (specs/10 §3, pasos 2–4). Es el punto donde 4.4
 * conecta el dry-run con el validador incremental: si lanza un `ToolError`,
 * no se escribe nada y el agente recibe el error.
 */
export type BeforeDraftCommit = (pending: PendingDraftCommit) => void | Promise<void>;

type DocListing = { label: string; collection: Parameters<typeof listIds>[1] };

/** Colección cuyos ids se sugieren al agente según el error del comando. */
const LISTING_BY_REASON: Partial<Record<RoomDocError["code"], DocListing>> = {
  UNKNOWN_ROOM: { label: "Habitaciones disponibles", collection: "subrooms" },
  UNKNOWN_OBJECT: { label: "Objetos disponibles", collection: "objects" },
  UNKNOWN_PUZZLE: { label: "Puzzles disponibles", collection: "puzzles" },
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

/**
 * Aplica `mutate` sobre el draft como una transacción y la confirma. Devuelve
 * lo que devuelva `mutate` y si hubo cambios (sin cambios no se escribe nada).
 * La autorización es la del servicio del draft: solo el autor.
 */
export async function mutateDraft<T>(
  ctx: { actor: Actor; deps: CreatorMcpDeps; tool: string },
  roomId: string,
  mutate: (doc: DraftDoc) => T,
): Promise<{ result: T; changed: boolean }> {
  const { actor, deps, tool } = ctx;
  let draft;
  try {
    draft = await deps.drafts.loadDraft(actor, roomId);
  } catch (error) {
    if (error instanceof RoomDraftError) throw draftErrorToToolError(error);
    throw error;
  }
  const doc = buildDraftDoc(draft);
  try {
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
    if (!update) return { result, changed: false };
    await deps.beforeCommit?.({ tool, roomId, actor, doc, update });
    await commitUpdate(deps, actor, roomId, update);
    return { result, changed: true };
  } finally {
    doc.destroy();
  }
}
