import { z } from "zod";
import { AdminError, parseOrThrow, requireAdmin, type AdminDirectory } from "./admin";
import type { Actor } from "./actor";
import { UUID_RE } from "./common";

/**
 * Tramos de precio editables (`pricingTier`, specs/02 §3.2, specs/14 §8,
 * ADR-012). Regla de edición: **nunca se reescribe una fila vigente**. Cambiar
 * un tramo = cerrar la fila con `activeUntil` y crear otra con `activeFrom`
 * igual a ese instante; lo único que se escribe sobre una fila existente es su
 * cierre. Así el histórico queda intacto y consultable por fecha, y los eventos
 * congelan los tramos en `event.pricingSnapshot` (JSON) al crearse.
 */

/** Fila persistida de `pricingTier`. */
export type PricingTierRow = {
  id: string;
  minPlayers: number;
  /** `null` = sin límite superior. */
  maxPlayers: number | null;
  priceCentsPerPlayer: number;
  currency: string;
  activeFrom: Date;
  activeUntil: Date | null;
  createdBy: string;
  createdAt: Date;
};

export type NewPricingTier = Omit<PricingTierRow, "id" | "createdAt" | "activeUntil">;

export type PricingTierStatus = "scheduled" | "active" | "closed";

/** Operaciones dentro del lock de tramos (serializa escrituras concurrentes). */
export interface PricingTierTx {
  listTiers(): Promise<PricingTierRow[]>;
  findTier(id: string): Promise<PricingTierRow | null>;
  insertTier(tier: NewPricingTier): Promise<PricingTierRow>;
  /** Fija `activeUntil` (el único cambio permitido sobre una fila existente). */
  closeTier(id: string, activeUntil: Date): Promise<PricingTierRow>;
}

/** Puerto de persistencia de `pricingTier` (ADR-022). */
export interface PricingTierStore extends AdminDirectory {
  listTiers(): Promise<PricingTierRow[]>;
  withPricingLock<T>(fn: (tx: PricingTierTx) => Promise<T>): Promise<T>;
}

/** Tramos congelados en un evento (`event.pricingSnapshot`). */
export type PricingSnapshot = {
  version: 1;
  /** Instante (ISO 8601) cuyos tramos vigentes se congelaron. */
  capturedAt: string;
  tiers: Array<{
    tierId: string;
    minPlayers: number;
    maxPlayers: number | null;
    priceCentsPerPlayer: number;
    currency: string;
  }>;
};

export type PricingQuote = {
  tierId: string;
  players: number;
  unitPriceCents: number;
  totalCents: number;
  currency: string;
};


const players = z.number().int().min(1).max(100_000);
const priceCents = z.number().int().min(0).max(1_000_000);
const currency = z.string().regex(/^[A-Z]{3}$/, "Código ISO 4217 en mayúsculas");
const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const maxNotBelowMin = (t: { minPlayers?: number; maxPlayers?: number | null }) =>
  t.maxPlayers == null || t.minPlayers === undefined || t.maxPlayers >= t.minPlayers;
const RANGE_MESSAGE = { message: "maxPlayers debe ser ≥ minPlayers", path: ["maxPlayers"] };

/** Cuerpo de `POST /api/admin/pricing-tiers`. */
export const CreatePricingTierInput = z
  .object({
    minPlayers: players,
    maxPlayers: players.nullable().default(null),
    priceCentsPerPlayer: priceCents,
    currency: currency.default("EUR"),
    /** Por defecto, ahora. Nunca en el pasado (no se reescribe el histórico). */
    activeFrom: instant.optional(),
  })
  .strict()
  .refine(maxNotBelowMin, RANGE_MESSAGE);

/**
 * Cuerpo de `PATCH /api/admin/pricing-tiers/:id`. Dos formas excluyentes:
 * - cambios (`minPlayers`/`maxPlayers`/`priceCentsPerPlayer`/`currency`, más
 *   `effectiveFrom` opcional) → cierra la fila y crea su sucesora;
 * - `{ activeUntil }` → retira el tramo en ese instante, sin sucesor.
 */
export const UpdatePricingTierInput = z
  .object({
    minPlayers: players.optional(),
    maxPlayers: players.nullable().optional(),
    priceCentsPerPlayer: priceCents.optional(),
    currency: currency.optional(),
    effectiveFrom: instant.optional(),
    activeUntil: instant.optional(),
  })
  .strict()
  .refine(maxNotBelowMin, RANGE_MESSAGE)
  .superRefine((input, ctx) => {
    const changes = (
      ["minPlayers", "maxPlayers", "priceCentsPerPlayer", "currency"] as const
    ).filter((k) => input[k] !== undefined).length;
    if (input.activeUntil !== undefined) {
      if (changes > 0 || input.effectiveFrom !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["activeUntil"],
          message: "activeUntil (retirar) no se combina con cambios del tramo",
        });
      }
    } else if (changes === 0) {
      ctx.addIssue({ code: "custom", path: [], message: "No hay cambios que aplicar" });
    }
  });

export const PricingTierListQuery = z.object({
  status: z.enum(["scheduled", "active", "closed"]).optional(),
});

