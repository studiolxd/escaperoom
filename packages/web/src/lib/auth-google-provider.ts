/**
 * Proveedor Google de Better Auth (A-17): antes se registraba siempre con
 * `clientId`/`clientSecret` `?? ""`, así que Google aparecía "configurado"
 * con credenciales vacías incluso sin las variables de entorno. Aislado en su
 * propio módulo para poder testearlo sin construir `betterAuth(...)` entero
 * (que necesita Prisma y el resto de secretos).
 */
export type GoogleSocialProviders = {
  google: { clientId: string; clientSecret: string };
};

/** `undefined` (proveedor no registrado) salvo que ambas variables estén presentes. */
export function resolveGoogleSocialProviders(
  env: Record<string, string | undefined> = process.env,
): GoogleSocialProviders | undefined {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { google: { clientId, clientSecret } } : undefined;
}
