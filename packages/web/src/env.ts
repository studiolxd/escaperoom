import { parseEnv } from "@escaperoom/env";
import { baseClientSchema } from "@escaperoom/env/client";
import { baseServerSchema } from "@escaperoom/env/server";

/**
 * Esquema de entorno de la app. Aún no se importa desde el runtime: se activa
 * cuando la app necesite env (ticket 0.2+), para que `next build` no exija
 * secretos en el andamiaje.
 */
export const env = parseEnv({
  serverSchema: baseServerSchema,
  clientSchema: baseClientSchema,
  clientSource: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_COLYSEUS_URL: process.env.NEXT_PUBLIC_COLYSEUS_URL,
  },
});
