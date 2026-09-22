/**
 * Actor explícito de toda llamada a los servicios de dominio (ADR-022). La
 * misma capa la invocan tRPC (UI), REST, MCP y Colyseus; el `actor` es la única
 * diferencia entre puertas.
 */
export type ActorRole = "owner" | "admin" | "member" | "anonymous";

export type Actor = {
  userId: string;
  organizationId: string | null;
  role: ActorRole;
};

/** Actor sin sesión: invitado/anónimo (specs/13, ticket 0.10). */
export const ANONYMOUS_ACTOR: Actor = {
  userId: "anonymous",
  organizationId: null,
  role: "anonymous",
};

/**
 * Forma mínima de una sesión de Better Auth que necesita la derivación del
 * actor. Es estructural a propósito: el servicio no depende del tipo de la app
 * de auth, de modo que se puede testear sin infraestructura.
 */
export type SessionLike = {
  user: { id: string };
  session: { activeOrganizationId?: string | null };
};

/**
 * Deriva el `actor` de una sesión de Better Auth. Sin sesión devuelve el actor
 * anónimo; con sesión, el rol por defecto es `member` (el rol fino por
 * organización se resolverá cuando el servicio lo necesite).
 */
export function actorFromSession(session: SessionLike | null | undefined): Actor {
  if (!session) return ANONYMOUS_ACTOR;
  return {
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? null,
    role: "member",
  };
}

/** `true` si el actor no tiene sesión. */
export function isAnonymous(actor: Actor): boolean {
  return actor.role === "anonymous";
}
