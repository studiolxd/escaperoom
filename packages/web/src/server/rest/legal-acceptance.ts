import { isAnonymous, type Actor, type TermsAcceptanceService } from "@escaperoom/shared/services";

/** Dependencias inyectables de los handlers de reaceptación de términos (testeables sin Postgres). */
export type LegalAcceptanceHandlerDeps = {
  termsAcceptance: TermsAcceptanceService;
  resolveActor: (request: Request) => Promise<Actor>;
};

const NO_STORE = { "Cache-Control": "no-store" };

function unauthorized(): Response {
  return Response.json(
    { error: { code: "UNAUTHORIZED", message: "No hay sesión" } },
    { status: 401, headers: NO_STORE },
  );
}

function requestMeta(headers: Headers): { ipAddress: string | null; userAgent: string | null } {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded || headers.get("x-real-ip") || null,
    userAgent: headers.get("user-agent") || null,
  };
}

/**
 * Handlers REST de la reaceptación de Términos/Privacidad
 * (`/api/legal/terms-acceptance`). Ambos exigen sesión: sin ella no hay nada
 * que aceptar ni que comparar.
 */
export function createLegalAcceptanceHandlers(deps: LegalAcceptanceHandlerDeps) {
  return {
    /** `GET /api/legal/terms-acceptance` — estado frente a la versión vigente. */
    async getStatus(request: Request): Promise<Response> {
      const actor = await deps.resolveActor(request);
      if (isAnonymous(actor)) return unauthorized();
      const status = await deps.termsAcceptance.getStatus(actor.userId);
      return Response.json(status, { status: 200, headers: NO_STORE });
    },

    /** `POST /api/legal/terms-acceptance` — registra la aceptación de la versión vigente. */
    async accept(request: Request): Promise<Response> {
      const actor = await deps.resolveActor(request);
      if (isAnonymous(actor)) return unauthorized();
      const row = await deps.termsAcceptance.accept(actor.userId, requestMeta(request.headers));
      return Response.json({ version: row.version }, { status: 200, headers: NO_STORE });
    },
  };
}
