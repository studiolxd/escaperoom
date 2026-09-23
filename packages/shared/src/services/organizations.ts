import { z } from "zod";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { isAnonymous, type Actor } from "./actor";

/**
 * DPA de organizaciones (ticket 5.11, specs/18 §3.1, specs/13 §2).
 *
 * Con claves `individual` por email la plataforma trata los emails de los
 * participantes **por encargo** del organizador: hace falta un contrato de
 * encargo de tratamiento (DPA) firmado antes de usar esa función.
 *
 * - **Firma** (`POST /api/organizations/:id/dpa/sign`): solo `owner`/`admin` de
 *   la organización. Se registra qué versión del texto se aceptó, quién y cuándo.
 *   El cliente envía la versión que ha mostrado: si no es la vigente (el texto
 *   cambió mientras se leía) se rechaza en vez de firmar algo no leído.
 * - **Versión**: una firma de una versión anterior a `CURRENT_DPA_VERSION` no
 *   habilita nada: al cambiar el texto se exige re-firma (conservador; el
 *   organizador acepta las condiciones nuevas antes de seguir enviando PII).
 * - **Puerta** (`requireDpa`): la usan claves (5.5) e invitaciones (5.6) para
 *   bloquear con `DPA_REQUIRED` la generación de claves con email y el envío de
 *   invitaciones mientras la organización activa del actor no tenga el DPA
 *   vigente. Las claves sin email (`group`/`batch`, o `individual` para
 *   imprimir) no pasan por aquí.
 */

/** Versión vigente del texto del DPA. Cambiarla exige re-firma a todas las organizaciones. */
export const CURRENT_DPA_VERSION = "2026-09-01";

/** Roles de `member.role` que pueden firmar el DPA en nombre de la organización. */
const DPA_SIGNER_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

/** Estado del DPA de una organización (columnas de `organization`). */
export type OrganizationDpaRow = {
  id: string;
  dpaSignedAt: Date | null;
  dpaVersion: string | null;
  dpaSignedBy: string | null;
};

/** Puerto de persistencia del DPA (ADR-022). */
export interface OrganizationStore {
  findOrganization(id: string): Promise<OrganizationDpaRow | null>;
  /** `member.role` del usuario en la organización; `null` si no es miembro. */
  findMemberRole(organizationId: string, userId: string): Promise<string | null>;
  recordDpaSignature(
    organizationId: string,
    signature: { version: string; signedBy: string; signedAt: Date },
  ): Promise<OrganizationDpaRow>;
}

export type OrganizationErrorCode =
  "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "DPA_VERSION_MISMATCH";

/** Error de dominio de organizaciones; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class OrganizationError extends Error {
  readonly code: OrganizationErrorCode;
  readonly issues: ReadableIssue[];
  constructor(code: OrganizationErrorCode, message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "OrganizationError";
    this.code = code;
    this.issues = issues;
  }
}

/** Cuerpo de `POST /api/organizations/:id/dpa/sign`: la versión del texto mostrado. */
export const SignDpaInput = z.object({ version: z.string().min(1).max(64) }).strict();

export type DpaStatus = {
  organizationId: string;
  currentVersion: string;
  /** `true` si hay firma de la versión vigente. */
  signed: boolean;
  signedAt: Date | null;
  version: string | null;
  signedBy: string | null;
};

/** ¿La firma registrada es de la versión vigente? */
export function hasCurrentDpa(
  org: Pick<OrganizationDpaRow, "dpaSignedAt" | "dpaVersion">,
  currentVersion: string = CURRENT_DPA_VERSION,
): boolean {
  return org.dpaSignedAt !== null && org.dpaVersion === currentVersion;
}

/** `member.role` admite varios roles separados por comas (Better Auth). */
function hasSignerRole(role: string): boolean {
  return role.split(",").some((r) => DPA_SIGNER_ROLES.has(r.trim()));
}

/**
 * Puerta que exigen claves (5.5) e invitaciones (5.6) antes de tratar emails de
 * participantes: resuelve si el actor puede o lanza su error `DPA_REQUIRED`.
 */
export type DpaGate = {
  requireDpa(actor: Actor): Promise<void>;
};

/** Error que lanza la puerta: lo construye quien la usa (p. ej. `AccessKeyError`). */
export type DpaRequiredErrorFactory = (message: string) => Error;

function toStatus(org: OrganizationDpaRow, currentVersion: string): DpaStatus {
  return {
    organizationId: org.id,
    currentVersion,
    signed: hasCurrentDpa(org, currentVersion),
    signedAt: org.dpaSignedAt,
    version: org.dpaVersion,
    signedBy: org.dpaSignedBy,
  };
}