/** Estado de una fila en el instante `at`. */
export function pricingTierStatus(tier: PricingTierRow, at: Date): PricingTierStatus {
  if (tier.activeFrom > at) return "scheduled";
  if (tier.activeUntil !== null && tier.activeUntil <= at) return "closed";
  return "active";
}

const end = (d: Date | null) => d?.getTime() ?? Number.POSITIVE_INFINITY;

/** `true` si dos tramos coinciden en rango de jugadores y en ventana de vigencia. */
function overlaps(
  a: Pick<PricingTierRow, "minPlayers" | "maxPlayers" | "activeFrom" | "activeUntil">,
  b: Pick<PricingTierRow, "minPlayers" | "maxPlayers" | "activeFrom" | "activeUntil">,
): boolean {
  const inTime =
    a.activeFrom.getTime() < end(b.activeUntil) && b.activeFrom.getTime() < end(a.activeUntil);
  const inRange =
    a.minPlayers <= (b.maxPlayers ?? Number.POSITIVE_INFINITY) &&
    b.minPlayers <= (a.maxPlayers ?? Number.POSITIVE_INFINITY);
  return inTime && inRange;
}

/** Congela los tramos vigentes en `at` (lo que guarda `event.pricingSnapshot`). */
export function buildPricingSnapshot(tiers: readonly PricingTierRow[], at: Date): PricingSnapshot {
  return {
    version: 1,
    capturedAt: at.toISOString(),
    tiers: tiers
      .filter((t) => pricingTierStatus(t, at) === "active")
      .sort((a, b) => a.minPlayers - b.minPlayers)
      .map((t) => ({
        tierId: t.id,
        minPlayers: t.minPlayers,
        maxPlayers: t.maxPlayers,
        priceCentsPerPlayer: t.priceCentsPerPlayer,
        currency: t.currency,
      })),
  };
}

/**
 * Precio de `players` según un snapshot: el tramo que contiene el nº de
 * jugadores fija el precio por unidad de TODOS (120 alumnos × 0,75 € ≈ 90 €,
 * specs/02 §3.2). `null` si ningún tramo lo cubre.
 */
export function quotePricing(snapshot: PricingSnapshot, playerCount: number): PricingQuote | null {
  const tier = snapshot.tiers.find(
    (t) => playerCount >= t.minPlayers && (t.maxPlayers === null || playerCount <= t.maxPlayers),
  );
  if (!tier) return null;
  return {
    tierId: tier.tierId,
    players: playerCount,
    unitPriceCents: tier.priceCentsPerPlayer,
    totalCents: tier.priceCentsPerPlayer * playerCount,
    currency: tier.currency,
  };
}

function assertNoOverlap(
  candidate: Pick<PricingTierRow, "minPlayers" | "maxPlayers" | "activeFrom" | "activeUntil">,
  others: readonly PricingTierRow[],
): void {
  const clash = others.find((t) => overlaps(candidate, t));
  if (clash) {
    throw new AdminError(
      "CONFLICT",
      `Se solapa con el tramo ${clash.id} (${clash.minPlayers}–${clash.maxPlayers ?? "∞"} jugadores) en su vigencia`,
    );
  }
}

function notInPast(field: string, at: Date, now: Date): void {
  if (at < now) {
    throw new AdminError("VALIDATION_ERROR", "No se puede fechar en el pasado", [
      { path: field, message: "Debe ser un instante presente o futuro" },
    ]);
  }
}

export type UpdatePricingTierResult = {
  /** La fila original, ya cerrada con `activeUntil`. */
  closed: PricingTierRow;
  /** La sucesora con los cambios, o `null` si fue una retirada. */
  created: PricingTierRow | null;
};

