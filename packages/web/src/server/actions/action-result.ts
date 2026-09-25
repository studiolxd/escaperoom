import { headers } from "next/headers";
import type { ReadableIssue } from "@escaperoom/shared/schemas";
import { resolveActorFromHeaders } from "@/server/context";
import { consumeRateLimit, userIdOf, type RateLimitPolicyName } from "@/server/rate-limit";

/**
 * Contrato de error de una Server Action (equivalente de A-22 —
 * `server/rest/_http.ts` — para acciones, que no pueden devolver un
 * `Response`): mismo `{ code, message }` que las rutas REST, con `issues`
 * opcional para pintar los errores de Zod bajo cada campo.
 */
export type ActionError = {
  code: string;
  message: string;
  issues?: ReadableIssue[];
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError(code: string, message: string, issues?: ReadableIssue[]): ActionResult<never> {
  return { ok: false, error: { code, message, ...(issues && issues.length > 0 ? { issues } : {}) } };
}

export const RATE_LIMITED_MESSAGE = "Demasiadas solicitudes, inténtalo de nuevo más tarde";

/**
 * Gasta una cuota de `RATE_LIMIT_POLICIES` (`server/rate-limit.ts`) desde una
 * Server Action. Las Server Actions no reciben un `Request`, así que la IP y
 * la sesión se reconstruyen a partir de `headers()` (`next/headers`) y se le
 * pasan a `consumeRateLimit` con un objeto mínimo que solo necesita exponer
 * `.headers` (lo único que lee `clientIpFromHeaders`); `resolveUserId` se
 * sobreescribe para no depender de más forma de `Request` que esa.
 */
export async function consumeActionRateLimit(policyName: RateLimitPolicyName) {
  const hdrs = await headers();
  const fakeRequest = { headers: hdrs } as Request;
  return consumeRateLimit(policyName, fakeRequest, {
    resolveUserId: async () => userIdOf(await resolveActorFromHeaders(hdrs)),
  });
}

/** Resultado de error listo para devolver cuando `consumeActionRateLimit` deniega. */
export function rateLimitedActionError(): ActionResult<never> {
  return actionError("RATE_LIMITED", RATE_LIMITED_MESSAGE);
}
