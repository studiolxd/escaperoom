import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toReadableIssues } from "../schemas/errors";
import {
  AccessKeyError,
  normalizeAccessKeyCode,
  OPEN_SESSION_STATUSES,
  type AccessKeyRow,
  type AccessKeyService,
  type AccessKeyStore,
  type GroupSeats,
  type SeatAssignment,
  type SessionSeats,
} from "./access-keys";
import { isAnonymous, type Actor } from "./actor";
import type { EventRow } from "./events";
import { signJoinToken } from "./join-token";

/**
 * Canje de claves y agrupación (ticket 5.8, specs/02 §3.3 y §4.5, specs/13 §6.2).
 *
 * `redeem({ code })` valida la clave, consume un asiento con `consumeSeat`
 * (escritura condicional + aforo bajo bloqueo de la sesión) y devuelve un
 * `joinToken` firmado que la room de evento de Colyseus exige en el `join`.
 *
 * Asignación según `event.groupingMode`:
 * - **`specific`**: manda la sesión/grupo preasignados en la clave. Una clave
 *   sin preasignar (p. ej. las generadas al activar) se reparte como `random`.
 * - **`random`**: la sesión abierta con más hueco relativo (menor
 *   ocupación/aforo; empate → la primera creada). Dentro, el grupo con menos
 *   gente, si la sesión tiene grupos.
 * - **`free`**: el asistente elige `sessionId` (sin él → `SESSION_REQUIRED` con
 *   las sesiones elegibles); `groupId` opcional, si no se equilibra.
 *
 * Una clave compartida (grupo/rotativa) queda fijada a la sesión/grupo de su
 * primer canje: el resto de sus asientos entran en la misma sesión.
 *
 * **Invitados sin cuenta**: no se crea usuario. Cada canje anónimo recibe una
 * identidad efímera `guest:<uuid>` que solo vive en el `joinToken`, con el
 * nombre visible que el invitado escriba (o "Invitado"). Con sesión, la
 * identidad es `user:<id>`.
 */

/** Nombre visible por defecto de un invitado que no escribe ninguno. */
export const DEFAULT_GUEST_NAME = "Invitado";
/** Longitud máxima del nombre visible (la misma que acepta la `GameRoom`). */
export const MAX_DISPLAY_NAME_LENGTH = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "UUID no válido");

/** Cuerpo de `POST /api/access-keys/redeem`. */
export const RedeemAccessKeyInput = z
  .object({
    code: z.string().min(1).max(64),
    displayName: z.string().max(200).optional(),
    /** Solo en `groupingMode: free`: sesión elegida por el asistente. */
    sessionId: uuid.optional(),
    /** Solo en `groupingMode: free`: grupo elegido dentro de la sesión (opcional). */
    groupId: uuid.optional(),
  })
  .strict();

/** Sesión elegible en `free` (lo que ve el asistente para elegir). */
export type EligibleSession = { id: string; name: string; capacity: number; available: number };

export type RedeemResult = {
  eventId: string;
  sessionId: string;
  groupId: string | null;
  /** URL WebSocket de Colyseus. */
  colyseusEndpoint: string;
  /** Room de Colyseus a la que unirse con `{ sessionId, joinToken }`. */
  roomName: string;
  joinToken: string;
  /** Caducidad del `joinToken`. */
  expiresAt: Date;
  player: { id: string; displayName: string; guest: boolean };
};