export function createPricingTierService(deps: { store: PricingTierStore; now?: () => Date }) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    /** Solo el guard `isAdmin` (los adaptadores lo usan antes de leer el cuerpo). */
    authorize(actor: Actor): Promise<void> {
      return requireAdmin(actor, store);
    },

    /** `GET /api/admin/pricing-tiers` — histórico completo, filtrable por estado. */
    async listTiers(actor: Actor, query: unknown = {}): Promise<PricingTierRow[]> {
      await requireAdmin(actor, store);
      const { status } = parseOrThrow(PricingTierListQuery, query);
      const at = now();
      const rows = await store.listTiers();
      return rows
        .filter((t) => status === undefined || pricingTierStatus(t, at) === status)
        .sort(
          (a, b) => a.minPlayers - b.minPlayers || a.activeFrom.getTime() - b.activeFrom.getTime(),
        );
    },

    /** `POST /api/admin/pricing-tiers` — tramo nuevo (sin predecesor). */
    async createTier(actor: Actor, input: unknown): Promise<PricingTierRow> {
      await requireAdmin(actor, store);
      const data = parseOrThrow(CreatePricingTierInput, input);
      const at = now();
      const activeFrom = data.activeFrom ?? at;
      notInPast("activeFrom", activeFrom, at);
      return store.withPricingLock(async (tx) => {
        const candidate = { ...data, activeFrom, activeUntil: null };
        assertNoOverlap(candidate, await tx.listTiers());
        return tx.insertTier({
          minPlayers: data.minPlayers,
          maxPlayers: data.maxPlayers,
          priceCentsPerPlayer: data.priceCentsPerPlayer,
          currency: data.currency,
          activeFrom,
          createdBy: actor.userId,
        });
      });
    },

    /**
     * `PATCH /api/admin/pricing-tiers/:id` — cierra la fila y, salvo retirada,
     * crea su sucesora. Nunca se modifica precio/rango de una fila existente.
     */
    async updateTier(actor: Actor, id: string, input: unknown): Promise<UpdatePricingTierResult> {
      await requireAdmin(actor, store);
      const data = parseOrThrow(UpdatePricingTierInput, input);
      const at = now();
      return store.withPricingLock(async (tx) => {
        const tier = UUID_RE.test(id) ? await tx.findTier(id) : null;
        if (!tier) throw new AdminError("NOT_FOUND", "Tramo no encontrado");
        if (tier.activeUntil !== null) {
          throw new AdminError(
            "CONFLICT",
            pricingTierStatus(tier, at) === "closed"
              ? "El tramo está cerrado: forma parte del histórico y no se modifica"
              : "El tramo ya tiene cierre programado",
          );
        }

        if (data.activeUntil !== undefined) {
          notInPast("activeUntil", data.activeUntil, at);
          if (data.activeUntil < tier.activeFrom) {
            throw new AdminError("VALIDATION_ERROR", "El cierre es anterior a la vigencia", [
              { path: "activeUntil", message: "Debe ser ≥ activeFrom del tramo" },
            ]);
          }
          return { closed: await tx.closeTier(tier.id, data.activeUntil), created: null };
        }

        const effectiveFrom = data.effectiveFrom ?? (tier.activeFrom > at ? tier.activeFrom : at);
        notInPast("effectiveFrom", effectiveFrom, at);
        if (effectiveFrom < tier.activeFrom) {
          throw new AdminError("VALIDATION_ERROR", "El cambio es anterior a la vigencia", [
            { path: "effectiveFrom", message: "Debe ser ≥ activeFrom del tramo" },
          ]);
        }
        const successor = {
          minPlayers: data.minPlayers ?? tier.minPlayers,
          maxPlayers: data.maxPlayers === undefined ? tier.maxPlayers : data.maxPlayers,
          priceCentsPerPlayer: data.priceCentsPerPlayer ?? tier.priceCentsPerPlayer,
          currency: data.currency ?? tier.currency,
          activeFrom: effectiveFrom,
          createdBy: actor.userId,
        };
        if (successor.maxPlayers !== null && successor.maxPlayers < successor.minPlayers) {
          throw new AdminError("VALIDATION_ERROR", "Datos no válidos", [
            { path: "maxPlayers", message: RANGE_MESSAGE.message },
          ]);
        }
        const others = (await tx.listTiers()).filter((t) => t.id !== tier.id);
        assertNoOverlap({ ...successor, activeUntil: null }, others);
        const closed = await tx.closeTier(tier.id, effectiveFrom);
        const created = await tx.insertTier(successor);
        return { closed, created };
      });
    },

    /**
     * Tramos vigentes en `at` congelados para un evento (specs/13 §6.1: `POST
     * /api/events` calcula `pricingSnapshot` desde `pricingTier`). Interna, sin actor.
     */
    async snapshotAt(at: Date = now()): Promise<PricingSnapshot> {
      return buildPricingSnapshot(await store.listTiers(), at);
    },
  };
}

export type PricingTierService = ReturnType<typeof createPricingTierService>;

/** Store en memoria con la misma semántica que el de Prisma (lock global). */
export function createInMemoryPricingTierStore(opts: {
  adminIds?: Iterable<string>;
  tiers?: PricingTierRow[];
}): PricingTierStore {
  const admins = new Set(opts.adminIds ?? []);
  const rows = (opts.tiers ?? []).map((t) => ({ ...t }));
  let lock: Promise<unknown> = Promise.resolve();
  const copy = (t: PricingTierRow): PricingTierRow => ({ ...t });

  const tx: PricingTierTx = {
    async listTiers() {
      return rows.map(copy);
    },
    async findTier(id) {
      const row = rows.find((t) => t.id === id);
      return row ? copy(row) : null;
    },
    async insertTier(tier) {
      const row: PricingTierRow = {
        ...tier,
        id: crypto.randomUUID(),
        activeUntil: null,
        createdAt: new Date(),
      };
      rows.push(row);
      return copy(row);
    },
    async closeTier(id, activeUntil) {
      const row = rows.find((t) => t.id === id);
      if (!row) throw new AdminError("NOT_FOUND", "Tramo no encontrado");
      row.activeUntil = activeUntil;
      return copy(row);
    },
  };

  return {
    listTiers: tx.listTiers,
    async isAdmin(userId) {
      return admins.has(userId);
    },
    withPricingLock(fn) {
      const run = lock.then(
        () => fn(tx),
        () => fn(tx),
      );
      lock = run.catch(() => undefined);
      return run;
    },
  };
}
