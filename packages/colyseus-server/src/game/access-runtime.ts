import { isDevFallbackAllowed } from "@escaperoom/env";
import type { GameAccessStore } from "@escaperoom/shared/game-access";

/**
 * De dónde saca la `GameRoom` el paquete de una sala comprada y dónde
 * reclama la única partida de cada `purchase` (B-4, auditoría 2026-09-24).
 *
 * - En producción lo configura `main.ts` con Postgres
 *   (`createPrismaGameAccessStore`); sin `DATABASE_URL` la `GameRoom` rechaza
 *   crearse para un `gameToken` de compra (nunca juega sin poder reclamar la
 *   partida).
 * - Los tests inyectan un store en memoria con `configureGameAccessRuntime`.
 * - No hay fixture de desarrollo aquí (a diferencia de `events/runtime.ts`):
 *   la partida de prueba sin compra usa el `gameToken` `kind: "dev_test"`,
 *   que ni siquiera pasa por este runtime (ver `GameRoom.loadRoomPackage`).
 */

let configured: GameAccessStore | null | undefined;

/** Fija el runtime (`null` lo desactiva; `undefined` vuelve al valor por defecto). */
export function configureGameAccessRuntime(store: GameAccessStore | null | undefined): void {
  configured = store;
}

/** Runtime en uso; `null` si no hay ninguno configurado. */
export function getGameAccessRuntime(): GameAccessStore | null {
  if (configured !== undefined) return configured;
  return null;
}

/** ¿Puede esta room aceptar un `gameToken` `kind: "dev_test"`? Nunca en producción real. */
export function devTestGameTokenAllowed(): boolean {
  return isDevFallbackAllowed();
}