/** Limpia el nombre visible (como `sanitizeName` de la `GameRoom`): sin control ni `<>`, acotado. */
export function sanitizeDisplayName(raw: string | undefined): string {
  const clean = (raw ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
  return clean || DEFAULT_GUEST_NAME;
}

function isOpen(s: SessionSeats): boolean {
  return OPEN_SESSION_STATUSES.includes(s.status);
}

function hasRoom(s: SessionSeats): boolean {
  return isOpen(s) && s.occupied < s.capacity;
}

/** Sesión con más hueco relativo; empate → la primera (orden de creación). */
export function pickBalancedSession(sessions: SessionSeats[]): SessionSeats | null {
  let best: SessionSeats | null = null;
  for (const s of sessions) {
    if (!hasRoom(s)) continue;
    if (!best || s.occupied / s.capacity < best.occupied / best.capacity) best = s;
  }
  return best;
}

/** Grupo con menos gente; empate → el primero creado. `null` si la sesión no tiene grupos. */
export function pickBalancedGroup(groups: GroupSeats[]): GroupSeats | null {
  let best: GroupSeats | null = null;
  for (const g of groups) if (!best || g.occupied < best.occupied) best = g;
  return best;
}

function eligible(sessions: SessionSeats[]): EligibleSession[] {
  return sessions.filter(hasRoom).map((s) => ({
    id: s.id,
    name: s.name,
    capacity: s.capacity,
    available: s.capacity - s.occupied,
  }));
}

function sessionFull(): AccessKeyError {
  return new AccessKeyError("SESSION_FULL", "La sesión no admite más jugadores");
}

export function createRedeemService(deps: {
  store: Pick<AccessKeyStore, "findKey" | "findEvent" | "listSessionSeats" | "listGroupSeats">;
  accessKeys: Pick<AccessKeyService, "consumeSeat">;
  /** Firma del `joinToken` (`JOIN_TOKEN_SECRET`) y su vida en segundos. */
  joinToken: { secret: string; ttlSeconds: number };
  colyseusEndpoint: string;
  roomName: string;
  now?: () => Date;
  newGuestId?: () => string;
}) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const newGuestId = deps.newGuestId ?? randomUUID;

  /** Asignador que `consumeSeat` reevalúa en cada intento con la clave recién leída. */
  function assigner(event: EventRow, input: { sessionId?: string; groupId?: string }) {
    return async (key: AccessKeyRow): Promise<SeatAssignment> => {
      const sessions = await store.listSessionSeats(event.id);
      let session: SessionSeats | null;
      let chosenGroupId: string | undefined;

      if (key.sessionId !== null) {
        // Preasignada (`specific`) o compartida ya fijada por su primer canje.
        session = sessions.find((s) => s.id === key.sessionId) ?? null;
      } else if (event.groupingMode === "free") {
        if (input.sessionId === undefined) {
          throw new AccessKeyError(
            "SESSION_REQUIRED",
            "Elige una sesión para entrar",
            [{ path: "sessionId", message: "Elige una sesión" }],
            { sessions: eligible(sessions) },
          );
        }
        session = sessions.find((s) => s.id === input.sessionId) ?? null;
        if (!session) {
          throw new AccessKeyError("VALIDATION_ERROR", "Datos no válidos", [
            { path: "sessionId", message: "La sesión no pertenece al evento" },
          ]);
        }
        chosenGroupId = input.groupId;
      } else {
        // `random`, o `specific` con la clave sin preasignar.
        session = pickBalancedSession(sessions);
      }
      if (!session || !hasRoom(session)) throw sessionFull();

      if (key.groupId !== null) return { sessionId: session.id, groupId: key.groupId };
      const groups = await store.listGroupSeats(session.id);
      if (chosenGroupId !== undefined) {
        if (!groups.some((g) => g.id === chosenGroupId)) {
          throw new AccessKeyError("VALIDATION_ERROR", "Datos no válidos", [
            { path: "groupId", message: "El grupo no pertenece a esa sesión" },
          ]);
        }
        return { sessionId: session.id, groupId: chosenGroupId };
      }
      return { sessionId: session.id, groupId: pickBalancedGroup(groups)?.id ?? null };
    };
  }

  return {
    /**
     * `POST /api/access-keys/redeem` — público (puede no haber cuenta). Consume
     * un asiento y devuelve el `joinToken`. Errores: `ACCESS_KEY_INVALID`,
     * `ACCESS_KEY_USED`, `ACCESS_KEY_EXPIRED`, `ACCESS_KEY_NOT_CONFIRMED`,
     * `SESSION_FULL`, `SESSION_REQUIRED` (solo `free`).
     */
    async redeem(actor: Actor, input: unknown): Promise<RedeemResult> {
      const parsed = RedeemAccessKeyInput.safeParse(input);
      if (!parsed.success) {
        throw new AccessKeyError(
          "VALIDATION_ERROR",
          "Datos no válidos",
          toReadableIssues(parsed.error),
        );
      }
      const data = parsed.data;
      const code = normalizeAccessKeyCode(data.code);
      const key = code ? await store.findKey(code) : null;
      if (!key) throw new AccessKeyError("ACCESS_KEY_INVALID", "Clave no válida");
      const event = await store.findEvent(key.eventId);
      // Un evento sin activar no ha repartido claves canjeables; uno cerrado ya pasó.
      if (!event || event.status === "draft") {
        throw new AccessKeyError("ACCESS_KEY_INVALID", "Clave no válida");
      }
      if (event.status === "closed") {
        throw new AccessKeyError("ACCESS_KEY_EXPIRED", "El evento ya ha terminado");
      }

      const redeemed = await deps.accessKeys.consumeSeat(
        key.code,
        assigner(event, {
          ...(data.sessionId === undefined ? {} : { sessionId: data.sessionId }),
          ...(data.groupId === undefined ? {} : { groupId: data.groupId }),
        }),
      );

      const guest = isAnonymous(actor);
      const player = {
        id: guest ? `guest:${newGuestId()}` : `user:${actor.userId}`,
        displayName: sanitizeDisplayName(data.displayName),
        guest,
      };
      const issuedAt = now().getTime();
      const expiresAt = issuedAt + deps.joinToken.ttlSeconds * 1000;
      const sessionId = redeemed.sessionId!;
      const joinToken = signJoinToken(
        deps.joinToken.secret,
        {
          playerId: player.id,
          displayName: player.displayName,
          eventId: event.id,
          sessionId,
          groupId: redeemed.groupId,
        },
        { now: issuedAt, expiresAt },
      );
      return {
        eventId: event.id,
        sessionId,
        groupId: redeemed.groupId,
        colyseusEndpoint: deps.colyseusEndpoint,
        roomName: deps.roomName,
        joinToken,
        expiresAt: new Date(Math.floor(expiresAt / 1000) * 1000),
        player,
      };
    },
  };
}

export type RedeemService = ReturnType<typeof createRedeemService>;
