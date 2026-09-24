import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/client";
import { hashPurgedEmail, readEmailPurgeSecret } from "./access-key-email-purge";
import { hashPurgedValue, readIpUaPurgeSecret } from "./ip-ua-purge";
import {
  UserDataRightsError,
  type UserDataExportBundle,
  type UserDataRightsStore,
  type UserProfileRow,
} from "./user-data-rights";

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  image: true,
  locale: true,
  isAdmin: true,
  isModerator: true,
  createdAt: true,
} as const;

/**
 * Email/nombre anónimos tras `DELETE /api/me` (specs/18 §3.4): valor
 * **aleatorio**, no derivado del email original — es anonimización real (no
 * hay clave con la que reconstruir el email de partida), a diferencia de la
 * seudonimización por hash que usan las purgas de `ipAddress`/`userAgent`/
 * `accessKey.email` (E-3, ver `ip-ua-purge.ts`).
 */
function anonymizedEmail(): string {
  return `deleted-${randomUUID()}@deleted.escaperoom.invalid`;
}
const ANONYMIZED_NAME = "Usuario eliminado";

/** Prefijo de las filas del OAuth del MCP en `verification` (ver `mcp-oauth-store.ts`). */
const MCP_OAUTH_IDENTIFIER_PREFIX = "mcp-oauth:";
/** TTL de la marca `revoked-grant`: el mismo que el refresh token del MCP (`provider.ts` DEFAULTS). */
const MCP_OAUTH_REVOKED_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Borra un objeto propio del usuario en storage (p. ej. el avatar); inyectable para tests. */
export type UserDataRightsStoreDeps = {
  deleteStorageObject: (key: string) => Promise<void>;
};

/** `image` es una key propia en storage (no una URL externa, p. ej. el avatar de Google OAuth). */
function isOwnStorageKey(image: string | null): image is string {
  return image !== null && !/^https?:\/\//i.test(image);
}

/**
 * Implementación Prisma de los derechos RGPD sobre la cuenta propia (ticket
 * 6.2, specs/18 §3.4, A-5/E-5). `anonymizeAccount` combina lecturas previas
 * (guardia de único owner, avatar, grants MCP, filas a hashear) con una única
 * transacción que anonimiza `user`, revoca `session`/`account`, borra
 * `member`/`invitation`/`verification` propios y hashea de inmediato
 * `termsAcceptance` y `accessKey.email` si procede; no toca `purchase`,
 * `review`, `room` ni el historial de moderación (ver `user-data-rights.ts`).
 */
