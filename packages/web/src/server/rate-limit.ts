import {
  slidingRateLimiter,
  type RateLimitResult,
  type SlidingWindowStore,
} from "@escaperoom/kit/rate-limit";
import { clientIpFromHeaders, tooManyRequestsResponse } from "@escaperoom/kit/rate-limit/http";
import { isAnonymous, type Actor } from "@escaperoom/shared/services";

/**
 * Rate limiting de las rutas REST sensibles (ticket 6.3, specs/13 §11): ventana
 * DESLIZANTE en Redis (`@escaperoom/kit/rate-limit`) por IP + ruta y, cuando
 * hay sesión, también por usuario. Al pasarse, 429 con `Retry-After` y el
 * error `RATE_LIMITED`; el resto del contrato de cada ruta no cambia.
 *
 * La tabla razonada vive en `docs/reference/seguridad.md` §1: si cambias un número
 * aquí, cámbialo allí.
 */

export type RateLimitRule = { limit: number; windowSeconds: number };

export type RateLimitPolicy = {
  /** Cuota por IP (siempre). */
  ip: RateLimitRule;
  /** Cuota por usuario, solo si la petición trae sesión. */
  user?: RateLimitRule;
  /**
   * Cuota por IP que solo gastan las respuestas FALLIDAS (4xx salvo 429). Es
   * la defensa contra la fuerza bruta de códigos: una clase entera detrás del
   * mismo NAT canjea sus claves sin problema, pero quien prueba códigos al
   * azar (404) se queda sin intentos enseguida.
   */
  failures?: RateLimitRule;
};

/** Límites por ruta (el nombre es el prefijo de la clave en Redis). */
export const RATE_LIMIT_POLICIES = {
  /** `POST /api/access-keys/redeem` — público; fuerza bruta de códigos (specs/13 §11). */
  redeem: {
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
    failures: { limit: 10, windowSeconds: 600 },
  },
  /** `POST /api/rooms/:roomId/reviews` y tRPC `reviews.upsert` (mismo cubo). */
  "review-write": {
    ip: { limit: 20, windowSeconds: 600 },
    user: { limit: 5, windowSeconds: 600 },
  },
  /** `POST /api/access-keys/:code/confirm` — público, desde el enlace del email. */
  "invitation-confirm": {
    ip: { limit: 20, windowSeconds: 600 },
    failures: { limit: 10, windowSeconds: 600 },
  },
  /** `POST /api/access-keys/:code/resend` — el organizador reenvía un email. */
  "invitation-resend": {
    ip: { limit: 60, windowSeconds: 600 },
    user: { limit: 30, windowSeconds: 600 },
  },
  /** `POST /api/events/:id/invitations/resend` — recordatorio masivo a los pendientes. */
  "invitation-resend-pending": {
    ip: { limit: 10, windowSeconds: 3600 },
    user: { limit: 5, windowSeconds: 3600 },
  },
  /** `POST /api/rooms/:roomId/report` y `POST /api/reports` (ticket 6.1, mismo cubo). */
  "report-write": {
    ip: { limit: 30, windowSeconds: 600 },
    user: { limit: 10, windowSeconds: 600 },
  },
  /** `POST /api/rooms/:roomId/appeal` y `POST /api/me/appeal` (ticket 6.1). */
  "appeal-write": {
    ip: { limit: 20, windowSeconds: 3600 },
    user: { limit: 5, windowSeconds: 3600 },
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export type RateLimitDeps = {
  store: SlidingWindowStore;
  /** Usuario de la sesión, o `null` si la petición es anónima. */
  resolveUserId: (request: Request) => Promise<string | null>;
  /** `RATE_LIMIT_ENABLED=false` lo apaga (pruebas de carga); por defecto, encendido. */
  enabled: boolean;
  /** Tabla de límites (los tests pasan una propia). */
  policies: Record<string, RateLimitPolicy>;
};

/**
 * Solo se consulta la sesión si la petición trae credenciales (cookie o
 * `Authorization`): el canje anónimo no paga una consulta a la base de datos.
 * El import es perezoso para que este módulo no arrastre Better Auth/Prisma.
 */
async function defaultResolveUserId(request: Request): Promise<string | null> {
  if (!request.headers.get("cookie") && !request.headers.get("authorization")) return null;
  const { resolveActorFromRequest } = await import("./context");
  return userIdOf(await resolveActorFromRequest(request));
}

/** Usuario con cuota propia; el anónimo (sin sesión válida) solo cuenta por IP. */
export function userIdOf(actor: Actor): string | null {
  return isAnonymous(actor) ? null : actor.userId;
}

function defaultDeps(): RateLimitDeps {
  return {
    store: slidingRateLimiter,
    resolveUserId: defaultResolveUserId,
    enabled: process.env.RATE_LIMIT_ENABLED?.trim().toLowerCase() !== "false",
    policies: RATE_LIMIT_POLICIES,
  };
}

const ALLOWED: RateLimitResult = { ok: true, retryAfter: 0 };

function isFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

/**
 * Gasta un intento de `policy` para la petición (IP y, con sesión, usuario) y
 * devuelve el primer rechazo, si lo hay. No mira la cuota de fallos: esa la
 * gestiona `withRateLimit` alrededor del handler.
 */
export async function consumeRateLimit(
  policyName: RateLimitPolicyName,
  request: Request,
  overrides: Partial<RateLimitDeps> = {},
): Promise<RateLimitResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const policy = deps.policies[policyName];
  if (!deps.enabled || !policy) return ALLOWED;

  const ip = clientIpFromHeaders(request.headers);
  const byIp = await deps.store.hit(
    `${policyName}:ip:${ip}`,
    policy.ip.limit,
    policy.ip.windowSeconds,
  );
  if (!byIp.ok) return byIp;

  if (policy.user) {
    const userId = await deps.resolveUserId(request);
    if (userId) {
      const byUser = await deps.store.hit(
        `${policyName}:user:${userId}`,
        policy.user.limit,
        policy.user.windowSeconds,
      );
      if (!byUser.ok) return byUser;
    }
  }
  return byIp;
}

/**
 * Envuelve un route handler con `policy`: 429 + `Retry-After` antes de tocar
 * el dominio si la cuota está agotada; si no, responde el handler tal cual.
 * Con cuota de fallos, un 4xx del handler gasta además un intento de ella.
 */
export function withRateLimit<Rest extends unknown[]>(
  policyName: RateLimitPolicyName,
  handler: (request: Request, ...rest: Rest) => Response | Promise<Response>,
  overrides: Partial<RateLimitDeps> = {},
): (request: Request, ...rest: Rest) => Promise<Response> {
  return async (request, ...rest) => {
    const deps = { ...defaultDeps(), ...overrides };
    const policy = deps.policies[policyName];
    if (!deps.enabled || !policy) return handler(request, ...rest);

    const failureKey = `${policyName}:fail:ip:${clientIpFromHeaders(request.headers)}`;
    if (policy.failures) {
      const exhausted = await deps.store.peek(
        failureKey,
        policy.failures.limit,
        policy.failures.windowSeconds,
      );
      if (!exhausted.ok) return tooManyRequestsResponse(exhausted.retryAfter);
    }

    const consumed = await consumeRateLimit(policyName, request, deps);
    if (!consumed.ok) return tooManyRequestsResponse(consumed.retryAfter);

    const response = await handler(request, ...rest);
    if (policy.failures && isFailure(response.status)) {
      await deps.store.hit(failureKey, policy.failures.limit, policy.failures.windowSeconds);
    }
    return response;
  };
}
