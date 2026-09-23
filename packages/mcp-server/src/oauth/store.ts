/**
 * Persistencia del servidor de autorización OAuth del MCP (ticket 4.7): un
 * almacén clave → valor JSON con caducidad. Guarda clientes registrados,
 * códigos de autorización, tokens (siempre por su hash, nunca en claro) y las
 * marcas de revocación. El servicio no depende de Prisma (ADR-022): la web lo
 * implementa sobre la tabla `verification` de Better Auth y los tests, en
 * memoria.
 */
export type OAuthStore = {
  /** Guarda (o sustituye) `value` en `key` hasta `expiresAt`. */
  put(key: string, value: unknown, expiresAt: Date): Promise<void>;
  /** Valor vigente de `key`, o `null` si no existe o ha caducado. */
  get<T = unknown>(key: string): Promise<T | null>;
  /**
   * Lee y borra `key` de forma atómica (un solo consumidor): los códigos de
   * autorización y los refresh tokens rotados solo se canjean una vez.
   */
  take<T = unknown>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
};

/** Almacén en memoria del proceso (tests y desarrollo). */
export function createInMemoryOAuthStore(now: () => Date = () => new Date()): OAuthStore {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  const read = <T>(key: string): T | null => {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now().getTime()) {
      entries.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  };
  return {
    async put(key, value, expiresAt) {
      entries.set(key, { value: JSON.stringify(value), expiresAt: expiresAt.getTime() });
    },
    async get<T>(key: string) {
      return read<T>(key);
    },
    async take<T>(key: string) {
      const value = read<T>(key);
      entries.delete(key);
      return value;
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}
