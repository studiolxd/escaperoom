# Seguridad de la plataforma (ticket 6.3)

Referencia operativa de lo que implementa el ticket 6.3 a partir de `specs/13-api-rest.md` §11,
`specs/11-protocolo-multijugador.md` §9 y `specs/24-operaciones-y-escalabilidad.md` §6. Si cambias
un límite en el código, cámbialo aquí (y al revés).

- Código: `packages/kit/src/rate-limit/` (ventana deslizante + 429), `packages/web/src/server/rate-limit.ts`
  (tabla de rutas), `packages/colyseus-server/src/message-rate-limit.ts` (límite por mensaje),
  `packages/web/src/lib/security-headers.ts` + `src/proxy.ts` + `next.config.ts` (CSP y cabeceras).
- Tests: `packages/kit/test/rate-limit-sliding.test.ts`, `packages/web/test/rate-limit.test.ts`,
  `packages/colyseus-server/test/message-rate-limit.test.ts`, `packages/web/test/security-headers.test.ts`,
  `packages/web/test/admin-audit.test.ts`.
- Rotación de secretos: [rotacion-de-secretos.md](rotacion-de-secretos.md).

## 1. Rate limiting de rutas REST

**Algoritmo.** Ventana **deslizante** (log de instantes) en Redis: un sorted set por clave
(`<prefijo>:rls:<política>:<ip|user>:<id>`) con los instantes de los intentos **aceptados**; el
recorte, el alta, el recuento y el más antiguo van en un `MULTI`. Un intento que se pasa se retira,
así que insistir tras el 429 no alarga el bloqueo y `Retry-After` dice cuándo caduca el aceptado más
antiguo. Sin `REDIS_URL` (dev, tests, CI) el mismo algoritmo corre en memoria, por proceso. Si Redis
cae, el limitador **falla abierto** (se registra el error): el canje no se cae con Redis.

**Claves.** Siempre por IP + ruta; con sesión, además por usuario (un usuario que cambia de IP sigue
contando). El anónimo solo cuenta por IP. La sesión solo se consulta si la petición trae cookie o
`Authorization`.

**IP del cliente** (`clientIpFromHeaders`): `cf-connecting-ip` (Cloudflare) → `x-real-ip` → la
entrada **más a la derecha** de `x-forwarded-for` (la primera la escribe el cliente). Supone que el
origen solo acepta tráfico de Cloudflare; si no, esas cabeceras son falsificables.

**Respuesta.** `429` con `Retry-After: <segundos>`, `Cache-Control: no-store` y el error REST de
siempre: `{ "error": { "code": "RATE_LIMITED", "message": "…", "retryAfter": N } }`. Es el único
cambio de contrato de las rutas. En tRPC (`reviews.upsert`) el equivalente es `TOO_MANY_REQUESTS`.

**Cuota de fallos.** Algunas políticas tienen una cuota por IP que **solo gastan las respuestas 4xx**
(salvo 429). Es la defensa contra la fuerza bruta de códigos sin castigar a una clase entera que
canjea sus claves detrás del mismo NAT: los canjes correctos no la tocan.

| Política | Rutas | Por IP | Por usuario | Fallos por IP (4xx) |
|---|---|---|---|---|
| `redeem` | `POST /api/access-keys/redeem` | 30 / 1 min | 10 / 1 min | **10 / 10 min** |
| `review-write` | `POST /api/rooms/:roomId/reviews`, tRPC `reviews.upsert` (mismo cubo) | 20 / 10 min | 5 / 10 min | — |
| `invitation-confirm` | `POST /api/access-keys/:code/confirm` (público, enlace del email) | 20 / 10 min | — | 10 / 10 min |
| `invitation-resend` | `POST /api/access-keys/:code/resend` | 60 / 10 min | 30 / 10 min | — |
| `invitation-resend-pending` | `POST /api/events/:id/invitations/resend` (recordatorio masivo) | 10 / 1 h | 5 / 1 h | — |

Razonamiento de los números:

