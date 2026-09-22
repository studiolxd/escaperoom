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
