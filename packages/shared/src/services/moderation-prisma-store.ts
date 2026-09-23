import type { Prisma, PrismaClient } from "../../generated/client";
import type {
  AppealRow,
  AppealStatus,
  ContentReportRow,
  ModeratedRoomStatus,
  ModerationAction,
  ModerationStore,
  ModerationTx,
  ReportCategory,
  ReportFilter,
  ReportSeverity,
  ReportSource,
  ReportTargetType,
  StrikeConsequence,
  StrikeRow,
  StrikeSeverity,
} from "./moderation";

type Db = PrismaClient | Prisma.TransactionClient;

type ReportRecord = Prisma.contentReportGetPayload<object>;
type StrikeRecord = Prisma.moderationStrikeGetPayload<object>;
type AppealRecord = Prisma.moderationAppealGetPayload<object>;

// Los CHECK de 0010/0016 acotan los textos a los valores de las uniones.
function toReport(r: ReportRecord): ContentReportRow {
  return {
    id: r.id,
    reporterId: r.reporterId,
    targetType: r.targetType as ReportTargetType,
    roomId: r.roomId,
    roomVersionId: r.roomVersionId,
    reviewId: r.reviewId,
    targetUserId: r.targetUserId,
    reason: r.reason,
    details: r.details,
    severity: r.severity as ReportSeverity,
    category: r.category as ReportCategory,
    source: r.source as ReportSource,
    status: r.status,
    flags: r.flags,
    // Las filas anteriores a 0016 no tenían SLA: vencen en su creación.
    slaDueAt: r.slaDueAt ?? r.createdAt,
    actionTaken: r.actionTaken as ModerationAction | null,
    autoActioned: r.autoActioned,
    roomStatusBefore: r.roomStatusBefore,
    contentHash: r.contentHash,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt,
  };
}

function toStrike(s: StrikeRecord): StrikeRow {
  return {
    ...s,
    severity: s.severity as StrikeSeverity,
    consequence: s.consequence as StrikeConsequence,
  };
}

function toAppeal(a: AppealRecord): AppealRow {
  return {
    id: a.id,
    creatorId: a.creatorId,
    roomId: a.roomId,
    contentReportId: a.contentReportId,
    strikeId: a.strikeId,
    reason: a.reason,
    status: a.status as AppealStatus,
    reviewedBy: a.reviewedBy,
    resolutionNote: a.resolutionNote,
    slaDueAt: a.slaDueAt ?? a.createdAt,
    createdAt: a.createdAt,
    reviewedAt: a.reviewedAt,
  };
}

function reportWhere(f: ReportFilter): Prisma.contentReportWhereInput {
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.roomId ? { roomId: f.roomId } : {}),
    ...(f.reviewId ? { reviewId: f.reviewId } : {}),
    ...(f.targetUserId ? { targetUserId: f.targetUserId } : {}),
  };
}

