import { type Actor } from "./actor";
import { requireUser } from "./common";

/**
 * Derechos RGPD/LOPDGDD del usuario sobre sus propios datos (ticket 6.2,
 * specs/18 §3.4): exportación (portabilidad) y cierre de cuenta ("derecho al
 * olvido").
 *
 * > **Aviso:** este documento y este servicio son un borrador técnico, no
 * > asesoría legal. specs/18 marca explícitamente qué queda pendiente de
 * > revisión por un abogado antes del primer evento educativo real o el
 * > primer pago (§5).
 *
 * ## Alcance del export (`GET /api/me/data-export`)
 *
 * Decisión de producto (no cerrada de forma explícita en specs/18, documentada
 * aquí): el export cubre los datos que identifican **a este usuario**, no los
 * datos de terceros que el usuario haya introducido sobre otras personas (p.
 * ej. los emails de los participantes de un evento que organiza — esos son
 * datos personales de esas otras personas, tratados por la plataforma *por
 * encargo* del organizador, specs/18 §3.1; su exportación es responsabilidad
 * del organizador frente a sus participantes, no un derecho de portabilidad
 * de la cuenta del organizador). El export incluye:
 *
 * - Perfil de cuenta (email, nombre, idioma, fecha de alta).
 * - Membresías de organización (rol, organización).
 * - Saldo de créditos personal.
 * - Salas que ha creado (metadatos; el paquete completo de la sala ya lo tiene
 *   el creador en su editor/exports).
 * - Compras (jugador) y eventos organizados (organizador).
 * - Reseñas que ha escrito.
 * - Su propio historial de moderación: strikes recibidos, apelaciones y
 *   reportes que ha presentado (no el contenido de reportes de terceros sobre
 *   él más allá de lo que ya ve en `/api/me/moderation`).
 *
 * ## Alcance del borrado (`DELETE /api/me`)
 *
 * Decisión de producto (documentada aquí y en specs/18 §3.3, que deja el
 * plazo fiscal exacto **pendiente de asesoría**): el borrado es una
 * **anonimización inmediata**, no un borrado físico de fila:
 *
 * - `user`: email y nombre se sustituyen por valores anónimos (aleatorios, no
 *   derivados del original — anonimización real, no seudonimización), `image`
 *   se limpia (y su objeto en storage se borra si era una key propia, no una
 *   URL externa de OAuth), `stripeCustomerId`/`stripeAccountId` se limpian,
 *   `deletedAt` se marca. La fila sobrevive porque otras tablas (compras,
 *   reseñas, salas publicadas, historial de moderación) la referencian y esos
 *   registros **no se borran** — son necesarios para contabilidad/fiscalidad
 *   (`purchase`), para la licencia UGC ya concedida a quien compró una sala
 *   (specs/18 §2.2) o para detectar reincidencia de strikes (specs/18 §3.3,
 *   "`contentReport`: sin borrado automático").
 * - Sesiones (`session`) y credenciales (`account`, OAuth/password) se borran:
 *   cierra la sesión en todos los dispositivos y revoca el acceso.
 * - `verification`: se borran los magic links vigentes emitidos a su email y
 *   los grants OAuth del MCP que lo referencien (`mcp-oauth:*`, ver
 *   `mcp-oauth-store.ts`); además se deja una marca `revoked-grant` por cada
 *   `grantId` encontrado (mismo mecanismo que usa el provider al revocar), por
 *   si algún token de la familia sigue vivo en otro sitio.
 * - `invitation`: se borran las invitaciones pendientes dirigidas a su email
 *   (dejarlas vivas filtraría el email ya "olvidado" a quien las liste).
 * - `member`: se borra su pertenencia a organizaciones, **salvo** que sea el
 *   único `owner` de una organización con más miembros — en ese caso el
 *   borrado se rechaza (`SOLE_ORG_OWNER`) y hay que transferir la propiedad
 *   antes de cerrar la cuenta, para no dejarla huérfana.
 * - `termsAcceptance.ipAddress`/`userAgent`: se hashean de inmediato (mismo
 *   mecanismo que el job periódico de `ip-ua-purge.ts`, E-3) en vez de esperar
 *   los 90 días habituales — la cuenta ya se cierra, no hace falta el plazo.
 * - `accessKey.email`: si el usuario fue participante (su email coincide con
 *   el de alguna clave de acceso), se hashea igual que hace el job de purga de
 *   `access-key-email-purge.ts` (E-3), sin esperar al plazo de retención.
 * - `audioAsset.originalFilename` de los audios que subió: se sustituye por un
 *   marcador; el fichero en storage no se borra (puede seguir en uso en una
 *   sala publicada).
 * - No borra las salas publicadas ni las reseñas: quedan atribuidas a la
 *   cuenta anonimizada (mismo principio que specs/17 aplica a la moderación:
 *   el contenido ya distribuido no desaparece solo porque el autor cierre la
 *   cuenta, salvo que un reporte crítico lo retire).
 * - **Se conserva** (facturación/fiscalidad, specs/18 §3.3): `purchase` con
 *   sus importes, `event`, `review`, `moderationStrike`/`moderationAppeal`/
 *   `contentReport` — nada de esto se toca aquí.
 *
 * `[PENDIENTE ASESORÍA LEGAL: confirmar si 12–24 meses de retención de datos
 * de facturación tras el cierre de cuenta es el plazo correcto para España
 * (specs/18 §3.3 lo deja como "a confirmar"); este servicio no aplica ningún
 * borrado por plazo a `purchase`, solo anonimiza el perfil y lo que se detalla
 * arriba].`
 */

export type UserDataRightsErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "SOLE_ORG_OWNER";

