import { z } from "zod";
import type { RoomPackage } from "../schemas";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { isAnonymous, type Actor } from "./actor";
import {
  collectModerationTexts,
  createLocalContentPrecheck,
  type ContentPrecheckProvider,
  type PrecheckFinding,
  type PrecheckFindingKind,
} from "./moderation-precheck";

/**
 * Moderación de contenido (ticket 6.1, specs/17). Post-publicación con
 * reportes + pre-check automático al publicar + muestreo aleatorio, sobre una
 * cola humana con SLA por severidad, strikes con consecuencias escalonadas y
 * apelaciones.
 *
 * - **Reportes** (`contentReport`) sobre salas, reseñas o usuarios. La
 *   severidad la decide el servidor a partir de la categoría (§4.1, §8): quien
 *   reporta no puede elegirla. Un reporte **crítico** actúa en el acto (§5.1):
 *   despublica la sala (`removed`, guardando su estado previo) u oculta la
 *   reseña, y congela al dueño del contenido hasta la revisión humana.
 * - **Cola**: pendientes ordenados por severidad, evento activo en la sala,
 *   volumen de reportes sobre el mismo contenido y antigüedad (§4.2); cada uno
 *   con su vencimiento de SLA.
 * - **Resolución**: `dismissed` revierte lo automático (restaura la sala /
 *   muestra la reseña); `actioned` confirma y aplica la acción (despublicar,
 *   ocultar, avisar) y, si procede, un strike.
 * - **Strikes** (§6): la consecuencia se deriva de los strikes vigentes
 *   (`computeStrikeConsequences`), de modo que revocar uno en una apelación
 *   recalcula todo sin estados sueltos que se desincronicen.
 * - **Apelaciones** (§7): sobre una sala (retirada, aviso o bloqueo del
 *   pre-check) o sobre la cuenta (suspensión/ban). Lo crítico no se apela.
 *
 * La moderación previa de audio (3.11, `audioAsset`) NO se reutiliza como
 * cola: es una puerta sobre un asset antes de estar disponible (aprobar o
 * rechazar, un estado por fila), mientras que esto son incidencias sobre
 * contenido ya publicado (varios reportes por contenido, severidad, SLA,
 * strikes). Se comparte el guard (`isModerator | isAdmin`) y la UI de la cola.
 */

// ── Vocabulario ────────────────────────────────────────────────────────────

export const REPORT_SEVERITIES = ["critical", "high", "normal", "low"] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

/** Categorías de reporte y la severidad que implican (specs/17 §4.1 y §8). */
export const REPORT_CATEGORY_SEVERITY = {
  illegal_content: "critical",
  minor_safety: "critical",
  harassment: "high",
  sexual_content: "high",
  third_party_voice: "high",
  offensive_language: "normal",
  spam: "normal",
  quality: "normal",
  copyright: "normal",
  pii: "normal",
  duplicate: "low",
  taste: "low",
  sampling: "low",
  other: "normal",
} as const satisfies Record<string, ReportSeverity>;
export type ReportCategory = keyof typeof REPORT_CATEGORY_SEVERITY;

/** Categorías que puede elegir una persona (las demás las pone el sistema). */
export const USER_REPORT_CATEGORIES = [
  "illegal_content",
  "minor_safety",
  "harassment",
  "sexual_content",
  "third_party_voice",
  "offensive_language",
  "spam",
  "quality",
  "copyright",
  "pii",
  "duplicate",
  "taste",
  "other",
] as const satisfies readonly ReportCategory[];

export type ReportSource = "user_report" | "precheck" | "sampling";
export type ReportTargetType = "room" | "review" | "user";
export type ReportStatus = "pending" | "reviewed" | "actioned" | "dismissed";
export type ModerationAction = "unpublish" | "hide" | "warn" | "block" | "none";
export type ModeratedRoomStatus = "draft" | "published" | "unlisted" | "archived" | "removed";
export type StrikeSeverity = "critical" | "high" | "normal";
export type StrikeConsequence = "warning" | "suspension" | "ban";
export type AppealStatus = "pending" | "upheld" | "overturned";

/** Días de validez de un strike sin reincidencia (specs/17 §6). */
export const STRIKE_WINDOW_DAYS = 90;
/** Suspensión de publicación del 2º strike (specs/17 §6). */
export const SUSPENSION_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVERITY_RANK: Record<ReportSeverity, number> = { critical: 0, high: 1, normal: 2, low: 3 };

// ── Filas y puertos ────────────────────────────────────────────────────────

export type ContentReportRow = {
  id: string;
  reporterId: string | null;
  targetType: ReportTargetType;
  roomId: string | null;
  roomVersionId: string | null;
  reviewId: string | null;
  /** Dueño del contenido (autor de la sala o de la reseña, o el usuario reportado). */
  targetUserId: string | null;
  reason: string;
  details: string | null;
  severity: ReportSeverity;
  category: ReportCategory;
  source: ReportSource;
  status: ReportStatus;
  flags: string[];
  slaDueAt: Date;
  actionTaken: ModerationAction | null;
  /** La acción vigente la aplicó el sistema y espera la revisión humana. */
  autoActioned: boolean;
  roomStatusBefore: ModeratedRoomStatus | null;
  contentHash: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
};

export type NewContentReport = Omit<
  ContentReportRow,
  "id" | "createdAt" | "reviewedBy" | "reviewedAt" | "resolutionNote"
> &
  Partial<Pick<ContentReportRow, "reviewedBy" | "reviewedAt" | "resolutionNote">>;

export type ReportPatch = Partial<
  Pick<
    ContentReportRow,
    | "status"
    | "actionTaken"
    | "autoActioned"
    | "roomStatusBefore"
    | "reviewedBy"
    | "reviewedAt"
    | "resolutionNote"
  >
>;

export type StrikeRow = {
  id: string;
  userId: string;
  contentReportId: string | null;
  severity: StrikeSeverity;
  consequence: StrikeConsequence;
  reason: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
};

export type AppealRow = {
  id: string;
  creatorId: string;
  roomId: string | null;
  contentReportId: string | null;
  strikeId: string | null;
  reason: string;
  status: AppealStatus;
  reviewedBy: string | null;
  resolutionNote: string | null;
  slaDueAt: Date;
  createdAt: Date;
  reviewedAt: Date | null;
};