- **Canje.** El código tiene 12 caracteres de un alfabeto de 31 (≈ 59 bits): con 10 fallos cada
  10 minutos por IP, adivinar uno al azar es inviable. Los 30/min por IP dejan canjear a la vez a una
  clase de 30 detrás de una sola IP; los 10/min por usuario cortan a quien automatiza con sesión.
- **Reseñas.** Una persona escribe o edita pocas reseñas; 5 cada 10 minutos por usuario sobra.
- **Confirmación.** El token va firmado (HMAC); la cuota de fallos frena el tanteo de tokens.
- **Reenvíos.** Cada uno encola emails reales (coste y reputación del dominio): el masivo es el más
  estricto.

**Fuera de este limitador**, a propósito:

- **MCP**: el ticket 4.7 aplica su propio límite por token; no se duplica.
- **`POST /api/webhooks/stripe`**: specs/13 §11 pide limitarlo por firma válida, no por IP; aún no
  existe la ruta (la verificación de firma ya descarta lo ajeno).
- **`/api/auth/*`** (Better Auth 1.7): trae su propio rate limit, encendido en producción (100 peticiones / 10 s y reglas más duras en el login), pero **en memoria por proceso**. Llevarlo a Redis (`secondaryStorage`) queda como mejora.
- **`POST /api/analytics/collect`**: pertenece al ticket 6.11.

**Interruptor.** `RATE_LIMIT_ENABLED=false` lo apaga (pruebas de carga del 6.5). Encendido por
defecto en todos los entornos.

## 2. Límite por mensaje en la partida (Colyseus)

`GameRoom` —y por herencia `event` y `playtest`— pasa cada mensaje por `MessageRateLimiter` antes del
handler. El estado es en memoria **por room y por jugador** (`sessionId`): quien inunda solo gasta su
cuota; los demás jugadores de la partida no lo notan. No hace falta Redis: una partida vive en un
proceso. Ventana deslizante de 1 s, la misma lógica que el chat (`checkChatRateLimit` de `shared`).

| Mensaje | Límite | Origen |
|---|---|---|
| `move` | 10/s | specs/11 §9 (el salto máximo de 3 celdas se valida aparte) |
| `interact` | 4/s | specs/11 §9 |
| `puzzle_attempt` | 2/s **por puzzle** | specs/11 §9 (+ lockout propio de cada plantilla) |
| `combine` | 3/s | specs/11 §9 |
| `chat` | 2/s | specs/11 §9; lo aplica `RoomChat` (ticket 2.1), con su propio error |
| `use_item`, `puzzle_open`, `puzzle_close`, `split_view` | 4/s | no está en la spec: como `interact` |
| `plate_state` | 10/s | no está en la spec: como `move` (se pisa caminando) |
| `hint_request`, `start_game`, `request_media_token` | 2/s | no está en la spec: acciones puntuales |
| Cualquier mensaje | 30/s por jugador | tope total, incluye chat y medios |

Un mensaje que excede su cuota **se descarta** (no llega al motor) y el emisor recibe **un**
`error { code: "RATE_LIMITED", message, retryAfterMs, messageType }` por tipo de mensaje y ventana:
al que inunda no se le inunda de errores. El cliente web vuelve a colocar el avatar en la posición
autoritativa si el descartado es un `move`, muestra el aviso del chat si es `chat` y, en el resto,
una línea en el registro de la partida («Vas demasiado rápido…», en los 6 idiomas).

**Observadores (ticket 5.9).** En la room `event`, el observador de solo lectura se rechaza con
`PERMISSION_DENIED` **antes** del rate limit (`canAct` va primero en el envoltorio de mensajes): sus
mensajes no llegan al limitador, así que no registran nada ni tocan la cuota de ningún jugador (las
cuotas son por `sessionId`). Los jugadores de la misma room se limitan igual que en cualquier partida.

`GAME_MESSAGE_RATE_LIMIT=off` lo apaga. Solo lo usa el E2E de protocolo del ticket 2.12, cuyos
clientes-máquina encadenan intentos sin cadencia humana; el resto de tests lo corren encendido.

