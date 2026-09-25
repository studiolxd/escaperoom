import { requireUser } from "./common";
import type { Actor } from "./actor";

/**
 * `GET /api/me` (A-24): antes la `route.ts` llamaba a `auth.api.getSession`
 * directo (saltándose `resolveActorFromRequest`/`no-store`, distinto del
 * resto de rutas) y traía la organización y TODAS las columnas de
 * `creditAccount` con `include: {...}` completo para exponer 3 campos.
 */

export type MeErrorCode = "UNAUTHORIZED" | "NOT_FOUND";

export class MeError extends Error {
  code: MeErrorCode;
  constructor(code: MeErrorCode, message: string) {
    super(message);
    this.name = "MeError";
    this.code = code;
  }
}

export type MeProfileRow = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  locale: string;
  isAdmin: boolean;
  isModerator: boolean;
  personalBalanceCredits: bigint;
  organizations: { id: string; name: string; slug: string; role: string }[];
};

/** Puerto de lectura del perfil (Prisma selecciona solo estos campos, nunca la fila entera). */
export interface MeStore {
  findProfile(userId: string): Promise<MeProfileRow | null>;
}

export type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    locale: string;
    isAdmin: boolean;
    isModerator: boolean;
  };
  personalCredits: number;
  organizations: { id: string; name: string; slug: string; role: string }[];
};

function toResponse(row: MeProfileRow): MeResponse {
  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
      locale: row.locale,
      isAdmin: row.isAdmin,
      isModerator: row.isModerator,
    },
    personalCredits: Number(row.personalBalanceCredits),
    organizations: row.organizations,
  };
}

export function createMeService(deps: { store: MeStore }) {
  return {
    async getProfile(actor: Actor): Promise<MeResponse> {
      requireUser(actor, MeError);
      const row = await deps.store.findProfile(actor.userId);
      if (!row) throw new MeError("NOT_FOUND", "Usuario no encontrado");
      return toResponse(row);
    },
  };
}

export type MeService = ReturnType<typeof createMeService>;