function txOps(db: Db): ModerationTx {
  return {
    async findRoom(roomId) {
      const room = await db.room.findFirst({
        where: { id: roomId, deletedAt: null },
        select: {
          id: true,
          authorId: true,
          status: true,
          title: true,
          roomVersion_roomVersion_roomIdToroom: {
            select: { id: true },
            orderBy: { publishedAt: "desc" },
            take: 1,
          },
        },
      });
      if (!room) return null;
      return {
        id: room.id,
        authorId: room.authorId,
        status: room.status as ModeratedRoomStatus,
        title: room.title,
        latestVersionId: room.roomVersion_roomVersion_roomIdToroom[0]?.id ?? null,
      };
    },
    async setRoomStatus(roomId, status) {
      await db.room.update({ where: { id: roomId }, data: { status, updatedAt: new Date() } });
    },
    async findReview(reviewId) {
      return db.review.findUnique({
        where: { id: reviewId },
        select: { id: true, roomId: true, userId: true, text: true, hiddenAt: true },
      });
    },
    async setReviewHidden(reviewId, hidden) {
      await db.review.update({
        where: { id: reviewId },
        data: { hiddenAt: hidden?.at ?? null, hiddenBy: hidden?.by ?? null },
      });
    },
    async userExists(userId) {
      const user = await db.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      });
      return user !== null;
    },
    async insertReport(report) {
      const row = await db.contentReport.create({ data: { ...report, flags: report.flags } });
      return toReport(row);
    },
    async findReport(id) {
      const row = await db.contentReport.findUnique({ where: { id } });
      return row ? toReport(row) : null;
    },
    async listReports(filter) {
      const rows = await db.contentReport.findMany({
        where: reportWhere(filter),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        ...(filter.limit ? { take: filter.limit } : {}),
      });
      return rows.map(toReport);
    },
    async updateReportIfPending(id, patch) {
      const { count } = await db.contentReport.updateMany({
        where: { id, status: "pending" },
        data: patch,
      });
      if (count === 0) return null;
      return toReport(await db.contentReport.findUniqueOrThrow({ where: { id } }));
    },
    async updateReport(id, patch) {
      return toReport(await db.contentReport.update({ where: { id }, data: patch }));
    },
    async insertStrike(strike) {
      return toStrike(await db.moderationStrike.create({ data: strike }));
    },
    async listStrikes(userId) {
      const rows = await db.moderationStrike.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toStrike);
    },
    async updateStrike(id, patch) {
      await db.moderationStrike.update({ where: { id }, data: patch });
    },
    async insertAppeal(appeal) {
      return toAppeal(await db.moderationAppeal.create({ data: appeal }));
    },
    async findAppeal(id) {
      const row = await db.moderationAppeal.findUnique({ where: { id } });
      return row ? toAppeal(row) : null;
    },
    async listAppeals(filter) {
      const rows = await db.moderationAppeal.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.creatorId ? { creatorId: filter.creatorId } : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        ...(filter.limit ? { take: filter.limit } : {}),
      });
      return rows.map(toAppeal);
    },
    async updateAppealIfPending(id, patch) {
      const { count } = await db.moderationAppeal.updateMany({
        where: { id, status: "pending" },
        data: patch,
      });
      if (count === 0) return null;
      return toAppeal(await db.moderationAppeal.findUniqueOrThrow({ where: { id } }));
    },
  };
}

/**
 * Implementación Prisma de la moderación (specs/14 §10 + migración 0016). Las
 * operaciones que tocan varias filas (reporte + estado de la sala, strikes +
 * consecuencias) van en una transacción; las actualizaciones de estado son
 * condicionales (`status = 'pending'`) para que dos moderadores no resuelvan
 * lo mismo dos veces.
 */
export function createPrismaModerationStore(prisma: PrismaClient): ModerationStore {
  return {
    ...txOps(prisma),
    async canModerate(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true, isModerator: true },
      });
      return user?.isAdmin === true || user?.isModerator === true;
    },
    async roomsWithActiveEvent(roomIds) {
      const rows = await prisma.event.findMany({
        where: { status: "active", roomVersion: { roomId: { in: [...roomIds] } } },
        select: { roomVersion: { select: { roomId: true } } },
      });
      return new Set(rows.map((r) => r.roomVersion.roomId));
    },
    async listUnsampledVersions(since, limit) {
      return prisma.$queryRaw<
        Array<{ roomId: string; versionId: string; authorId: string; publishedAt: Date }>
      >`
        SELECT v."roomId", v.id AS "versionId", r."authorId", v."publishedAt"
          FROM "roomVersion" v
          JOIN "room" r ON r.id = v."roomId"
         WHERE v."publishedAt" >= ${since}
           AND r.status IN ('published', 'unlisted') AND r."deletedAt" IS NULL
           AND NOT EXISTS (SELECT 1 FROM "contentReport" c
                            WHERE c."roomVersionId" = v.id AND c.source = 'sampling')
         ORDER BY v."publishedAt" ASC
         LIMIT ${limit}`;
    },
    transaction(fn) {
      return prisma.$transaction((tx) => fn(txOps(tx)));
    },
  };
}