## 3. CSP y cabeceras de seguridad

**CSP de páginas** (`src/proxy.ts`, por petición): nonce aleatorio de 128 bits que Next pone en sus
`<script>`. Por eso el layout `[locale]` se renderiza **dinámico** (`connection()`): una página
prerenderizada en el build saldría sin nonce y la CSP bloquearía su JavaScript.

```
default-src 'self';
script-src 'self' 'nonce-…' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: <storage>;
font-src 'self' data:;
media-src 'self' data: blob: <storage>;
connect-src 'self' <colyseus ws+http> <editor-sync ws+http> <livekit wss+https> <storage> <CSP_EXTRA_CONNECT_SRC>;
worker-src 'self' blob:;
frame-src 'none'; object-src 'none'; base-uri 'self';
form-action 'self' https://accounts.google.com;
frame-ancestors 'none';
upgrade-insecure-requests
```

Excepciones a `'self'` y su motivo:

| Directiva | Excepción | Por qué |
|---|---|---|
| `script-src` | `'strict-dynamic'` | Los chunks que carga Next en cliente (Phaser con `next/dynamic`, el editor, LiveKit) heredan la confianza del script con nonce. Sin `'unsafe-inline'` ni `'unsafe-eval'` (salvo `'unsafe-eval'` en `next dev`, que React usa para sus trazas). |
| `style-src` | `'unsafe-inline'` | Atributos `style` de React (paneles de puzzle, React Flow del editor) y el CSS de `next/font`. No ejecuta código. |
| `img-src`, `media-src` | `data:`, `blob:`, bucket | Texturas base64 por defecto de Phaser, vistas previas generadas en cliente y URLs firmadas del bucket (`STORAGE_ENDPOINT`). |
| `connect-src` | Colyseus, editor-sync, LiveKit, bucket | `NEXT_PUBLIC_COLYSEUS_URL` (matchmaking HTTP + WebSocket), `NEXT_PUBLIC_EDITOR_SYNC_URL` (Yjs), `NEXT_PUBLIC_LIVEKIT_URL`/`LIVEKIT_URL` (señalización; con LiveKit Cloud, `*.livekit.cloud` por los hosts regionales). Sin variables, los `localhost` de desarrollo. `CSP_EXTRA_CONNECT_SRC` añade orígenes sin tocar código. |
| `worker-src` | `blob:` | Worker de cifrado E2EE de LiveKit. |
| `form-action` | `accounts.google.com` | Redirección del login con Google (OAuth). |

La redirección de locale (`/` → `/es`) también lleva la CSP. El JSON-LD de la ficha de sala es un
bloque de datos (`type="application/ld+json"`), no script ejecutable: la CSP no lo bloquea.

**CSP de la API** (`/api/*`, `next.config.ts`): `default-src 'none'; frame-ancestors 'none'`.

**Cabeceras fijas** (todas las respuestas, `next.config.ts`):

| Cabecera | Valor |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` (redundante con `frame-ancestors`, para navegadores viejos) |
| `Permissions-Policy` | `camera=(self), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (solo en producción) |

Además, `poweredByHeader: false` (sin `X-Powered-By: Next.js`).

## 4. Auditoría de endpoints de administración

`packages/web/test/admin-audit.test.ts` recorre **todas** las rutas bajo `src/app/api/admin/` (sin
lista a mano: una ruta nueva entra sola en la auditoría) e invoca cada método HTTP que exporta su
`route.ts` con cuerpos vacíos e inválidos. Comprueba que:

- sin sesión, todo responde **401**;
- con sesión sin `isAdmin` (aunque sea `owner` de una organización), todo responde **403**;
- el moderador solo entra en la moderación de audio (`/api/admin/audio*`); ajustes y precios, 403;
- de control, el admin sí pasa la autorización (el test cazaría un 403 fijo).

El «quién hizo qué» de specs/13 §11 queda en los propios datos: `platformSetting.updatedBy`,
`pricingTier.createdBy` (versionado, nunca se sobrescribe) y la revisión de audio con su revisor.