export class UserDataRightsError extends Error {
  readonly code: UserDataRightsErrorCode;
  constructor(code: UserDataRightsErrorCode, message: string) {
    super(message);
    this.name = "UserDataRightsError";
    this.code = code;
  }
}

export type UserProfileRow = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  locale: string;
  isAdmin: boolean;
  isModerator: boolean;
  createdAt: Date;
};

export type UserDataExportBundle = {
  profile: UserProfileRow;
  organizations: { organizationId: string; name: string; slug: string; role: string }[];
  personalCreditsBalance: number;
  roomsAuthored: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
  purchases: {
    id: string;
    purchaseType: string;
    amountCents: number;
    currency: string;
    status: string;
    createdAt: Date;
    roomTitle: string | null;
    eventTitle: string | null;
  }[];
  eventsOrganized: {
    id: string;
    title: string;
    status: string;
    audience: string;
    createdAt: Date;
  }[];
  reviews: {
    roomId: string;
    rating: number;
    text: string | null;
    createdAt: Date;
    updatedAt: Date;
    hidden: boolean;
  }[];
  moderationStrikesReceived: {
    id: string;
    severity: string;
    consequence: string;
    createdAt: Date;
    revokedAt: Date | null;
  }[];
  moderationAppealsFiled: {
    id: string;
    reason: string;
    status: string;
    createdAt: Date;
    reviewedAt: Date | null;
  }[];
  contentReportsFiled: {
    id: string;
    reason: string;
    status: string;
    createdAt: Date;
  }[];
};

/** Puerto de persistencia de los derechos RGPD sobre la cuenta propia. */
export interface UserDataRightsStore {
  findProfile(userId: string): Promise<UserProfileRow | null>;
  loadExportBundle(userId: string): Promise<Omit<UserDataExportBundle, "profile">>;
  /** Anonimiza el perfil y revoca sesiones/credenciales; no borra filas ajenas. */
  anonymizeAccount(userId: string, at: Date): Promise<void>;
}

/** Forma JSON serializable del export (fechas en ISO 8601). */
export type UserDataExportJson = {
  exportedAt: string;
  profile: Omit<UserProfileRow, "createdAt"> & { createdAt: string };
  organizations: UserDataExportBundle["organizations"];
  personalCreditsBalance: number;
  roomsAuthored: Array<Omit<UserDataExportBundle["roomsAuthored"][number], "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  }>;
  purchases: Array<Omit<UserDataExportBundle["purchases"][number], "createdAt"> & { createdAt: string }>;
  eventsOrganized: Array<
    Omit<UserDataExportBundle["eventsOrganized"][number], "createdAt"> & { createdAt: string }
  >;
  reviews: Array<
    Omit<UserDataExportBundle["reviews"][number], "createdAt" | "updatedAt"> & {
      createdAt: string;
      updatedAt: string;
    }
  >;
  moderationStrikesReceived: Array<
    Omit<UserDataExportBundle["moderationStrikesReceived"][number], "createdAt" | "revokedAt"> & {
      createdAt: string;
      revokedAt: string | null;
    }
  >;
  moderationAppealsFiled: Array<
    Omit<UserDataExportBundle["moderationAppealsFiled"][number], "createdAt" | "reviewedAt"> & {
      createdAt: string;
      reviewedAt: string | null;
    }
  >;
  contentReportsFiled: Array<
    Omit<UserDataExportBundle["contentReportsFiled"][number], "createdAt"> & { createdAt: string }
  >;
};

/** Serializa el bundle a JSON descargable (fechas ISO; pura, testeable). */
export function toExportJson(bundle: UserDataExportBundle, exportedAt: Date): UserDataExportJson {
  return {
    exportedAt: exportedAt.toISOString(),
    profile: { ...bundle.profile, createdAt: bundle.profile.createdAt.toISOString() },
    organizations: bundle.organizations,
    personalCreditsBalance: bundle.personalCreditsBalance,
    roomsAuthored: bundle.roomsAuthored.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    purchases: bundle.purchases.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    eventsOrganized: bundle.eventsOrganized.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
    reviews: bundle.reviews.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    moderationStrikesReceived: bundle.moderationStrikesReceived.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
    })),
    moderationAppealsFiled: bundle.moderationAppealsFiled.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
    })),
    contentReportsFiled: bundle.contentReportsFiled.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export function createUserDataRightsService(deps: {
  store: UserDataRightsStore;
  now?: () => Date;
}) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  async function requireProfile(actor: Actor): Promise<UserProfileRow> {
    requireUser(actor, UserDataRightsError);
    const profile = await store.findProfile(actor.userId);
    if (!profile) throw new UserDataRightsError("NOT_FOUND", "Usuario no encontrado");
    return profile;
  }

  return {
    /** `GET /api/me/data-export` — export completo en JSON (specs/18 §3.4). */
    async exportData(actor: Actor): Promise<UserDataExportJson> {
      const profile = await requireProfile(actor);
      const rest = await store.loadExportBundle(profile.id);
      return toExportJson({ profile, ...rest }, now());
    },

    /**
     * `DELETE /api/me` — anonimiza el perfil y revoca sesiones/credenciales
     * (specs/18 §3.4). No borra compras, reseñas ni salas ya publicadas (ver
     * el comentario del módulo).
     */
    async deleteAccount(actor: Actor): Promise<{ deletedAt: Date }> {
      const profile = await requireProfile(actor);
      const deletedAt = now();
      await store.anonymizeAccount(profile.id, deletedAt);
      return { deletedAt };
    },
  };
}

export type UserDataRightsService = ReturnType<typeof createUserDataRightsService>;
