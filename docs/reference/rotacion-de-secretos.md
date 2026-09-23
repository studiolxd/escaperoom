# Rotación de secretos (ticket 6.3)

Procedimiento corto para cambiar los secretos de producción (specs/24 §6). Ninguno admite hoy dos
valores a la vez: rotar **invalida lo firmado con el anterior**. Por eso cada fila dice qué se rompe
y cuánto dura el efecto.

## Procedimiento general

1. **Generar** el valor nuevo: `openssl rand -base64 48` (≥ 32 caracteres; `APP_SECRET` y
   `BETTER_AUTH_SECRET` lo exigen en `@escaperoom/env`).
2. **Elegir la ventana**: fuera de eventos activos y de horas de juego (panel del organizador y
   `GET /api/me/events`).
3. **Actualizar** la variable en el gestor de secretos del despliegue en **todos los servicios que
   la leen a la vez** (columna «Servicios»): un secreto compartido a medias rompe la verificación
   entre servicios.
4. **Reiniciar** esos servicios (los secretos se leen al arrancar) y comprobar el síntoma de la
   última columna.
5. **Registrar** la rotación (fecha, motivo, quién) en el canal de operaciones.

Rotar **ya**, sin esperar ventana, si hay sospecha de fuga: el coste de la tabla es siempre menor.

## Secretos

| Secreto | Servicios | Firma / protege | Qué se rompe al rotar | Cómo se recupera |
|---|---|---|---|---|
| `JOIN_TOKEN_SECRET` | web + colyseus-server | `joinToken` del canje (`POST /api/access-keys/redeem`) que exige la room `event` | Los `joinToken` emitidos y aún no usados (vida por defecto 15 min, máx. 2 h con `JOIN_TOKEN_TTL_SECONDS`). Quien ya está dentro sigue jugando. | Rotar con los eventos parados. El canje consume la clave: si alguien se queda fuera, el organizador genera claves nuevas (`POST /api/events/:id/access-keys`). |
| `PLAYTEST_SECRET` | web + colyseus-server | Autenticación web → Colyseus (`Authorization: Bearer`) y el token de los enlaces de playtest | Enlaces de playtest vivos (2 h por defecto, máx. 24 h) y el registro de playtests nuevos hasta que ambos servicios tengan el mismo valor. | El creador vuelve a pulsar «Playtest» en el editor. |
| `CONFIRMATION_TOKEN_SECRET` (si falta, `APP_SECRET`) | web + worker | Enlaces de confirmación de invitaciones por email | Los enlaces pendientes (vida 30 días, `CONFIRMATION_TOKEN_TTL_SECONDS`): responden `CONFIRMATION_INVALID`. | `POST /api/events/:id/invitations/resend` reenvía enlaces nuevos a los pendientes (ojo: límite de 5/h por organizador). |
| `APP_SECRET` | web + worker | URLs firmadas de descarga del PDF de claves (24 h) y, si no hay `CONFIRMATION_TOKEN_SECRET`, la confirmación | Descargas de PDF ya enlazadas (y la confirmación si comparte secreto). | Volver a pedir el export. Recomendado: tener `CONFIRMATION_TOKEN_SECRET` propio para rotarlos por separado. |
| `BETTER_AUTH_SECRET` | web | Cookies de sesión de Better Auth | **Todas las sesiones**: todo el mundo tiene que volver a entrar. | Automático al iniciar sesión. Rotar solo por sospecha de fuga o en mantenimiento anunciado. |
| `GOOGLE_CLIENT_SECRET` (OAuth) | web | Intercambio del código OAuth con Google | Nada si se hace en dos pasos. | En Google Cloud Console: crear un secreto nuevo en el mismo cliente OAuth, desplegarlo, comprobar un login y **después** deshabilitar el anterior. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | colyseus-server (+ servidor LiveKit) | Tokens de medios | Tokens emitidos (vida corta); las llamadas en curso siguen hasta reconectar. | Crear el par nuevo en LiveKit, desplegar, borrar el viejo. El cliente pide token nuevo al reconectar. |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | web + worker | Bucket S3/R2 y sus URLs firmadas | URLs firmadas vivas (≤ 24 h). | Crear la clave nueva en R2, desplegar, revocar la vieja. |
| `RESEND_API_KEY` / `SMTP_PASS` | worker (+ web si envía) | Envío de emails | Emails en cola mientras no coincida: BullMQ reintenta. | Clave nueva en el proveedor, desplegar, revocar la vieja. |
| Tokens del MCP del creador | web (MCP) | Acceso de los clientes MCP | — | Los gestiona el MCP (tickets 4.5/4.7), no este procedimiento. |

## Después de rotar

- Canje: canjear una clave de un evento de prueba y entrar en la room `event`.
- Playtest: abrir un enlace nuevo desde el editor.
- Confirmación: enviar una invitación a una cuenta propia y confirmar.
- Login: entrar con Google.
