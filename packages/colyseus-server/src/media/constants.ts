/** Mensaje servidor → cliente con el token/capacidades de medios (specs/11 §8). */
export const MEDIA_TOKEN_MESSAGE = "media_token" as const;

/**
 * Mensaje cliente → servidor para (re)pedir el token en el join. El servidor
 * también lo envía de forma proactiva al entrar, pero el cliente puede pedirlo
 * de nuevo (p. ej. tras una reconexión) sin volver a unirse a la room.
 */
export const MEDIA_TOKEN_REQUEST_MESSAGE = "request_media_token" as const;