export function createPrismaUserDataRightsStore(
  prisma: PrismaClient,
  deps: UserDataRightsStoreDeps,
): UserDataRightsStore {
  return {
    async findProfile(userId): Promise<UserProfileRow | null> {
      return prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
    },

    async loadExportBundle(userId): Promise<Omit<UserDataExportBundle, "profile">> {
      const [
        memberships,
        creditAccount,
        rooms,
        purchases,
        events,
        reviews,
        strikes,
        appeals,
        reports,
      ] = await Promise.all([
        prisma.member.findMany({
          where: { userId },
          select: { organizationId: true, role: true, organization: { select: { name: true, slug: true } } },
        }),
        prisma.creditAccount.findFirst({ where: { userId }, select: { balanceCredits: true } }),
        prisma.room.findMany({
          where: { authorId: userId },
          select: { id: true, title: true, status: true, createdAt: true, updatedAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.purchase.findMany({
          where: { userId },
          select: {
            id: true,
            purchaseType: true,
            amountCents: true,
            currency: true,
            status: true,
            createdAt: true,
            room: { select: { title: true } },
            roomVersion: { select: { room_roomVersion_roomIdToroom: { select: { title: true } } } },
            event: { select: { title: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.event.findMany({
          where: { organizerId: userId },
          select: { id: true, title: true, status: true, audience: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.review.findMany({
          where: { userId },
          select: {
            roomId: true,
            rating: true,
            text: true,
            createdAt: true,
            updatedAt: true,
            hiddenAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.moderationStrike.findMany({
          where: { userId },
          select: { id: true, severity: true, consequence: true, createdAt: true, revokedAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.moderationAppeal.findMany({
          where: { creatorId: userId },
          select: { id: true, reason: true, status: true, createdAt: true, reviewedAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.contentReport.findMany({
          where: { reporterId: userId },
          select: { id: true, reason: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      return {
        organizations: memberships.map((m) => ({
          organizationId: m.organizationId,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
        })),
        personalCreditsBalance: Number(creditAccount?.balanceCredits ?? 0n),
        roomsAuthored: rooms,
        purchases: purchases.map((p) => ({
          id: p.id,
          purchaseType: p.purchaseType,
          amountCents: p.amountCents,
          currency: p.currency,
          status: p.status,
          createdAt: p.createdAt,
          roomTitle: p.room?.title ?? p.roomVersion?.room_roomVersion_roomIdToroom?.title ?? null,
          eventTitle: p.event?.title ?? null,
        })),
        eventsOrganized: events,
        reviews: reviews.map((r) => ({
          roomId: r.roomId,
          rating: r.rating,
          text: r.text,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          hidden: r.hiddenAt !== null,
        })),
        moderationStrikesReceived: strikes,
        moderationAppealsFiled: appeals,
        contentReportsFiled: reports,
      };
    },

    async anonymizeAccount(userId, at): Promise<void> {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, image: true },
      });

      // Guardia: no dejar huérfana una organización de la que es único owner.
      const memberships = await prisma.member.findMany({
        where: { userId },
        select: { organizationId: true, role: true },
      });
      const ownedOrgIds = memberships
        .filter((m) => m.role.split(",").map((r) => r.trim()).includes("owner"))
        .map((m) => m.organizationId);
      if (ownedOrgIds.length > 0) {
        const counts = await prisma.member.groupBy({
          by: ["organizationId"],
          where: { organizationId: { in: ownedOrgIds } },
          _count: { _all: true },
        });
        if (counts.some((c) => c._count._all > 1)) {
          throw new UserDataRightsError(
            "SOLE_ORG_OWNER",
            "Eres el único propietario de una organización con más miembros: transfiere " +
              "la propiedad antes de cerrar la cuenta",
          );
        }
      }

      // Avatar propio en storage (no una URL externa de OAuth): se borra fuera
      // de la transacción (el storage no es transaccional con Postgres); si
      // falla, no bloquea el cierre de cuenta.
      if (isOwnStorageKey(user.image)) {
        await deps.deleteStorageObject(user.image).catch(() => undefined);
      }

      // Grants OAuth del MCP del usuario (`mcp-oauth:*` cuyo `value.userId`
      // coincide, ver `mcp-oauth-store.ts`): sus filas para borrar y sus
      // `grantId` para dejar la marca `revoked-grant` (mismo mecanismo que
      // `provider.ts#revokeGrant`). Filtrado por `userId` en SQL: no tiene
      // sentido traer las filas de otros usuarios a Node.
      const mcpOauthRows = await prisma.$queryRaw<{ id: string; value: string }[]>`
        SELECT id, value FROM "verification"
        WHERE identifier LIKE ${`${MCP_OAUTH_IDENTIFIER_PREFIX}%`}
          AND value::jsonb ->> 'userId' = ${userId}
      `;
      const grantIds = new Set<string>();
      for (const row of mcpOauthRows) {
        try {
          const parsed = JSON.parse(row.value) as { grantId?: string };
          if (parsed.grantId) grantIds.add(parsed.grantId);
        } catch {
          // No debería ocurrir (el filtro SQL ya exige JSON válido), pero por
          // si acaso: fila ignorada, no bloquea el resto del borrado.
        }
      }
      const revokedGrantExpiresAt = new Date(at.getTime() + MCP_OAUTH_REVOKED_GRANT_TTL_MS);

      // Hash inmediato (E-3, mismo mecanismo que los jobs periódicos) de
      // ipAddress/userAgent en `termsAcceptance` y de `accessKey.email` si el
      // usuario fue participante — no hace falta esperar los plazos de
      // retención habituales porque la cuenta se cierra ya.
      const ipUaSecret = readIpUaPurgeSecret();
      const termsAcceptances = ipUaSecret
        ? await prisma.termsAcceptance.findMany({
            where: {
              userId,
              OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }],
            },
            select: { id: true, ipAddress: true, userAgent: true },
          })
        : [];
      const emailSecret = readEmailPurgeSecret();
      const participantKeys =
        emailSecret && user.email
          ? await prisma.accessKey.findMany({
              where: { email: user.email },
              select: { code: true },
            })
          : [];

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            email: anonymizedEmail(),
            name: ANONYMIZED_NAME,
            image: null,
            emailVerified: false,
            stripeCustomerId: null,
            stripeAccountId: null,
            deletedAt: at,
            updatedAt: at,
          },
        }),
        prisma.session.deleteMany({ where: { userId } }),
        prisma.account.deleteMany({ where: { userId } }),
        prisma.member.deleteMany({ where: { userId } }),
        prisma.invitation.deleteMany({ where: { email: user.email } }),
        prisma.verification.deleteMany({
          where: { identifier: { startsWith: MCP_OAUTH_IDENTIFIER_PREFIX }, id: { in: mcpOauthRows.map((r) => r.id) } },
        }),
        // Magic links vigentes emitidos a su email (`identifier` es el token,
        // `value` es `{email, name}`, ver el plugin `magic-link` de Better
        // Auth); excluye los `mcp-oauth:*`, ya borrados arriba por id.
        prisma.$executeRaw`
          DELETE FROM "verification"
          WHERE identifier NOT LIKE ${`${MCP_OAUTH_IDENTIFIER_PREFIX}%`}
            AND CASE WHEN value LIKE '{%'
              THEN lower(value::jsonb ->> 'email') = lower(${user.email})
              ELSE false
            END
        `,
        ...[...grantIds].map((grantId) =>
          prisma.verification.create({
            data: {
              id: randomUUID(),
              identifier: `${MCP_OAUTH_IDENTIFIER_PREFIX}revoked-grant:${grantId}`,
              value: JSON.stringify({ revokedAt: at.toISOString() }),
              expiresAt: revokedGrantExpiresAt,
            },
          }),
        ),
        ...termsAcceptances.map((row) =>
          prisma.termsAcceptance.update({
            where: { id: row.id },
            data: {
              ipAddress:
                row.ipAddress !== null ? hashPurgedValue(row.ipAddress, ipUaSecret!, "ip") : null,
              userAgent:
                row.userAgent !== null ? hashPurgedValue(row.userAgent, ipUaSecret!, "ua") : null,
            },
          }),
        ),
        ...participantKeys.map((k) =>
          prisma.accessKey.update({
            where: { code: k.code },
            data: { email: hashPurgedEmail(user.email, emailSecret!) },
          }),
        ),
      ]);
    },
  };
}
