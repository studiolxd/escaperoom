import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers compartidos de env.ts. Adaptado de @slxd/env (ADR-017).
// ---------------------------------------------------------------------------

/** Coerces "true"/"false" env strings to booleans with a typed default. */
export const bool = (defaultValue: boolean) =>
  z
    .string()
    .default(defaultValue ? "true" : "false")
    .transform((v) => v === "true");

/**
 * The server schema is only validated on the server: in the browser bundle
 * Next.js inlines `NEXT_PUBLIC_*` and replaces everything else with
 * `undefined`, so parsing the server schema there would always fail.
 */
export const IS_SERVER = typeof window === "undefined";

/**
 * Whether a secreto/dato de desarrollo comiteado en el repo (`DEV_*_SECRET`,
 * fixtures sin persistencia…) puede usarse (E-4/A-19/C-5/F-41). El criterio
 * anterior en cada punto de lectura era `NODE_ENV !== "production"`: un
 * despliegue real que simplemente **no fija** `NODE_ENV` (o lo fija a algo
 * distinto de `"production"`, p. ej. `"staging"`) caía igual al secreto
 * público del repo, en silencio. Aquí es lista blanca, no lista negra: solo
 * `development` y `test` lo permiten; cualquier otro valor (incluido
 * `undefined`) lo deniega.
 */
export function isDevFallbackAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

/**
 * Treat an empty-string env value as "unset" so a schema `.default()` applies.
 * A verbatim `cp .env.example .env.local` assigns `KEY=` (empty) and Zod's
 * `.default()` only fires on `undefined`, never on `""`.
 */
export function emptyStringAsUndefined<T extends Record<string, unknown>>(source: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === "" ? undefined : value;
  }
  return out as T;
}

/**
 * Falla fuerte si, en producción, falta alguna de las variables listadas
 * (E-4/A-19/C-5/F-41): un despliegue real sin ellas debe negarse a arrancar
 * en vez de degradar en silencio (firmar tokens con secretos ausentes,
 * "enviar" emails a la nada…). Fuera de producción no exige nada: cada
 * `read*Config`/`create*FromEnv` de `@escaperoom/shared` ya tiene su propio
 * secreto/comportamiento de desarrollo (`isDevFallbackAllowed`).
 */
export function requireInProduction(
  env: Record<string, unknown> & { NODE_ENV?: string },
  fields: readonly string[],
): void {
  if (env.NODE_ENV !== "production") return;
  const missing = fields.filter((field) => {
    const value = env[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno obligatorias en producción: ${missing.join(", ")}`,
    );
  }
}

type AnyZodObject = z.ZodObject<z.ZodRawShape>;

/**
 * Parse-and-merge shared by every app's `env.ts`: validates the client schema
 * always and the server schema only on the server, aggregating every issue in
 * one readable error.
 */
export function parseEnv<S extends AnyZodObject, C extends AnyZodObject>(config: {
  serverSchema: S;
  clientSchema: C;
  clientSource: Record<string, unknown>;
}): z.infer<S> & z.infer<C> {
  const { serverSchema, clientSchema, clientSource } = config;
  const errors: string[] = [];

  const collect = (result: { success: boolean; error?: z.ZodError }) => {
    if (!result.success && result.error) {
      errors.push(...result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`));
    }
  };

  const clientResult = clientSchema.safeParse(emptyStringAsUndefined(clientSource));
  collect(clientResult);

  if (IS_SERVER) {
    const serverResult = serverSchema.safeParse(emptyStringAsUndefined(process.env));
    collect(serverResult);

    if (errors.length > 0) {
      throw new Error(
        `Invalid environment variables:\n${errors.join("\n")}\n\nSee .env.example for documentation.`,
      );
    }

    return { ...serverResult.data!, ...clientResult.data! };
  }

  if (errors.length > 0) {
    throw new Error(`Invalid client environment variables:\n${errors.join("\n")}`);
  }

  return guardServerKeys({ ...clientResult.data! }, Object.keys(serverSchema.shape)) as z.infer<S> &
    z.infer<C>;
}

/**
 * Fail-loud for server vars read in the browser: in the client bundle the env
 * only carries `NEXT_PUBLIC_*`, so reading a server field would silently return
 * `undefined` — which turns `if (env.SECRET)` into a check that checks nothing.
 * The Proxy raises a named error instead. Not applied under test (jsdom defines
 * `window` even for server code).
 */
export function guardServerKeys<T extends object>(value: T, serverKeys: string[]): T {
  if (typeof window === "undefined") return value;
  if (process.env.NODE_ENV === "test") return value;
  const guarded = new Set(serverKeys.filter((k) => !(k in value)));
  if (guarded.size === 0) return value;
  return new Proxy(value, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && guarded.has(prop)) {
        throw new Error(
          `env.${prop} is a SERVER variable and was read in the browser: its value doesn't ` +
            `ship to the bundle, so it would silently be \`undefined\`. Move it to server code ` +
            `or expose a NEXT_PUBLIC_* equivalent.`,
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
