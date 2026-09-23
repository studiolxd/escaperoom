import { WaitlistError, type WaitlistErrorCode, type WaitlistService } from "@escaperoom/shared/services";

/** Dependencias inyectables del handler (testeable sin base de datos). */
export type WaitlistHandlerDeps = { waitlist: WaitlistService };

const STATUS_BY_CODE: Record<WaitlistErrorCode, number> = {
  VALIDATION_ERROR: 400,
};

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Handler REST de la waitlist de la landing (ticket 6.7, specs/20 §1, §5).
 * Público: sin `resolveActor`, cualquier visitante puede apuntarse.
 */
export function createWaitlistHandler(deps: WaitlistHandlerDeps) {
  return {
    /** `POST /api/waitlist` — `{ email, locale?, source? }`. 201 alta, 200 ya estaba. */
    async postJoin(request: Request): Promise<Response> {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("VALIDATION_ERROR", "El cuerpo no es JSON válido", 400);
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return errorResponse("VALIDATION_ERROR", "Se esperaba un objeto { email, locale?, source? }", 400);
      }
      const { email, locale, source } = body as {
        email?: unknown;
        locale?: unknown;
        source?: unknown;
      };
      try {
        const result = await deps.waitlist.join({ email, locale, source });
        return Response.json(
          { ok: true, created: result.created },
          { status: result.created ? 201 : 200 },
        );
      } catch (error) {
        if (error instanceof WaitlistError) {
          return errorResponse(error.code, error.message, STATUS_BY_CODE[error.code]);
        }
        throw error;
      }
    },
  };
}
