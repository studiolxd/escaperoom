/**
 * Reaceptación de Términos/Privacidad al cambiar de versión. Un usuario con
 * sesión cuya `termsAcceptedVersion` no coincide con la versión vigente (o
 * que nunca aceptó) queda bloqueado hasta que reacepta; el histórico
 * inmutable de cada aceptación vive en `termsAcceptance`.
 */

// ── Versión vigente ─────────────────────────────────────────────────────────

/**
 * Versión vigente de Términos de Servicio y Política de Privacidad.
 *
 * ⚠️ SUBIR A MANO cada vez que cambie el contenido de
 * `packages/web/src/content/legal/terms.ts` o `privacy.ts` (usa su
 * `draftDate` como valor): todas las cuentas con sesión iniciada quedarán
 * bloqueadas hasta reaceptar en su siguiente visita. Convención: fecha
 * `"AAAA-MM-DD"`.
 *
 * 2026-09-23: versión inicial, coincide con el `draftDate` de `terms.ts`/
 * `privacy.ts` en el momento de introducir este mecanismo — ningún usuario
 * existente queda bloqueado de partida.
 *
 * 2026-09-26: Política de Privacidad — Magnific puede tratar datos fuera del
 * EEE a través de sus subencargados (proveedores de IA y nube), con CCT.
 *
 * 2026-09-26-2: Términos de Servicio — se retira la moderación previa de
 * audio (ADR-039): responsabilidad explícita del creador (todo el contenido
 * de su sala) y del organizador (revisar antes de usar una sala con su
 * grupo). Sufijo `-2` porque cambia el mismo día que la entrada anterior (el
 * formato base sigue siendo `"AAAA-MM-DD"`; un segundo cambio el mismo día
 * añade `-N` para que la versión sea distinta y dispare la reaceptación).
 */
export const CURRENT_TERMS_VERSION = "2026-09-26-2";

// ── Tipos de dominio ────────────────────────────────────────────────────────

/** Fila de `termsAcceptance` (registro inmutable de una aceptación). */
export type TermsAcceptanceRow = {
  id: string;
  userId: string;
  version: string;
  ipAddress: string | null;
  userAgent: string | null;
  acceptedAt: Date;
};

export type TermsAcceptanceStatus = {
  /** `true` si el usuario debe reaceptar (versión desactualizada o nunca aceptó). */
  needsAcceptance: boolean;
  /** Versión vigente contra la que se compara. */
  version: string;
};

/** Puerto de persistencia (ADR-022). */
export interface TermsAcceptanceStore {
  /** `termsAcceptedVersion` desnormalizado del usuario; `null` si nunca aceptó. */
  findAcceptedVersion(userId: string): Promise<string | null>;
  /**
   * Crea la fila de histórico + actualiza `user.termsAcceptedVersion`, en
   * una transacción.
   */
  recordAcceptance(input: {
    userId: string;
    version: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<TermsAcceptanceRow>;
}

// ── Servicio ────────────────────────────────────────────────────────────────

export function createTermsAcceptanceService(deps: { store: TermsAcceptanceStore }) {
  const { store } = deps;

  return {
    /** Estado de reaceptación de un usuario con sesión frente a la versión vigente. */
    async getStatus(userId: string): Promise<TermsAcceptanceStatus> {
      const accepted = await store.findAcceptedVersion(userId);
      return { needsAcceptance: accepted !== CURRENT_TERMS_VERSION, version: CURRENT_TERMS_VERSION };
    },

    /** Registra la aceptación de la versión vigente por el usuario. */
    async accept(
      userId: string,
      meta: { ipAddress: string | null; userAgent: string | null },
    ): Promise<TermsAcceptanceRow> {
      return store.recordAcceptance({
        userId,
        version: CURRENT_TERMS_VERSION,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    },
  };
}

export type TermsAcceptanceService = ReturnType<typeof createTermsAcceptanceService>;

// ── Implementación en memoria (tests y superficies sin base de datos) ──────

export function createInMemoryTermsAcceptanceStore(opts?: {
  /** `termsAcceptedVersion` inicial por `userId`. */
  acceptedVersions?: Record<string, string | null>;
}): TermsAcceptanceStore & { rows: TermsAcceptanceRow[] } {
  const acceptedVersions = new Map(Object.entries(opts?.acceptedVersions ?? {}));
  const rows: TermsAcceptanceRow[] = [];
  let clock = Date.UTC(2026, 0, 1);

  return {
    rows,
    async findAcceptedVersion(userId) {
      return acceptedVersions.get(userId) ?? null;
    },
    async recordAcceptance({ userId, version, ipAddress, userAgent }) {
      const row: TermsAcceptanceRow = {
        id: `terms-acceptance-${rows.length + 1}`,
        userId,
        version,
        ipAddress,
        userAgent,
        acceptedAt: new Date((clock += 1000)),
      };
      rows.push(row);
      acceptedVersions.set(userId, version);
      return { ...row };
    },
  };
}
