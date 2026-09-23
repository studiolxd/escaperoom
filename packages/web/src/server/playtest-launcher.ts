import type { RoomPackage } from "@escaperoom/shared/schemas";

/**
 * Cliente de la ruta interna de Colyseus que crea playtests (ticket 3.8).
 *
 * Web decide **quién** puede crear (el autor del borrador) y serializa el doc
 * Yjs a `RoomPackage` en servidor; Colyseus congela ese paquete, levanta la
 * room temporal y firma el link. El navegador nunca envía ni recibe el paquete.
 */

/** Ruta interna de Colyseus (`PLAYTEST_INTERNAL_PATH` en `@escaperoom/colyseus-server`). */
export const PLAYTEST_INTERNAL_PATH = "/internal/playtests";

/**
 * Secreto de desarrollo, el mismo que `DEV_PLAYTEST_SECRET` de
 * `@escaperoom/colyseus-server` (un test lo comprueba): solo fuera de producción.
 */
export const DEV_PLAYTEST_SECRET = "dev-playtest-secret-no-usar-en-produccion";

export interface CreatePlaytestInput {
  roomPackage: RoomPackage;
  authorId: string;
  draftRoomId: string;
}

export interface CreatedPlaytest {
  playtestId: string;
  token: string;
  /** Epoch ms. */
  expiresAt: number;
  roomId: string;
}

export type PlaytestLaunchErrorCode = "UNPLAYABLE" | "UNAVAILABLE";

export class PlaytestLaunchError extends Error {
  constructor(
    readonly code: PlaytestLaunchErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PlaytestLaunchError";
  }
}

export interface PlaytestLauncher {
  create(input: CreatePlaytestInput): Promise<CreatedPlaytest>;
}

type LauncherEnv = Record<string, string | undefined>;

/** URL HTTP de Colyseus: `COLYSEUS_INTERNAL_URL` o la pública con `ws` → `http`. */
export function resolveColyseusHttpUrl(env: LauncherEnv = process.env): string {
  const internal = env.COLYSEUS_INTERNAL_URL?.trim();
  if (internal) return internal.replace(/\/+$/u, "");
  const publicUrl = env.NEXT_PUBLIC_COLYSEUS_URL?.trim() || "ws://localhost:2567";
  return publicUrl.replace(/^ws(s?):\/\//u, "http$1://").replace(/\/+$/u, "");
}

/** Secreto compartido con Colyseus; `null` (playtest desactivado) en producción sin él. */
export function resolvePlaytestSecret(env: LauncherEnv = process.env): string | null {
  const configured = env.PLAYTEST_SECRET?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "production" ? null : DEV_PLAYTEST_SECRET;
}

export function createHttpPlaytestLauncher(options: {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
}): PlaytestLauncher {
  const doFetch = options.fetch ?? fetch;
  return {
    async create(input) {
      let res: Response;
      try {
        res = await doFetch(`${options.baseUrl}${PLAYTEST_INTERNAL_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.secret}`,
          },
          body: JSON.stringify(input),
          cache: "no-store",
        });
      } catch (err) {
        throw new PlaytestLaunchError(
          "UNAVAILABLE",
          "El servidor de partidas no responde",
          err instanceof Error ? err.message : undefined,
        );
      }
      const json = (await res.json().catch(() => null)) as
        | (CreatedPlaytest & { error?: { code?: string; message?: string; details?: unknown } })
        | null;
      if (res.status === 201 && json) {
        const { playtestId, token, expiresAt, roomId } = json;
        return { playtestId, token, expiresAt, roomId };
      }
      if (res.status === 422) {
        throw new PlaytestLaunchError(
          "UNPLAYABLE",
          json?.error?.message ?? "El borrador no se puede jugar",
          json?.error?.details,
        );
      }
      throw new PlaytestLaunchError(
        "UNAVAILABLE",
        `El servidor de partidas rechazó el playtest (${res.status})`,
        json?.error?.code,
      );
    },
  };
}

/** Lanzador del entorno; `null` si el playtest no está configurado. */
export function getPlaytestLauncher(env: LauncherEnv = process.env): PlaytestLauncher | null {
  const secret = resolvePlaytestSecret(env);
  if (!secret) return null;
  return createHttpPlaytestLauncher({ baseUrl: resolveColyseusHttpUrl(env), secret });
}
