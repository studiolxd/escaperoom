/**
 * Persistencia local de reconexión de la `GameRoom` desnuda (C-2, ajuste
 * 2026-09-25): la revisión de la coordinadora sobre la PR #146 señaló que el
 * criterio "cualquiera puede reconectarse hasta que acabe la partida" no se
 * cumplía desde el cliente en el caso principal (compras B2C y `/es/play`):
 * `use-game-connection.ts` solo reintentaba con el SDK dentro de la misma
 * página cargada; recargar o cerrar y reabrir la pestaña perdía el
 * `reconnectionToken` en memoria y entraba como jugador NUEVO, mientras la
 * plaza antigua quedaba reservada vacía hasta el fin de la partida.
 *
 * Dos piezas, guardadas juntas por `roomId` en `localStorage` (sobrevive a
 * cerrar y reabrir la pestaña; `sessionStorage` no):
 * - `reconnectionToken` de Colyseus: reconexión nativa (recupera la MISMA
 *   `sessionId`, sin pasar por `onJoin`). Se refresca en cada
 *   `join`/`reconnect`/`reconnect` exitoso (el SDK emite uno nuevo cada vez).
 * - `seatKey`: identidad de plaza estable por navegador (nunca ligada a una
 *   cuenta), para cuando el token de arriba se pierde, caduca o se rechaza
 *   (`GameRoom.onJoin`, servidor, la trata como `EventRoom` trata el
 *   `playerId` del `joinToken`: la nueva conexión hereda la plaza).
 */

const PREFIX = "escaperoom:game-reconnect:";

export interface GameReconnectEntry {
  seatKey: string;
  reconnectionToken: string;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Lee la entrada guardada para `roomId`, o `null` si no hay ninguna (o es ilegible). */
export function readGameReconnect(roomId: string): GameReconnectEntry | null {
  const raw = safeLocalStorage()?.getItem(`${PREFIX}${roomId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GameReconnectEntry>;
    if (typeof parsed.seatKey !== "string" || parsed.seatKey.length === 0) return null;
    return {
      seatKey: parsed.seatKey,
      reconnectionToken:
        typeof parsed.reconnectionToken === "string" ? parsed.reconnectionToken : "",
    };
  } catch {
    return null;
  }
}

/** Guarda (o sustituye) la entrada de `roomId`. Sin almacenamiento (modo privado), no-op. */
export function writeGameReconnect(roomId: string, entry: GameReconnectEntry): void {
  try {
    safeLocalStorage()?.setItem(`${PREFIX}${roomId}`, JSON.stringify(entry));
  } catch {
    // Sin almacenamiento: se pierde la persistencia, no el join.
  }
}

/** Borra la entrada de `roomId` (partida terminada, o token rechazado sin remedio). */
export function clearGameReconnect(roomId: string): void {
  try {
    safeLocalStorage()?.removeItem(`${PREFIX}${roomId}`);
  } catch {
    // Ídem.
  }
}

/** `seatKey` nuevo: aleatorio, sin relación con ninguna cuenta ni sesión de servidor. */
export function createSeatKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `seat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
