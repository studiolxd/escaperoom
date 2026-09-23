import { formatRoomPackageError, safeParseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  buildDraftDoc,
  RoomDraftError,
  type Actor,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { ToolError } from "./results";

/** Doc Yjs del draft tal y como lo reconstruye el servicio de 3.2. */
export type DraftDoc = ReturnType<typeof buildDraftDoc>;

/**
 * Conversión doc Yjs → `RoomPackage` (specs/09 §2). La implementa el ticket
 * 3.1 en paralelo; aquí es una dependencia inyectable para no depender de
 * código no publicado. Devuelve el `RoomPackage` sin validar (se valida aquí
 * con el esquema compartido).
 */
export type RoomDocToPackage = (doc: DraftDoc) => unknown;

/**
 * Lee el draft de una sala como `RoomPackage` validado, pasando por el MISMO
 * servicio del draft que las rutas REST del editor (autorización incluida).
 */
export async function readDraftRoomPackage(
  deps: { drafts: RoomDraftService; roomDocToPackage?: RoomDocToPackage },
  actor: Actor,
  roomId: string,
): Promise<RoomPackage> {
  if (!deps.roomDocToPackage) {
    throw new ToolError(
      "NOT_AVAILABLE",
      "la conversión del doc Yjs a RoomPackage aún no está cableada en este servidor (ticket 3.1)",
    );
  }
  let draft;
  try {
    draft = await deps.drafts.loadDraft(actor, roomId);
  } catch (error) {
    if (error instanceof RoomDraftError) throw draftErrorToToolError(error);
    throw error;
  }
  const doc = buildDraftDoc(draft);
  let raw: unknown;
  try {
    raw = deps.roomDocToPackage(doc);
  } finally {
    doc.destroy();
  }
  const parsed = safeParseRoomPackage(raw);
  if (!parsed.success) {
    throw new ToolError(
      "INVALID_DRAFT",
      `el draft no es un RoomPackage válido todavía:\n${formatRoomPackageError(parsed.error)}`,
    );
  }
  return parsed.data;
}

function draftErrorToToolError(error: RoomDraftError): ToolError {
  switch (error.code) {
    case "UNAUTHORIZED":
      return new ToolError("UNAUTHORIZED", error.message);
    case "FORBIDDEN":
      return new ToolError("FORBIDDEN", error.message);
    case "NOT_FOUND":
      return new ToolError("NOT_FOUND", error.message);
    default:
      return new ToolError("INTERNAL", error.message);
  }
}
