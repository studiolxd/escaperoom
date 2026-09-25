import type * as Y from "yjs";
import { CURRENT_ROOM_DOC_FORMAT, readRoomDocFormat, writeRoomDocFormat } from "./doc-model";

/**
 * Paso de migración del doc Yjs (auditoría D-24, ADR-028): se ejecuta ANTES de
 * `roomDocToPackage` (que a su vez alimenta a `parseRoomPackage`/Zod), igual
 * que `loadRoomPackage` reserva `migrate → parse` para el `RoomPackage` en
 * `@escaperoom/game-runtime`. Hoy es un no-op — `CURRENT_ROOM_DOC_FORMAT` es
 * la única versión que ha existido — pero fija el punto único donde un cambio
 * futuro de la FORMA del doc (colección nueva, campo movido) reescribiría un
 * doc viejo en memoria antes de leerlo, en vez de que cada llamador
 * (validador, publicación, MCP) tenga que saberlo.
 *
 * Un doc sin `docFormat` (anterior a que este campo existiera) se sella con la
 * versión actual: no hay nada que reescribir todavía, solo que dejar de estar
 * "sin marcar".
 */
export function migrateRoomDoc(doc: Y.Doc): void {
  const format = readRoomDocFormat(doc);
  if (format >= CURRENT_ROOM_DOC_FORMAT) return;
  doc.transact(() => {
    // Sin pasos de migración reales todavía (ver el comentario de arriba):
    // solo sellar la versión.
    writeRoomDocFormat(doc);
  });
}
