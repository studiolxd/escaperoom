import { z } from "zod";
import { MAX_PLAYERS_PER_ROOM_CEILING } from "../schemas/limits";
import { AdminError, parseOrThrow, requireAdmin, type AdminDirectory } from "./admin";
import type { Actor } from "./actor";

/**
 * Ajustes de plataforma editables por admin (`platformSetting`, specs/14 §8,
 * ADR-012). Cada clave conocida declara su esquema Zod y su valor por defecto:
 * una clave fuera del registro no existe (404) y un valor que no pasa su
 * esquema se rechaza (422) antes de tocar la base de datos.
 */

/**
 * Techo absoluto de `maxPlayersPerRoom` (definido en `schemas/limits.ts`,
 * fuente única compartida con `RoomPackageSchema`): la paleta de tintes de
 * jugador de colyseus-server tiene 8 colores; por encima se repetirían.
 */
export { MAX_PLAYERS_PER_ROOM_CEILING };

export const PLATFORM_SETTINGS = {
  /**
   * Tope de jugadores por sala: alimenta el validador de creación de salas y
   * el cap de publishers de LiveKit (specs/11, specs/12 §3) — una sola fuente
   * de verdad.
   */
  maxPlayersPerRoom: {
    schema: z.number().int().min(1).max(MAX_PLAYERS_PER_ROOM_CEILING),
    defaultValue: 6,
  },
} as const satisfies Record<string, { schema: z.ZodType; defaultValue: unknown }>;

export type PlatformSettingKey = keyof typeof PLATFORM_SETTINGS;
export type PlatformSettingValue<K extends PlatformSettingKey> = z.output<
  (typeof PLATFORM_SETTINGS)[K]["schema"]
>;

export function isPlatformSettingKey(key: string): key is PlatformSettingKey {
  return Object.hasOwn(PLATFORM_SETTINGS, key);
}

/** Fila persistida de `platformSetting`. */
export type PlatformSettingRow = {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: Date;
};

/** Ajuste resuelto: valor persistido o, si no hay fila, el por defecto. */
export type PlatformSetting = {
  key: PlatformSettingKey;
  value: unknown;
  /** `true` si no hay fila y se devuelve `defaultValue`. */
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
};

/** Puerto de persistencia de `platformSetting` (ADR-022). */
export interface PlatformSettingStore extends AdminDirectory {
  findSetting(key: string): Promise<PlatformSettingRow | null>;
  upsertSetting(key: string, value: unknown, updatedBy: string): Promise<PlatformSettingRow>;
}

/** Cuerpo de `PATCH /api/admin/settings/:key`. */
export const UpdatePlatformSettingInput = z.object({ value: z.unknown() }).strict();

function assertKnownKey(key: string): PlatformSettingKey {
  if (!isPlatformSettingKey(key)) {
    throw new AdminError("NOT_FOUND", `Ajuste desconocido: ${key}`);
  }
  return key;
}

/**
 * Lee el valor efectivo de una clave. Si el valor persistido ya no pasa su
 * esquema (p. ej. se endureció el rango), cae al valor por defecto en vez de
 * propagar un dato inválido a los consumidores.
 */
function resolve(key: PlatformSettingKey, row: PlatformSettingRow | null): PlatformSetting {
  const def = PLATFORM_SETTINGS[key];
  const parsed = row ? def.schema.safeParse(row.value) : null;
  if (row && parsed?.success) {
    return {
      key,
      value: parsed.data,
      isDefault: false,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }
  return {
    key,
    value: def.defaultValue,
    isDefault: true,
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export function createPlatformSettingsService(deps: { store: PlatformSettingStore }) {
  const { store } = deps;

  return {
    /** Solo el guard `isAdmin` (los adaptadores lo usan antes de leer el cuerpo). */
    authorize(actor: Actor): Promise<void> {
      return requireAdmin(actor, store);
    },

    /** `GET /api/admin/settings/:key` — solo `isAdmin`. */
    async getSetting(actor: Actor, key: string): Promise<PlatformSetting> {
      await requireAdmin(actor, store);
      const known = assertKnownKey(key);
      return resolve(known, await store.findSetting(known));
    },

    /** `PATCH /api/admin/settings/:key` — valida con el esquema de la clave. */
    async updateSetting(actor: Actor, key: string, input: unknown): Promise<PlatformSetting> {
      await requireAdmin(actor, store);
      const known = assertKnownKey(key);
      const { value } = parseOrThrow(UpdatePlatformSettingInput, input);
      const parsed = parseOrThrow(PLATFORM_SETTINGS[known].schema, value);
      const row = await store.upsertSetting(known, parsed, actor.userId);
      return resolve(known, row);
    },

    /**
     * Lectura interna sin actor (validador de salas, LiveKit): valor efectivo
     * tipado de una clave conocida.
     */
    async readValue<K extends PlatformSettingKey>(key: K): Promise<PlatformSettingValue<K>> {
      return resolve(key, await store.findSetting(key)).value as PlatformSettingValue<K>;
    },
  };
}

export type PlatformSettingsService = ReturnType<typeof createPlatformSettingsService>;

/** Store en memoria con la misma semántica que el de Prisma. */
export function createInMemoryPlatformSettingStore(opts: {
  adminIds?: Iterable<string>;
  rows?: PlatformSettingRow[];
}): PlatformSettingStore {
  const admins = new Set(opts.adminIds ?? []);
  const rows = new Map((opts.rows ?? []).map((r) => [r.key, r]));
  return {
    async isAdmin(userId) {
      return admins.has(userId);
    },
    async findSetting(key) {
      const row = rows.get(key);
      return row ? structuredClone(row) : null;
    },
    async upsertSetting(key, value, updatedBy) {
      const row: PlatformSettingRow = {
        key,
        value: structuredClone(value),
        updatedBy,
        updatedAt: new Date(),
      };
      rows.set(key, row);
      return structuredClone(row);
    },
  };
}
