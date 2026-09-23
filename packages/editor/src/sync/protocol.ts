import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

/**
 * Protocolo del WebSocket de edición (specs/09 §2). Misma trama que
 * y-websocket — `varUint(tipo)` + cuerpo — para reutilizar `y-protocols`
 * (sync step 1/2 + update, y awareness); se añade un mensaje propio de
 * restauración del historial. Este módulo no depende de Node: lo comparten el
 * proveedor (navegador) y el servidor.
 */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
/** Reservado (y-websocket lo usa para `auth`); aquí la auth va en el handshake HTTP. */
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;
/** Petición (cliente→servidor) y respuesta (servidor→cliente) de restauración. */
export const MESSAGE_RESTORE = 4;

/** Ruta del WebSocket de una sala: `/rooms/:roomId`. */
export const SYNC_PATH_PREFIX = "/rooms/";

/** URL del WebSocket de edición de una sala a partir de la base del servidor. */
export function roomSyncUrl(baseUrl: string, roomId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${SYNC_PATH_PREFIX}${encodeURIComponent(roomId)}`;
}

/** Punto del historial al que restaurar (ids `bigserial` como string en el cable). */
export type RestoreRequest = { snapshotId: string } | { updateId: string };

/**
 * Respuesta a una restauración: `changed: false` si no había nada posterior a
 * ese punto (el doc ya estaba ahí).
 */
export type RestoreResponse =
  { ok: true; changed: boolean } | { ok: false; code: string; message: string };

export function encodeRestoreRequest(requestId: number, target: RestoreRequest): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_RESTORE);
  encoding.writeVarUint(encoder, requestId);
  encoding.writeVarString(encoder, JSON.stringify(target));
  return encoding.toUint8Array(encoder);
}

export function encodeRestoreResponse(requestId: number, response: RestoreResponse): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_RESTORE);
  encoding.writeVarUint(encoder, requestId);
  encoding.writeVarString(encoder, JSON.stringify(response));
  return encoding.toUint8Array(encoder);
}

/** Lee `requestId` + JSON tras el tipo de mensaje (ya consumido). */
export function readRestorePayload(decoder: decoding.Decoder): {
  requestId: number;
  payload: unknown;
} {
  const requestId = decoding.readVarUint(decoder);
  const payload: unknown = JSON.parse(decoding.readVarString(decoder));
  return { requestId, payload };
}

/** Valida el cuerpo de una petición de restauración que llega del cliente. */
export function parseRestoreRequest(
  payload: unknown,
): { snapshotId: bigint } | { updateId: bigint } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const toId = (value: unknown) =>
    typeof value === "string" && /^\d{1,19}$/.test(value) ? BigInt(value) : null;
  if ("snapshotId" in record) {
    const id = toId(record.snapshotId);
    return id === null ? null : { snapshotId: id };
  }
  if ("updateId" in record) {
    const id = toId(record.updateId);
    return id === null ? null : { updateId: id };
  }
  return null;
}
