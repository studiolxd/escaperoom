import type { PrismaClient } from "../../generated/client/client";
import { MCP_OAUTH_PURGE_IDENTIFIER_PREFIX, type McpOAuthPurgeStore } from "./mcp-oauth-purge";

/** `identifier LIKE 'mcp-oauth:%' AND expiresAt < now()` (A-15). */
export function createPrismaMcpOAuthPurgeStore(prisma: PrismaClient): McpOAuthPurgeStore {
  return {
    async purgeExpired(now) {
      const { count } = await prisma.verification.deleteMany({
        where: {
          identifier: { startsWith: MCP_OAUTH_PURGE_IDENTIFIER_PREFIX },
          expiresAt: { lt: now },
        },
      });
      return count;
    },
  };
}
