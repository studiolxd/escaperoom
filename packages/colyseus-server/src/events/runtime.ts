import { isDevFallbackAllowed } from "@escaperoom/env";
import type { EventRuntimeStore } from "@escaperoom/shared/event-runtime";
import { loadReyAldricRoomPackage } from "../game/room-packages.js";

/**
 * De dónde saca la room `event` el paquete de cada evento y dónde persiste los
 * hitos (ticket 5.12).
 *
 * - En producción lo configura `main.ts` con Postgres
 *   (`createPrismaEventRuntimeStore`); sin `DATABASE_URL` no hay runtime y la
 *   room `event` rechaza crearse (`EVENT_UNAVAILABLE`): nunca juega un paquete
 *   que no sea el publicado del evento.
 * - Fuera de producción y sin configurar, se usa el **fixture del Rey Aldric**
 *   sin persistencia (el comportamiento de 5.8/5.9): así el desarrollo sin base
 *   de datos y los tests que no la necesitan siguen funcionando.
 * - Los tests inyectan un store en memoria con `configureEventRuntime`.
 */

let configured: EventRuntimeStore | null | undefined;

/** Runtime de desarrollo: el fixture para cualquier evento y ninguna escritura. */
export const FIXTURE_EVENT_RUNTIME: EventRuntimeStore = {
  async loadEventPackage(eventId) {
    return {
      eventId,
      roomVersionId: "fixture",
      roomPackage: loadReyAldricRoomPackage(),
      allowVideo: false,
      allGroupsStartTogether: false,
      anyGroupAlreadyStarted: false,
    };
  },
  async recordMilestone() {},
};

/** Fija el runtime (`null` lo desactiva; `undefined` vuelve al valor por defecto). */
export function configureEventRuntime(store: EventRuntimeStore | null | undefined): void {
  configured = store;
}

/** Runtime en uso; `null` si no hay ninguno (producción sin base de datos). */
export function getEventRuntime(): EventRuntimeStore | null {
  if (configured !== undefined) return configured;
  return isDevFallbackAllowed() ? FIXTURE_EVENT_RUNTIME : null;
}