export type ModeratedRoom = {
  id: string;
  authorId: string;
  status: ModeratedRoomStatus;
  title: string;
  latestVersionId: string | null;
};
export type ModeratedReview = {
  id: string;
  roomId: string;
  userId: string;
  text: string | null;
  hiddenAt: Date | null;
};

export type ReportFilter = {
  status?: ReportStatus;
  severity?: ReportSeverity;
  roomId?: string;
  reviewId?: string;
  targetUserId?: string;
  limit?: number;
};

/** Operaciones de escritura/lectura dentro de una transacción. */
export interface ModerationTx {
  findRoom(roomId: string): Promise<ModeratedRoom | null>;
  setRoomStatus(roomId: string, status: ModeratedRoomStatus): Promise<void>;
  findReview(reviewId: string): Promise<ModeratedReview | null>;
  setReviewHidden(reviewId: string, hidden: { at: Date; by: string | null } | null): Promise<void>;
  userExists(userId: string): Promise<boolean>;
  insertReport(report: NewContentReport): Promise<ContentReportRow>;
  findReport(id: string): Promise<ContentReportRow | null>;
  listReports(filter: ReportFilter): Promise<ContentReportRow[]>;
  /** Actualiza solo si sigue `pending`; `null` si otro moderador se adelantó. */
  updateReportIfPending(id: string, patch: ReportPatch): Promise<ContentReportRow | null>;
  updateReport(id: string, patch: ReportPatch): Promise<ContentReportRow>;
  insertStrike(strike: Omit<StrikeRow, "id" | "revokedAt" | "revokedBy">): Promise<StrikeRow>;
  listStrikes(userId: string): Promise<StrikeRow[]>;
  updateStrike(
    id: string,
    patch: Partial<Pick<StrikeRow, "consequence" | "revokedAt" | "revokedBy">>,
  ): Promise<void>;
  insertAppeal(
    appeal: Omit<
      AppealRow,
      "id" | "createdAt" | "status" | "reviewedBy" | "reviewedAt" | "resolutionNote"
    >,
  ): Promise<AppealRow>;
  findAppeal(id: string): Promise<AppealRow | null>;
  listAppeals(filter: {
    status?: AppealStatus;
    creatorId?: string;
    limit?: number;
  }): Promise<AppealRow[]>;
  updateAppealIfPending(
    id: string,
    patch: Pick<AppealRow, "status" | "reviewedBy" | "reviewedAt" | "resolutionNote">,
  ): Promise<AppealRow | null>;
}

/** Puerto de persistencia de la moderación (ADR-022). */
export interface ModerationStore extends ModerationTx {
  /** `user.isModerator || user.isAdmin`, consultado en cada llamada. */
  canModerate(userId: string): Promise<boolean>;
  /** Salas (de `roomIds`) con un evento `active` (prioridad de la cola, §4.2). */
  roomsWithActiveEvent(roomIds: readonly string[]): Promise<Set<string>>;
  /** Versiones publicadas desde `since` que aún no tienen un reporte de muestreo. */
  listUnsampledVersions(
    since: Date,
    limit: number,
  ): Promise<Array<{ roomId: string; versionId: string; authorId: string; publishedAt: Date }>>;
  transaction<T>(fn: (tx: ModerationTx) => Promise<T>): Promise<T>;
}

// ── Errores ────────────────────────────────────────────────────────────────

export type ModerationErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "REPORT_REASON_REQUIRED"
  | "ALREADY_REVIEWED"
  | "APPEAL_NOT_ALLOWED"
  | "APPEAL_ALREADY_PENDING"
  | "NOTHING_TO_APPEAL";

/** Error de dominio de la moderación; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class ModerationError extends Error {
  readonly code: ModerationErrorCode;
  readonly issues: ReadableIssue[];
  constructor(code: ModerationErrorCode, message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "ModerationError";
    this.code = code;
    this.issues = issues;
  }
}

// ── Piezas puras ───────────────────────────────────────────────────────────

/** `from` + `days` días laborables (lunes a viernes, UTC). */
export function addBusinessDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    const dow = out.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return out;
}

/**
 * Vencimiento del SLA de primera revisión (specs/17 §4.1): crítica < 1 h
 * (24/7); alta < 24 h laborables (1 día laborable); normal < 5 días laborables;
 * baja < 10 días laborables.
 */
export function slaDueAt(severity: ReportSeverity, from: Date): Date {
  switch (severity) {
    case "critical":
      return new Date(from.getTime() + 60 * 60 * 1000);
    case "high":
      return addBusinessDays(from, 1);
    case "normal":
      return addBusinessDays(from, 5);
    case "low":
      return addBusinessDays(from, 10);
  }
}

type StrikeLike = Pick<StrikeRow, "id" | "severity" | "createdAt" | "revokedAt">;

/**
 * Consecuencia de cada strike NO revocado (specs/17 §6): una crítica es ban
 * sin más; si no, cuenta los strikes no críticos vigentes en los 90 días
 * anteriores (incluido él): 1º aviso, 2º suspensión de 14 días, 3º ban.
 */
