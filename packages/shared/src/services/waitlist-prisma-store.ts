import type { Locale } from "@escaperoom/config/locales";
import type { PrismaClient } from "../../generated/client";
import type { WaitlistSignup, WaitlistStore } from "./waitlist";

type WaitlistRow = {
  id: string;
  email: string;
  locale: string;
  source: string | null;
  createdAt: Date;
};

function toSignup(row: WaitlistRow): WaitlistSignup {
  return {
    id: row.id,
    email: row.email,
    locale: row.locale as Locale,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Store de la waitlist sobre Postgres (`waitlistSignup`, `UNIQUE(email)`). */
export function createPrismaWaitlistStore(prisma: PrismaClient): WaitlistStore {
  return {
    async upsert({ email, locale, source }) {
      // `xmax = 0` distingue la fila insertada de la ya existente (ON CONFLICT
      // no la toca: el primer alta de un email gana su `locale`/`source`).
      const rows = await prisma.$queryRaw<Array<{ id: string; created: boolean }>>`
        INSERT INTO "waitlistSignup" (email, locale, source)
        VALUES (${email}::citext, ${locale}, ${source})
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
        RETURNING id, (xmax = 0) AS created`;
      const row = rows[0];
      if (!row) throw new Error("upsert de waitlist sin fila devuelta");
      const signup = await prisma.waitlistSignup.findUniqueOrThrow({ where: { id: row.id } });
      return { signup: toSignup(signup), created: row.created };
    },
  };
}