export function createOrganizationService(deps: {
  store: OrganizationStore;
  now?: () => Date;
  /** Versión vigente del DPA (tests); por defecto `CURRENT_DPA_VERSION`. */
  currentDpaVersion?: string;
}) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const currentVersion = deps.currentDpaVersion ?? CURRENT_DPA_VERSION;

  /** Organización de la que el actor es miembro, con su rol. */
  async function findMembership(
    actor: Actor,
    organizationId: string,
  ): Promise<{ org: OrganizationDpaRow; role: string }> {
    if (isAnonymous(actor)) throw new OrganizationError("UNAUTHORIZED", "No hay sesión");
    const org = await store.findOrganization(organizationId);
    const role = org ? await store.findMemberRole(org.id, actor.userId) : null;
    // Sin distinguir "no existe" de "no eres miembro": no se revela qué organizaciones hay.
    if (!org || role === null) {
      throw new OrganizationError("NOT_FOUND", "Organización no encontrada");
    }
    return { org, role };
  }

  return {
    currentDpaVersion: currentVersion,

    /** Estado del DPA para cualquier miembro de la organización. */
    async dpaStatus(actor: Actor, organizationId: string): Promise<DpaStatus> {
      const { org } = await findMembership(actor, organizationId);
      return toStatus(org, currentVersion);
    },

    /**
     * `POST /api/organizations/:id/dpa/sign` — owner/admin acepta la versión
     * vigente. Idempotente: firmar otra vez la misma versión conserva la firma
     * original (fecha y firmante); firmar una versión nueva la sustituye.
     */
    async signDpa(
      actor: Actor,
      organizationId: string,
      input: unknown,
    ): Promise<DpaStatus & { alreadySigned: boolean }> {
      const { org, role } = await findMembership(actor, organizationId);
      if (!hasSignerRole(role)) {
        throw new OrganizationError(
          "FORBIDDEN",
          "Solo el propietario o un administrador de la organización puede firmar el DPA",
        );
      }
      const parsed = SignDpaInput.safeParse(input);
      if (!parsed.success) {
        throw new OrganizationError(
          "VALIDATION_ERROR",
          "Datos no válidos",
          toReadableIssues(parsed.error),
        );
      }
      if (parsed.data.version !== currentVersion) {
        throw new OrganizationError(
          "DPA_VERSION_MISMATCH",
          `La versión vigente del DPA es ${currentVersion}; revisa el texto actualizado antes de firmar`,
        );
      }
      if (hasCurrentDpa(org, currentVersion)) {
        return { ...toStatus(org, currentVersion), alreadySigned: true };
      }
      const signed = await store.recordDpaSignature(org.id, {
        version: currentVersion,
        signedBy: actor.userId,
        signedAt: now(),
      });
      return { ...toStatus(signed, currentVersion), alreadySigned: false };
    },

    /**
     * Puerta de claves/invitaciones con email: la organización activa del actor
     * debe existir, contarle como miembro y tener firmada la versión vigente.
     * Sin organización activa tampoco se puede: el DPA lo firma una organización.
     */
    dpaGate(dpaRequired: DpaRequiredErrorFactory): DpaGate {
      return {
        async requireDpa(actor: Actor): Promise<void> {
          const orgId = actor.organizationId;
          const org = orgId ? await store.findOrganization(orgId) : null;
          const member = org ? await store.findMemberRole(org.id, actor.userId) : null;
          if (!org || member === null) {
            throw dpaRequired(
              "Las claves con email necesitan una organización activa con el DPA firmado",
            );
          }
          if (!hasCurrentDpa(org, currentVersion)) {
            throw dpaRequired(
              org.dpaSignedAt === null
                ? "La organización debe firmar el DPA antes de usar claves con email"
                : `El DPA cambió (versión ${currentVersion}): la organización debe volver a firmarlo`,
            );
          }
        },
      };
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;

// ── Implementación en memoria (tests y superficies sin base de datos) ──────

export function createInMemoryOrganizationStore(
  seed: {
    organizations?: Array<Partial<OrganizationDpaRow> & { id: string }>;
    members?: Array<{ organizationId: string; userId: string; role: string }>;
  } = {},
): OrganizationStore & {
  organizations: OrganizationDpaRow[];
  members: Array<{ organizationId: string; userId: string; role: string }>;
} {
  const organizations: OrganizationDpaRow[] = (seed.organizations ?? []).map((o) => ({
    dpaSignedAt: null,
    dpaVersion: null,
    dpaSignedBy: null,
    ...o,
  }));
  const members = [...(seed.members ?? [])];
  return {
    organizations,
    members,
    async findOrganization(id) {
      const o = organizations.find((x) => x.id === id);
      return o ? { ...o } : null;
    },
    async findMemberRole(organizationId, userId) {
      return (
        members.find((m) => m.organizationId === organizationId && m.userId === userId)?.role ??
        null
      );
    },
    async recordDpaSignature(organizationId, { version, signedBy, signedAt }) {
      const o = organizations.find((x) => x.id === organizationId);
      if (!o) throw new Error(`Organización inexistente: ${organizationId}`);
      Object.assign(o, { dpaVersion: version, dpaSignedBy: signedBy, dpaSignedAt: signedAt });
      return { ...o };
    },
  };
}