export function computeStrikeConsequences(
  strikes: readonly StrikeLike[],
): Map<string, StrikeConsequence> {
  const active = strikes
    .filter((s) => s.revokedAt === null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const out = new Map<string, StrikeConsequence>();
  for (const s of active) {
    if (s.severity === "critical") {
      out.set(s.id, "ban");
      continue;
    }
    const from = s.createdAt.getTime() - STRIKE_WINDOW_DAYS * DAY_MS;
    const count = active.filter(
      (o) =>
        o.severity !== "critical" &&
        o.createdAt.getTime() > from &&
        o.createdAt.getTime() <= s.createdAt.getTime(),
    ).length;
    out.set(s.id, count >= 3 ? "ban" : count === 2 ? "suspension" : "warning");
  }
  return out;
}

export type CreatorStanding = {
  status: "good" | "warned" | "suspended" | "banned";
  /** Fin de la suspensión de publicación vigente (`null` si no hay). */
  suspendedUntil: Date | null;
  /** Strikes no revocados dentro de la ventana de 90 días (o críticos). */
  activeStrikes: number;
  /** Tiene un reporte crítico pendiente sobre su contenido (§5.1: cuenta congelada). */
  frozen: boolean;
};

/** Estado del creador a partir de sus strikes (sin estado guardado aparte). */
export function creatorStanding(
  strikes: readonly StrikeRow[],
  now: Date,
  frozen = false,
): CreatorStanding {
  const active = strikes.filter((s) => s.revokedAt === null);
  const consequences = computeStrikeConsequences(active);
  const inWindow = active.filter(
    (s) =>
      s.severity === "critical" ||
      now.getTime() - s.createdAt.getTime() < STRIKE_WINDOW_DAYS * DAY_MS,
  );
  const banned = active.some((s) => consequences.get(s.id) === "ban");
  const suspensionEnds = active
    .filter((s) => consequences.get(s.id) === "suspension")
    .map((s) => s.createdAt.getTime() + SUSPENSION_DAYS * DAY_MS)
    .filter((end) => end > now.getTime());
  const suspendedUntil = suspensionEnds.length > 0 ? new Date(Math.max(...suspensionEnds)) : null;
  return {
    status: banned
      ? "banned"
      : suspendedUntil
        ? "suspended"
        : inWindow.length > 0
          ? "warned"
          : "good",
    suspendedUntil: banned ? null : suspendedUntil,
    activeStrikes: inWindow.length,
    frozen,
  };
}

// ── Entradas ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID_RE.test(v);

export const ReportInput = z
  .object({
    targetType: z.enum(["room", "review", "user"]),
    targetId: z.string().trim().min(1).max(200),
    category: z.enum(USER_REPORT_CATEGORIES).default("other"),
    reason: z.string().trim().max(1000).optional(),
    details: z.string().trim().max(5000).optional(),
  })
  .strict();

export const ReportQueueQuery = z.object({
  status: z.enum(["pending", "reviewed", "actioned", "dismissed"]).default("pending"),
  severity: z.enum(REPORT_SEVERITIES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const ResolveReportInput = z
  .object({
    status: z.enum(["actioned", "dismissed"]),
    action: z.enum(["unpublish", "hide", "warn"]).optional(),
    resolutionNote: z.string().trim().max(2000).optional(),
  })
  .strict();

export const AppealInput = z
  .object({
    reason: z.string().trim().min(10).max(5000),
    contentReportId: z.string().regex(UUID_RE).optional(),
  })
  .strict();

export const AppealQueueQuery = z.object({
  status: z.enum(["pending", "upheld", "overturned"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const ResolveAppealInput = z
  .object({
    decision: z.enum(["upheld", "overturned"]),
    resolutionNote: z.string().trim().max(2000).optional(),
  })
  .strict();

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ModerationError(
      "VALIDATION_ERROR",
      "Datos no válidos",
      toReadableIssues(parsed.error),
    );
  }
  return parsed.data;
}

// ── Resultados ─────────────────────────────────────────────────────────────

export type QueueItem = {
  report: ContentReportRow;
  /** El SLA ya venció sin revisión. */
  overdue: boolean;
  /** Reportes pendientes sobre el mismo contenido (incluido este). */
  reportsOnTarget: number;
  /** La sala tiene un evento activo (prioridad §4.2). */
  activeEvent: boolean;
};

export type ResolveReportResult = {
  report: ContentReportRow;
  strike: StrikeRow | null;
  standing: CreatorStanding | null;
};

export type ResolveAppealResult = { appeal: AppealRow; standing: CreatorStanding };

export type PublishPrecheck = {
  action: "allow" | "flag" | "block";
  flags: PrecheckFindingKind[];
  findings: PrecheckFinding[];
  /** Reporte `precheck` creado al bloquear (para apelarlo). */
  reportId: string | null;
  /** El bloqueo se levantó por una apelación estimada sobre este mismo contenido. */
  overridden: boolean;
  durationMs: number;
};

export type SamplingResult = { considered: number; enqueued: number };

// ── Servicio ───────────────────────────────────────────────────────────────

export function createModerationService(deps: {
  store: ModerationStore;
  precheck?: ContentPrecheckProvider;
  now?: () => Date;
  random?: () => number;
}) {
  const { store } = deps;
  const precheck = deps.precheck ?? createLocalContentPrecheck();
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  function requireSession(actor: Actor): void {
    if (isAnonymous(actor)) throw new ModerationError("UNAUTHORIZED", "No hay sesión");
  }

  async function requireModerator(actor: Actor): Promise<void> {
    requireSession(actor);
    if (!(await store.canModerate(actor.userId))) {
      throw new ModerationError("FORBIDDEN", "Solo moderadores o administradores");
    }
  }

  /**
   * A-3/ADR-013 (revisado 2026-09-25): la congelación de la cuenta ya no la
   * dispara automáticamente un reporte crítico pendiente sin revisar —
   * cualquiera podía congelar la cuenta de otro creador con la palabra de un
   * reportante, sin verificación. `frozen` queda en `false` hasta que exista
   * un mecanismo de congelación manual por un moderador.
   */
  async function standingOf(tx: ModerationTx, userId: string): Promise<CreatorStanding> {
    const strikes = await tx.listStrikes(userId);
    return creatorStanding(strikes, now(), false);
  }

  /** Recalcula y guarda la consecuencia de cada strike vigente del usuario. */
  async function recomputeStrikes(tx: ModerationTx, userId: string): Promise<void> {
    const strikes = await tx.listStrikes(userId);
    const consequences = computeStrikeConsequences(strikes);
    for (const s of strikes) {
      const next = consequences.get(s.id);
      if (next && next !== s.consequence) await tx.updateStrike(s.id, { consequence: next });
    }
  }

  /** Despublica la sala si no lo está ya; devuelve el estado previo (o `null`). */
  async function unpublishRoom(
    tx: ModerationTx,
    roomId: string,
  ): Promise<ModeratedRoomStatus | null> {
    const room = await tx.findRoom(roomId);
    if (!room || room.status === "removed") return null;
    await tx.setRoomStatus(roomId, "removed");
    return room.status;
  }

  /**
   * Deshace la acción AUTOMÁTICA o confirmada de un reporte: restaura la sala
   * a su estado previo (si sigue retirada) o vuelve a mostrar la reseña. Si
   * otro reporte crítico pendiente sigue justificando la retirada, le pasa el
   * testigo (estado previo) en vez de restaurar.
   */
  async function revertAction(tx: ModerationTx, report: ContentReportRow): Promise<void> {
    if (report.actionTaken === "unpublish" && report.roomId && report.roomStatusBefore) {
      const others = (
        await tx.listReports({ roomId: report.roomId, status: "pending", severity: "critical" })
      ).filter((r) => r.id !== report.id);
      const heir = others[0];
      if (heir) {
        await tx.updateReport(heir.id, {
          actionTaken: "unpublish",
          autoActioned: true,
          roomStatusBefore: report.roomStatusBefore,
        });
      } else {
        const room = await tx.findRoom(report.roomId);
        if (room?.status === "removed") await tx.setRoomStatus(room.id, report.roomStatusBefore);
      }
    }
    if (report.actionTaken === "hide" && report.reviewId) {
      await tx.setReviewHidden(report.reviewId, null);
    }
  }

  /** Destino de un reporte de usuario: existe, es visible y quién es su dueño. */
  async function resolveTarget(
    tx: ModerationTx,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<Pick<ContentReportRow, "roomId" | "roomVersionId" | "reviewId" | "targetUserId">> {
    const notFound = () => new ModerationError("NOT_FOUND", "El contenido reportado no existe");
    if (targetType === "room") {
      const room = isUuid(targetId) ? await tx.findRoom(targetId) : null;
      // Una sala ya retirada se puede seguir reportando (reportes simultáneos
      // sobre lo mismo); un borrador nunca fue público.
      if (!room || room.status === "draft") throw notFound();
      return {
        roomId: room.id,
        roomVersionId: room.latestVersionId,
        reviewId: null,
        targetUserId: room.authorId,
      };
    }
    if (targetType === "review") {
      const review = isUuid(targetId) ? await tx.findReview(targetId) : null;
      if (!review || review.hiddenAt) throw notFound();
      return {
        roomId: review.roomId,
        roomVersionId: null,
        reviewId: review.id,
        targetUserId: review.userId,
      };
    }
    if (!(await tx.userExists(targetId))) throw notFound();
    return { roomId: null, roomVersionId: null, reviewId: null, targetUserId: targetId };
  }

  /** Acción por defecto al confirmar (specs/17 §5): la sala se retira si es alta o crítica. */
  function defaultAction(report: ContentReportRow): ModerationAction {
    if (report.targetType === "review") return "hide";
    if (report.targetType === "room") {
      return report.severity === "critical" || report.severity === "high" ? "unpublish" : "warn";
    }
    return "warn";
  }

  /** Strike por un reporte confirmado (specs/17 §6; `null` si no procede). */
  function strikeSeverity(report: ContentReportRow): StrikeSeverity | null {
    if (report.severity === "critical") return "critical";
    // Los strikes son de creadores: contenido de sus salas (no reseñas ni perfiles).
    if (report.targetType !== "room" || report.severity === "low") return null;
    return report.severity;
  }

  return {
    /** Solo el guard (los adaptadores lo usan antes de leer el cuerpo). */
    authorizeModeration(actor: Actor): Promise<void> {
      return requireModerator(actor);
    },

    /** `true` si el actor modera (páginas SSR de la cola). */
    async canModerate(actor: Actor): Promise<boolean> {
      return !isAnonymous(actor) && store.canModerate(actor.userId);
    },

    /**
     * Reporte de un usuario sobre una sala, reseña o usuario. La severidad sale
     * de la categoría; un reporte crítico actúa al instante (§5.1). Reportar
     * dos veces lo mismo mientras sigue pendiente devuelve el mismo reporte.
     */
    async report(
      actor: Actor,
      input: unknown,
    ): Promise<{ report: ContentReportRow; created: boolean }> {
      requireSession(actor);
      const parsed = parseOrThrow(ReportInput, input);
      if (!parsed.reason) {
        throw new ModerationError("REPORT_REASON_REQUIRED", "Indica el motivo del reporte", [
          { path: "reason", message: "Obligatorio" },
        ]);
      }
      const reason = parsed.reason;
      const at = now();
      return store.transaction(async (tx) => {
        const target = await resolveTarget(tx, parsed.targetType, parsed.targetId);
        const mine = await tx.listReports({
          status: "pending",
          ...(target.reviewId
            ? { reviewId: target.reviewId }
            : target.roomId
              ? { roomId: target.roomId }
              : { targetUserId: target.targetUserId ?? undefined }),
        });
        const duplicate = mine.find(
          (r) => r.reporterId === actor.userId && r.targetType === parsed.targetType,
        );
        if (duplicate) return { report: duplicate, created: false };

        const severity: ReportSeverity = REPORT_CATEGORY_SEVERITY[parsed.category];

        // A-3/ADR-013 (revisado 2026-09-25): un reporte de usuario, sea cual sea
        // su severidad, YA NO despublica la sala ni oculta la reseña al
        // insertarse — la severidad la fija la categoría que elige el propio
        // reportante, sin verificación previa, así que actuar al instante era
        // abusable por cualquier cuenta gratuita (despublicar salas ajenas o
        // congelar cuentas con una sola llamada). Entra en la cola con la
        // prioridad de su severidad (§4.2 de specs/17) y la acción la decide un
        // moderador humano en `resolveReport`.
        const report = await tx.insertReport({
          reporterId: actor.userId,
          targetType: parsed.targetType,
          ...target,
          reason,
          details: parsed.details ?? null,
          severity,
          category: parsed.category,
          source: "user_report",
          status: "pending",
          flags: [],
          slaDueAt: slaDueAt(severity, at),
          actionTaken: null,
          autoActioned: false,
          roomStatusBefore: null,
          contentHash: null,
        });
        return { report, created: true };
      });
    },

    /**
     * Cola de revisión (§4). Pendientes por defecto, ordenados por severidad →
     * evento activo en la sala → nº de reportes sobre el mismo contenido →
     * antigüedad.
     */
    async listQueue(actor: Actor, query: unknown = {}): Promise<QueueItem[]> {
      await requireModerator(actor);
      const q = parseOrThrow(ReportQueueQuery, query);
      const rows = await store.listReports({
        status: q.status,
        ...(q.severity ? { severity: q.severity } : {}),
        limit: q.limit,
      });
      const pending =
        q.status === "pending" ? rows : await store.listReports({ status: "pending" });
      const targetKey = (r: ContentReportRow) =>
        `${r.targetType}:${r.reviewId ?? r.roomId ?? r.targetUserId}`;
      const counts = new Map<string, number>();
      for (const r of pending) counts.set(targetKey(r), (counts.get(targetKey(r)) ?? 0) + 1);
      const roomIds = [...new Set(rows.flatMap((r) => (r.roomId ? [r.roomId] : [])))];
      const active =
        roomIds.length > 0 ? await store.roomsWithActiveEvent(roomIds) : new Set<string>();
      const at = now().getTime();
      const items: QueueItem[] = rows.map((report) => ({
        report,
        overdue: report.status === "pending" && report.slaDueAt.getTime() < at,
        reportsOnTarget: counts.get(targetKey(report)) ?? 0,
        activeEvent: report.roomId !== null && active.has(report.roomId),
      }));
      return items.sort(
        (a, b) =>
          SEVERITY_RANK[a.report.severity] - SEVERITY_RANK[b.report.severity] ||
          Number(b.activeEvent) - Number(a.activeEvent) ||
          b.reportsOnTarget - a.reportsOnTarget ||
          a.report.createdAt.getTime() - b.report.createdAt.getTime(),
      );
    },

    /**
     * Resolución humana de un reporte pendiente. `dismissed`: no hay
     * infracción; se revierte lo automático (restaura la sala o la reseña).
     * `actioned`: se confirma, se aplica la acción (por defecto la de §5) y, si
     * procede, un strike al dueño del contenido.
     */
    async resolveReport(actor: Actor, id: string, input: unknown): Promise<ResolveReportResult> {
      await requireModerator(actor);
      const parsed = parseOrThrow(ResolveReportInput, input);
      const at = now();
      return store.transaction(async (tx) => {
        const report = isUuid(id) ? await tx.findReport(id) : null;
        if (!report) throw new ModerationError("NOT_FOUND", "Reporte no encontrado");
        if (report.status !== "pending") {
          throw new ModerationError("ALREADY_REVIEWED", "Este reporte ya se revisó");
        }
        const reviewed = {
          reviewedBy: actor.userId,
          reviewedAt: at,
          resolutionNote: parsed.resolutionNote ?? null,
        };

        if (parsed.status === "dismissed") {
          await revertAction(tx, report);
          const updated = await tx.updateReportIfPending(id, {
            ...reviewed,
            status: "dismissed",
            actionTaken: "none",
            autoActioned: false,
          });
          if (!updated) throw new ModerationError("ALREADY_REVIEWED", "Este reporte ya se revisó");
          const standing = report.targetUserId ? await standingOf(tx, report.targetUserId) : null;
          return { report: updated, strike: null, standing };
        }

        const action = parsed.action ?? defaultAction(report);
        const fits =
          action === "warn" ||
          (action === "unpublish" && report.roomId !== null && report.targetType === "room") ||
          (action === "hide" && report.reviewId !== null);
        if (!fits) {
          throw new ModerationError(
            "VALIDATION_ERROR",
            `La acción "${action}" no aplica a este contenido`,
            [{ path: "action", message: "No aplica al destino del reporte" }],
          );
        }
        let roomStatusBefore = report.roomStatusBefore;
        if (action === "unpublish" && report.roomId) {
          roomStatusBefore = (await unpublishRoom(tx, report.roomId)) ?? roomStatusBefore;
        } else if (report.actionTaken === "unpublish") {
          // Se confirma con una acción más leve: la sala vuelve a su estado.
          await revertAction(tx, report);
        }
        if (action === "hide" && report.reviewId) {
          await tx.setReviewHidden(report.reviewId, { at, by: actor.userId });
        }
        const updated = await tx.updateReportIfPending(id, {
          ...reviewed,
          status: "actioned",
          actionTaken: action,
          autoActioned: false,
          roomStatusBefore: action === "unpublish" ? roomStatusBefore : null,
        });
        if (!updated) throw new ModerationError("ALREADY_REVIEWED", "Este reporte ya se revisó");

        let strike: StrikeRow | null = null;
        const severity = strikeSeverity(report);
        if (severity && report.targetUserId) {
          strike = await tx.insertStrike({
            userId: report.targetUserId,
            contentReportId: report.id,
            severity,
            consequence: "warning",
            reason: parsed.resolutionNote ?? report.reason,
            createdAt: at,
          });
          await recomputeStrikes(tx, report.targetUserId);
          strike =
            (await tx.listStrikes(report.targetUserId)).find((s) => s.id === strike!.id) ?? strike;
        }
        const standing = report.targetUserId ? await standingOf(tx, report.targetUserId) : null;
        return { report: updated, strike, standing };
      });
    },

    /** Estado del creador (strikes vigentes, suspensión, ban, congelación). */
    async standing(actor: Actor, userId?: string): Promise<CreatorStanding> {
      requireSession(actor);
      const target = userId ?? actor.userId;
      if (target !== actor.userId) await requireModerator(actor);
      return standingOf(store, target);
    },

    /**
     * Puerta de publicación del creador: `null` si puede publicar; si no, el
     * motivo (cuenta congelada por un crítico pendiente, suspensión o ban).
     */
    async publishBlocker(
      userId: string,
    ): Promise<{
      code: "ACCOUNT_FROZEN" | "CREATOR_SUSPENDED" | "CREATOR_BANNED";
      message: string;
      until: Date | null;
    } | null> {
      const s = await standingOf(store, userId);
      if (s.status === "banned") {
        return {
          code: "CREATOR_BANNED",
          message: "Tu cuenta no puede publicar salas (ban de moderación)",
          until: null,
        };
      }
      if (s.frozen) {
        return {
          code: "ACCOUNT_FROZEN",
          message: "Tu cuenta está congelada mientras se revisa un reporte crítico",
          until: null,
        };
      }
      if (s.status === "suspended") {
        return {
          code: "CREATOR_SUSPENDED",
          message: `Publicación suspendida hasta ${s.suspendedUntil?.toISOString()}`,
          until: s.suspendedUntil,
        };
      }
      return null;
    },

    /**
     * Pre-check al publicar (§3). `record: false` para la comprobación en seco
     * (`checkPublishable`): no escribe nada. Con `record: true` un bloqueo deja
     * un reporte `precheck` apelable. Un bloqueo cuyo contenido idéntico
     * (`contentHash`) ya se estimó en apelación no vuelve a bloquear.
     */
    async precheckPublish(input: {
      roomId: string;
      authorId: string;
      pkg: RoomPackage;
      contentHash: string;
      record: boolean;
    }): Promise<PublishPrecheck> {
      const started = performance.now();
      const verdict = await precheck.check(collectModerationTexts(input.pkg));
      const base = {
        flags: verdict.flags,
        findings: verdict.findings,
        reportId: null,
        overridden: false,
      };
      const elapsed = () => Math.round(performance.now() - started);
      if (verdict.action !== "block") {
        return { ...base, action: verdict.action, durationMs: elapsed() };
      }
      const previous = await store.listReports({ roomId: input.roomId });
      const overridden = previous.some(
        (r) =>
          r.source === "precheck" &&
          r.actionTaken === "block" &&
          r.status === "dismissed" &&
          r.contentHash === input.contentHash,
      );
      if (overridden) return { ...base, action: "flag", overridden: true, durationMs: elapsed() };
      if (!input.record) return { ...base, action: "block", durationMs: elapsed() };
      const at = now();
      const terms = [
        ...new Set(
          verdict.findings.filter((f) => f.kind === "severe_language").map((f) => f.match),
        ),
      ];
      const report = await store.insertReport({
        reporterId: null,
        targetType: "room",
        roomId: input.roomId,
        roomVersionId: null,
        reviewId: null,
        targetUserId: input.authorId,
        reason: `Pre-check automático: términos bloqueados (${terms.join(", ")})`,
        details: verdict.findings
          .map((f) => `${f.path}: ${f.match}`)
          .join("\n")
          .slice(0, 5000),
        severity: "high",
        category: "offensive_language",
        source: "precheck",
        status: "actioned",
        flags: verdict.flags,
        slaDueAt: slaDueAt("high", at),
        actionTaken: "block",
        autoActioned: true,
        roomStatusBefore: null,
        contentHash: input.contentHash,
        reviewedAt: at,
      });
      return { ...base, action: "block", reportId: report.id, durationMs: elapsed() };
    },

    /** 🟡 Tras publicar con señales del pre-check: el contenido entra en la cola (normal). */
    async recordPrecheckFlags(input: {
      roomId: string;
      versionId: string;
      authorId: string;
      precheck: PublishPrecheck;
    }): Promise<ContentReportRow | null> {
      if (input.precheck.action !== "flag") return null;
      const at = now();
      const pii = input.precheck.flags.some((f) => f.startsWith("pii_"));
      const language = input.precheck.flags.some((f) => f.endsWith("language"));
      return store.insertReport({
        reporterId: null,
        targetType: "room",
        roomId: input.roomId,
        roomVersionId: input.versionId,
        reviewId: null,
        targetUserId: input.authorId,
        reason: input.precheck.overridden
          ? "Publicada tras una apelación estimada de un bloqueo del pre-check"
          : "Señales del pre-check automático al publicar",
        details: input.precheck.findings
          .map((f) => `${f.path}: ${f.match}`)
          .join("\n")
          .slice(0, 5000),
        severity: "normal",
        category: language || !pii ? "offensive_language" : "pii",
        source: "precheck",
        status: "pending",
        flags: input.precheck.flags,
        slaDueAt: slaDueAt("normal", at),
        actionTaken: null,
        autoActioned: false,
        roomStatusBefore: null,
        contentHash: null,
      });
    },

    /**
     * Muestreo aleatorio continuo (§1, §9): de las versiones publicadas en los
     * últimos `windowDays` días sin muestrear, encola cada una con
     * probabilidad `rate` (1 = 100 %, objetivo de la beta) como reporte
     * `sampling` de severidad baja. Sin actor: lo lanza el job del worker.
     */
    async sampleRecentlyPublished(
      opts: { rate?: number; windowDays?: number; limit?: number } = {},
    ): Promise<SamplingResult> {
      const rate = Math.min(1, Math.max(0, opts.rate ?? 1));
      const at = now();
      const since = new Date(at.getTime() - (opts.windowDays ?? 7) * DAY_MS);
      const versions = await store.listUnsampledVersions(since, opts.limit ?? 500);
      let enqueued = 0;
      for (const v of versions) {
        if (rate < 1 && random() >= rate) continue;
        await store.insertReport({
          reporterId: null,
          targetType: "room",
          roomId: v.roomId,
          roomVersionId: v.versionId,
          reviewId: null,
          targetUserId: v.authorId,
          reason: "Muestreo aleatorio de contenido publicado",
          details: null,
          severity: "low",
          category: "sampling",
          source: "sampling",
          status: "pending",
          flags: [],
          slaDueAt: slaDueAt("low", at),
          actionTaken: null,
          autoActioned: false,
          roomStatusBefore: null,
          contentHash: null,
        });
        enqueued += 1;
      }
      return { considered: versions.length, enqueued };
    },

    /**
     * `POST /api/rooms/:roomId/appeal` — el autor apela una retirada, un aviso
     * o un bloqueo del pre-check sobre su sala (el reporte indicado o el
     * último con acción). Lo crítico no se apela (§7).
     */
    async appealRoom(actor: Actor, roomId: string, input: unknown): Promise<AppealRow> {
      requireSession(actor);
      const parsed = parseOrThrow(AppealInput, input);
      return store.transaction(async (tx) => {
        const room = isUuid(roomId) ? await tx.findRoom(roomId) : null;
        if (!room) throw new ModerationError("NOT_FOUND", "Sala no encontrada");
        if (room.authorId !== actor.userId) {
          throw new ModerationError("FORBIDDEN", "Solo el autor puede apelar sobre esta sala");
        }
        const candidates = (await tx.listReports({ roomId: room.id, status: "actioned" }))
          .filter(
            (r) => r.targetType === "room" && r.actionTaken !== "none" && r.actionTaken !== null,
          )
          .sort(
            (a, b) =>
              (b.reviewedAt ?? b.createdAt).getTime() - (a.reviewedAt ?? a.createdAt).getTime(),
          );
        const report = parsed.contentReportId
          ? candidates.find((r) => r.id === parsed.contentReportId)
          : candidates[0];
        if (!report) {
          throw new ModerationError(
            "NOTHING_TO_APPEAL",
            "No hay ninguna acción de moderación que apelar en esta sala",
          );
        }
        if (report.severity === "critical") {
          throw new ModerationError(
            "APPEAL_NOT_ALLOWED",
            "Las retiradas por contenido crítico no admiten apelación",
          );
        }
        const pending = await tx.listAppeals({ status: "pending", creatorId: actor.userId });
        if (pending.some((a) => a.contentReportId === report.id)) {
          throw new ModerationError(
            "APPEAL_ALREADY_PENDING",
            "Ya hay una apelación pendiente sobre esta acción",
          );
        }
        const strike = (await tx.listStrikes(actor.userId)).find(
          (s) => s.contentReportId === report.id && s.revokedAt === null,
        );
        return tx.insertAppeal({
          creatorId: actor.userId,
          roomId: room.id,
          contentReportId: report.id,
          strikeId: strike?.id ?? null,
          reason: parsed.reason,
          slaDueAt: slaDueAt("normal", now()),
        });
      });
    },

    /** `POST /api/me/appeal` — apela la suspensión o el ban de su cuenta (el strike que lo causa). */
    async appealAccount(actor: Actor, input: unknown): Promise<AppealRow> {
      requireSession(actor);
      const parsed = parseOrThrow(AppealInput.omit({ contentReportId: true }), input);
      return store.transaction(async (tx) => {
        const strikes = await tx.listStrikes(actor.userId);
        const consequences = computeStrikeConsequences(strikes);
        const standing = creatorStanding(strikes, now());
        const cause = strikes
          .filter((s) => s.revokedAt === null && consequences.get(s.id) !== "warning")
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        if (!cause || (standing.status !== "suspended" && standing.status !== "banned")) {
          throw new ModerationError(
            "NOTHING_TO_APPEAL",
            "Tu cuenta no tiene ninguna suspensión que apelar",
          );
        }
        if (strikes.some((s) => s.revokedAt === null && s.severity === "critical")) {
          throw new ModerationError(
            "APPEAL_NOT_ALLOWED",
            "Un ban por contenido crítico no admite apelación",
          );
        }
        const pending = await tx.listAppeals({ status: "pending", creatorId: actor.userId });
        if (pending.some((a) => a.strikeId === cause.id)) {
          throw new ModerationError(
            "APPEAL_ALREADY_PENDING",
            "Ya hay una apelación pendiente sobre tu cuenta",
          );
        }
        return tx.insertAppeal({
          creatorId: actor.userId,
          roomId: null,
          contentReportId: cause.contentReportId,
          strikeId: cause.id,
          reason: parsed.reason,
          slaDueAt: slaDueAt("normal", now()),
        });
      });
    },

    /** Cola de apelaciones (pendientes por defecto, las más antiguas primero). */
    async listAppeals(
      actor: Actor,
      query: unknown = {},
    ): Promise<Array<AppealRow & { overdue: boolean }>> {
      await requireModerator(actor);
      const q = parseOrThrow(AppealQueueQuery, query);
      const rows = await store.listAppeals({ status: q.status, limit: q.limit });
      const at = now().getTime();
      return rows
        .map((a) => ({ ...a, overdue: a.status === "pending" && a.slaDueAt.getTime() < at }))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    /**
     * Resolución humana de una apelación. `upheld`: se mantiene todo.
     * `overturned`: el reporte pasa a `dismissed`, se deshace su acción
     * (reincorpora la sala, muestra la reseña, deja pasar el contenido
     * bloqueado por el pre-check) y se revocan sus strikes; las consecuencias
     * del creador se recalculan.
     */
    async resolveAppeal(actor: Actor, id: string, input: unknown): Promise<ResolveAppealResult> {
      await requireModerator(actor);
      const parsed = parseOrThrow(ResolveAppealInput, input);
      const at = now();
      return store.transaction(async (tx) => {
        const appeal = isUuid(id) ? await tx.findAppeal(id) : null;
        if (!appeal) throw new ModerationError("NOT_FOUND", "Apelación no encontrada");
        if (appeal.creatorId === actor.userId) {
          throw new ModerationError("FORBIDDEN", "No puedes resolver tu propia apelación");
        }
        if (appeal.status !== "pending") {
          throw new ModerationError("ALREADY_REVIEWED", "Esta apelación ya se resolvió");
        }
        const note = parsed.resolutionNote ?? null;
        const updated = await tx.updateAppealIfPending(id, {
          status: parsed.decision,
          reviewedBy: actor.userId,
          reviewedAt: at,
          resolutionNote: note,
        });
        if (!updated)
          throw new ModerationError("ALREADY_REVIEWED", "Esta apelación ya se resolvió");

        if (parsed.decision === "overturned") {
          const report = appeal.contentReportId
            ? await tx.findReport(appeal.contentReportId)
            : null;
          if (report && appeal.roomId) {
            await revertAction(tx, report);
            await tx.updateReport(report.id, {
              status: "dismissed",
              autoActioned: false,
              resolutionNote: note ?? "Revertido por apelación",
              reviewedBy: actor.userId,
              reviewedAt: at,
            });
          }
          const strikes = await tx.listStrikes(appeal.creatorId);
          for (const s of strikes) {
            const tied =
              s.id === appeal.strikeId ||
              (appeal.roomId !== null && s.contentReportId === appeal.contentReportId);
            if (tied && s.revokedAt === null) {
              await tx.updateStrike(s.id, { revokedAt: at, revokedBy: actor.userId });
            }
          }
          await recomputeStrikes(tx, appeal.creatorId);
        }
        return { appeal: updated, standing: await standingOf(tx, appeal.creatorId) };
      });
    },
  };
}

export type ModerationService = ReturnType<typeof createModerationService>;

// ── Store en memoria (tests y superficies sin base de datos) ──────────────

type MemoryRoom = Omit<ModeratedRoom, "latestVersionId"> & { latestVersionId?: string | null };

export function createInMemoryModerationStore(
  opts: {
    moderatorIds?: Iterable<string>;
    rooms?: MemoryRoom[];
    reviews?: Array<Omit<ModeratedReview, "hiddenAt"> & { hiddenAt?: Date | null }>;
    userIds?: Iterable<string>;
    versions?: Array<{ roomId: string; versionId: string; authorId: string; publishedAt: Date }>;
    activeEventRoomIds?: Iterable<string>;
    now?: () => Date;
  } = {},
): ModerationStore & {
  rooms: Map<string, ModeratedRoom>;
  reviews: Map<string, ModeratedReview>;
  reports: Map<string, ContentReportRow>;
  strikes: Map<string, StrikeRow>;
  appeals: Map<string, AppealRow>;
  versions: Array<{ roomId: string; versionId: string; authorId: string; publishedAt: Date }>;
  activeEventRoomIds: Set<string>;
} {
  const moderators = new Set(opts.moderatorIds ?? []);
  const now = opts.now ?? (() => new Date());
  const rooms = new Map((opts.rooms ?? []).map((r) => [r.id, { latestVersionId: null, ...r }]));
  const reviews = new Map((opts.reviews ?? []).map((r) => [r.id, { hiddenAt: null, ...r }]));
  const users = new Set(opts.userIds ?? []);
  const versions = [...(opts.versions ?? [])];
  const activeEventRoomIds = new Set(opts.activeEventRoomIds ?? []);
  const reports = new Map<string, ContentReportRow>();
  const strikes = new Map<string, StrikeRow>();
  const appeals = new Map<string, AppealRow>();
  let seq = 0;
  const nextId = () => `00000000-0000-4000-9000-${String((seq += 1)).padStart(12, "0")}`;
  const copy = <T>(v: T): T => structuredClone(v);

  const matches = (r: ContentReportRow, f: ReportFilter) =>
    (f.status === undefined || r.status === f.status) &&
    (f.severity === undefined || r.severity === f.severity) &&
    (f.roomId === undefined || r.roomId === f.roomId) &&
    (f.reviewId === undefined || r.reviewId === f.reviewId) &&
    (f.targetUserId === undefined || r.targetUserId === f.targetUserId);

  const tx: ModerationTx = {
    async findRoom(roomId) {
      const r = rooms.get(roomId);
      return r ? { ...r } : null;
    },
    async setRoomStatus(roomId, status) {
      const r = rooms.get(roomId);
      if (r) r.status = status;
    },
    async findReview(reviewId) {
      const r = reviews.get(reviewId);
      return r ? { ...r } : null;
    },
    async setReviewHidden(reviewId, hidden) {
      const r = reviews.get(reviewId);
      if (r) r.hiddenAt = hidden?.at ?? null;
    },
    async userExists(userId) {
      return (
        users.has(userId) ||
        [...rooms.values()].some((r) => r.authorId === userId) ||
        [...reviews.values()].some((r) => r.userId === userId)
      );
    },
    async insertReport(input) {
      const row: ContentReportRow = {
        reviewedBy: null,
        reviewedAt: null,
        resolutionNote: null,
        ...copy(input),
        id: nextId(),
        createdAt: now(),
      };
      reports.set(row.id, row);
      return copy(row);
    },
    async findReport(id) {
      const r = reports.get(id);
      return r ? copy(r) : null;
    },
    async listReports(filter) {
      return [...reports.values()]
        .filter((r) => matches(r, filter))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, filter.limit ?? Infinity)
        .map(copy);
    },
    async updateReportIfPending(id, patch) {
      const r = reports.get(id);
      if (!r || r.status !== "pending") return null;
      Object.assign(r, patch);
      return copy(r);
    },
    async updateReport(id, patch) {
      const r = reports.get(id);
      if (!r) throw new Error(`No existe el reporte ${id}`);
      Object.assign(r, patch);
      return copy(r);
    },
    async insertStrike(input) {
      const row: StrikeRow = { ...input, id: nextId(), revokedAt: null, revokedBy: null };
      strikes.set(row.id, row);
      return copy(row);
    },
    async listStrikes(userId) {
      return [...strikes.values()]
        .filter((s) => s.userId === userId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(copy);
    },
    async updateStrike(id, patch) {
      const s = strikes.get(id);
      if (s) Object.assign(s, patch);
    },
    async insertAppeal(input) {
      const row: AppealRow = {
        ...input,
        id: nextId(),
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        resolutionNote: null,
        createdAt: now(),
      };
      appeals.set(row.id, row);
      return copy(row);
    },
    async findAppeal(id) {
      const a = appeals.get(id);
      return a ? copy(a) : null;
    },
    async listAppeals(filter) {
      return [...appeals.values()]
        .filter(
          (a) =>
            (filter.status === undefined || a.status === filter.status) &&
            (filter.creatorId === undefined || a.creatorId === filter.creatorId),
        )
        .slice(0, filter.limit ?? Infinity)
        .map(copy);
    },
    async updateAppealIfPending(id, patch) {
      const a = appeals.get(id);
      if (!a || a.status !== "pending") return null;
      Object.assign(a, patch);
      return copy(a);
    },
  };

  return {
    ...tx,
    rooms,
    reviews,
    reports,
    strikes,
    appeals,
    versions,
    activeEventRoomIds,
    async canModerate(userId) {
      return moderators.has(userId);
    },
    async roomsWithActiveEvent(roomIds) {
      return new Set(roomIds.filter((id) => activeEventRoomIds.has(id)));
    },
    async listUnsampledVersions(since, limit) {
      const sampled = new Set(
        [...reports.values()].filter((r) => r.source === "sampling").map((r) => r.roomVersionId),
      );
      return versions
        .filter((v) => v.publishedAt >= since && !sampled.has(v.versionId))
        .slice(0, limit)
        .map((v) => ({ ...v }));
    },
    async transaction(fn) {
      return fn(tx);
    },
  };
}
