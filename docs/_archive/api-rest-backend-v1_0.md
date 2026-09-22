# API REST del backend

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§3, §10, §12), `esquema-sql-migraciones-v1.0.md` y `protocolo-mensajes-colyseus.md`.

Este documento fija los endpoints concretos del backend Next.js: auth, catálogo, edición/publicación de salas, compras, eventos y claves, generación de PDF y el webhook de Stripe. Con esto se puede empezar a programar el backend, el frontend y el MCP contra un contrato estable, sin preguntas pendientes. **No cubre** el protocolo de partida en vivo (movimiento, puzzles, chat): eso va por WebSocket de Colyseus y está en `protocolo-mensajes-colyseus.md`. La API REST y Colyseus comparten la misma base de datos pero son procesos distintos.

---

## 1. Convenciones generales

- **Base URL:** `/api/*` (rutas de Next.js, App Router — `route.ts` por recurso).
- **Formato:** JSON en request y response. `Content-Type: application/json` salvo subida de assets (multipart) y export de PDF (responde binario o URL firmada, ver §9).
- **Auth:** Auth.js (NextAuth) con sesión por cookie httpOnly para el frontend web. El MCP y clientes externos usan **Bearer token** (OAuth, ver `especificaciones-escape-room-creator-v1.0.md` §11) contra las mismas rutas — no hay una API separada para el MCP.
- **Errores:** siempre `{ "error": { "code": "STRING_CODE", "message": "texto legible" } }` con el HTTP status correspondiente (400/401/403/404/409/422/429/500). Los códigos de negocio (`ROOM_NOT_PUBLISHED`, `ACCESS_KEY_EXPIRED`...) se listan por recurso más abajo; nunca se filtra un stack trace.
- **Paginación:** cursor-based en listados (`?cursor=...&limit=20`), respuesta `{ items: [...], nextCursor: string | null }`. Se evita `offset` porque el catálogo y los listados de claves crecen y mutan en caliente.
- **Idempotencia:** todo POST que crea un recurso con efecto económico (checkout, generación de claves en lote) acepta cabecera `Idempotency-Key`; se persiste la respuesta 24 h para reintentos seguros del cliente.
- **Versionado:** sin prefijo `/v1/` — el contrato evoluciona de forma aditiva (nuevos campos opcionales); un cambio incompatible se anuncia aparte y se decide entonces si hace falta versionar.
- **Autorización:** además de "autenticado sí/no", cada tabla de endpoints indica **quién** puede llamarlo (propietario del recurso, admin, público...). Se aplica siempre en el handler, nunca solo en el cliente.

---

## 2. Autenticación y perfil

Auth.js gestiona `/api/auth/*` (signin, callback OAuth, signout, session) de forma estándar — no se documentan aquí. Rutas propias encima de la sesión:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/me` | usuario | Perfil completo: datos de `users`, saldo de `credit_accounts` (personal + de cada organización), lista de `organizations` donde es miembro |
| PATCH | `/api/me` | usuario | Actualiza `display_name`, `avatar_url`, `locale` |
| POST | `/api/me/stripe-connect` | usuario | Inicia onboarding de Stripe Connect (creador que aún no puede cobrar); devuelve URL de onboarding hospedado por Stripe |
| GET | `/api/me/stripe-connect/status` | usuario | Estado del onboarding (`not_started \| pending \| complete`) |
| GET | `/api/me/purchases` | usuario | Historial paginado de `purchases` propias |
| GET | `/api/me/rooms` | usuario | Todas sus salas (`rooms`), incluidos drafts — para el dashboard del creador |
| POST | `/api/organizations` | usuario | Crea una organización (el creador pasa a `owner`) |
| POST | `/api/organizations/:orgId/members` | owner/admin de la org | Invita a un miembro por email |

---

## 3. Catálogo (público)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/rooms` | público | Listado paginado de salas `published`. Filtros: `q` (búsqueda por título, `pg_trgm`), `difficulty`, `language`, `minPrice`, `maxPrice`, `players` (capacidad compatible); `sort=recent\|rating\|price_asc\|price_desc` |
| GET | `/api/rooms/:roomId` | público | Detalle de catálogo: metadata de la última `room_version` publicada (título, descripción, dificultad, duración estimada, capacidad, precio, rating agregado) — **nunca** el `package` completo (eso expondría soluciones) |
| GET | `/api/rooms/:roomId/versions` | público | Histórico de versiones publicadas, solo metadata (`semver`, `changelog`, `published_at`) |
| GET | `/api/rooms/:roomId/reviews` | público | Listado paginado de `reviews` |
| POST | `/api/rooms/:roomId/reviews` | usuario que compró o jugó la sala | Crea/actualiza su reseña (`UNIQUE(user_id, room_id)` de la BD hace el upsert natural) |
| POST | `/api/rooms/:roomId/report` | usuario | Crea `content_reports` (código `REPORT_REASON_REQUIRED` si falta motivo) |

`GET /api/rooms/:roomId` — forma de respuesta orientativa:

```json
{
  "id": "uuid",
  "title": "La Maldición del Rey Aldric",
  "authorDisplayName": "...",
  "description": "...",
  "difficulty": 2,
  "estimatedMinutes": 60,
  "players": { "min": 1, "max": 4 },
  "priceCents": 299,
  "currency": "EUR",
  "saleIndividual": true,
  "saleEvents": true,
  "ratingAvg": 4.6,
  "ratingCount": 128,
  "latestVersion": { "id": "uuid", "semver": "1.0.0", "publishedAt": "..." }
}
```

---

## 4. Gestión y publicación de salas (creador)

La edición en vivo del contenido (pintar tiles, colocar objetos, grafo de reglas) **no pasa por estos endpoints**: va por el canal de sincronización Yjs (WebSocket propio del backend de edición, análogo pero distinto al de Colyseus — persiste incrementalmente en `room_updates`, ver `esquema-sql-migraciones-v1.0.md` §5). Estos endpoints REST cubren el ciclo de vida alrededor de esa edición:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/rooms` | usuario | Crea sala nueva: `{ title, theme? }` → fila en `rooms` (status `draft`) + doc Yjs vacío (a partir de la plantilla de tema si se indica) |
| PATCH | `/api/rooms/:roomId` | autor | Metadata: `title`, `priceCents`, `saleIndividual`, `saleEvents`, o `status: 'archived'` |
| DELETE | `/api/rooms/:roomId` | autor | Borrado lógico (`deleted_at`); una sala con `purchases` o `reviews` no se borra físicamente nunca |
| GET | `/api/rooms/:roomId/draft` | autor o colaborador | Bootstrap del editor: último `room_snapshots` + `room_updates` posteriores, para que el cliente reconstruya el doc Yjs antes de conectar al WebSocket de edición |
| POST | `/api/rooms/:roomId/validate` | autor (o MCP en su nombre) | Corre el validador automático (§10.3 de especificaciones) sobre el draft actual: objetos huérfanos, dead ends, puzzles sin pista, estimación de ruta y duración. Devuelve `{ valid: boolean, errors: [...], warnings: [...], estimatedMinutes, estimatedDifficulty }` |
| POST | `/api/rooms/:roomId/publish` | autor | `{ semver, changelog }`. Exige `validate` en verde (se repite server-side, nunca se confía en un resultado cacheado del cliente). Empaqueta el draft en un `RoomPackage`, sube assets referenciados a R2, calcula `assetsHash`, inserta `room_versions`. Código `VALIDATION_FAILED` si no pasa |
| GET | `/api/rooms/:roomId/versions/:versionId/package` | autor, admin, o servicio interno (Colyseus/MCP con service token) | El `RoomPackage` JSONB completo — la única ruta que lo expone, y nunca al público general |

---

## 5. Compras (venta individual de salas)

Checkout con **Stripe Checkout** hospedado (no se gestionan tarjetas directamente).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/purchases/room-checkout` | usuario | `{ roomVersionId }` → valida `saleIndividual = true` y precio vigente, crea `purchases` (`status: pending`) + Stripe Checkout Session con `metadata.purchaseId`. Devuelve `{ checkoutUrl }` |
| GET | `/api/purchases/:id` | comprador o admin | Estado de una compra (para la pantalla de retorno tras el pago) |
| GET | `/api/rooms/:roomId/access` | usuario | `{ owned: boolean }` — si el usuario ya compró la sala (o es el autor), para decidir si el botón del catálogo es "Jugar" o "Comprar" |

El reparto 70/30 y el `stripe_transfer_id` del creador se resuelven en el webhook (§7), no en la creación del checkout.

---

## 6. Eventos y claves de acceso

### 6.1 Ciclo de vida del evento

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events` | usuario | `{ roomVersionId, title, maxSimultaneousSessions, groupingMode, requireConfirmation, expiryRules, playersPlanned }` → valida `saleEvents = true`, calcula `pricingSnapshot` según la tabla de tramos vigente (§3.2 de especificaciones) y el total a pagar. Si `organizerId === room.authorId`, las claves son gratis (no se paga a sí mismo) y el evento pasa directo a poder activarse sin checkout |
| PATCH | `/api/events/:id` | organizador | Edita config mientras `status = draft` |
| GET | `/api/events/:id` | organizador o admin | Detalle + resumen agregado (nº sesiones, nº claves por estado) |
| GET | `/api/me/events` | usuario | Sus eventos como organizador |
| POST | `/api/events/:id/checkout` | organizador | Crea Checkout Session por el total calculado (si no es autoventa gratuita) |
| POST | `/api/events/:id/activate` | servicio interno (llamado por el webhook tras pago, o directo si autoventa gratuita) | Pasa `status: draft → active`; a partir de aquí se pueden generar sesiones y claves |

### 6.2 Sesiones, grupos y claves

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events/:id/sessions` | organizador | Crea una o varias sesiones (`{ name, capacity }[]`), hasta `maxSimultaneousSessions` |
| POST | `/api/events/:id/sessions/:sessionId/groups` | organizador | Crea grupo dentro de una sesión |
| POST | `/api/events/:id/access-keys` | organizador | Generación en lote: `{ type: 'individual'\|'rotating'\|'group'\|'batch', count, sessionId?, groupAssignment: 'specific'\|'random'\|'free', emails?: string[] }`. Aplica `groupingMode` del evento; con `emails` dispara el envío de invitación (Resend/Postmark) |
| GET | `/api/events/:id/access-keys` | organizador | Listado paginado con estado — alimenta el panel del organizador (§3.5) |
| POST | `/api/access-keys/:code/resend` | organizador | Reenvía el email de invitación |
| POST | `/api/access-keys/:code/regenerate` | organizador | Solo `type = rotating`: invalida la clave actual (`status: expired`) y crea una nueva con `regenerated_from` apuntando a la anterior |
| POST | `/api/access-keys/:code/confirm` | público (enlace del email, sin sesión de cuenta) | El asistente confirma su invitación → `status: pending_confirmation → confirmed` |
| POST | `/api/access-keys/redeem` | público (jugador invitado, puede no tener cuenta) | `{ code }` → valida estado y caducidad, marca `used`/`active` según `single_use`, y devuelve el token de unión a la partida: `{ sessionId, colyseusEndpoint, joinToken }`. `joinToken` es un JWT corto (no la clave en claro) que el cliente presenta al hacer `join` en Colyseus (ver `protocolo-mensajes-colyseus.md` §8) |
| GET | `/api/events/:id/dashboard` | organizador | Resumen en vivo para el panel: estado de cada sesión, progreso por grupo (de `progress_events`), ranking. Complementa —no sustituye— la `SpectatorRoom` de Colyseus para lo estrictamente en vivo |

**Códigos de error propios de claves:** `ACCESS_KEY_INVALID`, `ACCESS_KEY_USED`, `ACCESS_KEY_EXPIRED`, `ACCESS_KEY_NOT_CONFIRMED` (si `requireConfirmation = true` y aún no confirmó), `SESSION_FULL` — los mismos códigos que usa el `join` de Colyseus (§7 de `protocolo-mensajes-colyseus.md`), porque `redeem` es el paso previo inmediato al `join`.

---

## 7. Webhook de Stripe

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/webhooks/stripe` | firma Stripe (`Stripe-Signature`, sin sesión) | Único punto de entrada de eventos de Stripe |

Eventos manejados:

| Evento Stripe | Efecto |
|---|---|
| `checkout.session.completed` | Recupera `purchaseId` de `metadata`. Si `purchase_type = room`: marca `purchases.status = succeeded`, concede acceso, dispara `stripe_transfer_id` (70 % al `stripe_account_id` del creador vía Connect). Si `purchase_type = event_credits`: marca succeeded y llama internamente a `activate` del evento (§6.1) |
| `payment_intent.payment_failed` | `purchases.status = failed` |
| `charge.refunded` | `purchases.status = refunded`; si era una sala, revoca el acceso; si era un evento activo, **no** revoca claves ya canjeadas (jugado es jugado), pero bloquea nuevas activaciones |
| `account.updated` | Actualiza el estado de onboarding de Stripe Connect del creador (`GET /api/me/stripe-connect/status`) |

**Idempotencia y seguridad:**
- Verificación de firma con `STRIPE_WEBHOOK_SECRET` antes de procesar nada.
- Tabla de apoyo (adenda menor al esquema del punto 3) `stripe_webhook_events (id text primary key, type text, received_at timestamptz)` — `id` es el `event.id` de Stripe; si ya existe, se responde 200 sin reprocesar. Stripe reintenta el mismo evento varias veces y no hay garantía de entrega única, así que la idempotencia se hace aquí, no confiando solo en el estado de `purchases`.
- Respuesta 200 rápida (<5 s); el trabajo pesado (transfer a Connect, generación de claves) se delega a una cola (mismo mecanismo Redis que la analítica) para no bloquear el webhook ni arriesgar reintentos duplicados de Stripe por timeout.

---

## 8. Sesiones y progreso (lectura, complemento del panel)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/sessions/:id` | organizador, jugadores de esa sesión, admin | Estado persistido de la sesión (complementa, no sustituye, el estado en vivo de Colyseus) |
| GET | `/api/sessions/:id/progress` | organizador, admin | `progress_events` de la sesión — puzzles resueltos, tiempos, pistas usadas por grupo |

---

## 9. Generación de PDF de tarjetas-clave

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events/:id/access-keys/export-pdf` | organizador | `{ codes?: string[] }` (omitir = todas las del evento). Si el volumen es bajo (<50 tarjetas) genera y devuelve el PDF directo (`@react-pdf/renderer`, streaming); si es mayor, encola un job y responde `{ jobId }` |
| GET | `/api/exports/:jobId` | organizador | Estado del job async: `{ status: 'processing'\|'ready'\|'failed', downloadUrl? }` (URL firmada de R2, expira en 24 h) |

---

## 10. Moderación (admin/moderador)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/admin/reports` | `is_admin \| is_moderator` | Listado paginado de `content_reports`, filtrable por `status` |
| PATCH | `/api/admin/reports/:id` | `is_admin \| is_moderator` | `{ status, resolutionNote? }`; si `status = actioned` puede acompañarse de despublicar la sala (`PATCH /api/rooms/:roomId { status: 'removed' }` internamente) |

El detalle del pipeline (qué se revisa automático, tiempos, escalado, strikes) es el punto 8 pendiente; estos dos endpoints son el mínimo que ya se puede construir sin esperar a esa especificación.

---

## 11. Rate limiting y seguridad

- Redis (ticket 6.2 del roadmap) para rate limiting por IP + ruta; límites más estrictos en rutas públicas sensibles: `POST /api/access-keys/redeem` (fuerza bruta de códigos), `POST /api/rooms/:roomId/reviews`, `POST /api/webhooks/stripe` (excepción: se limita por firma válida, no por IP, para no bloquear a Stripe).
- CSP estricta en el frontend Next.js; ninguna ruta REST devuelve nunca soluciones/pesos/melodías (eso es exclusivo del protocolo de Colyseus ya filtrado en su GameState, §3 de `protocolo-mensajes-colyseus.md`) — la API REST ni siquiera tiene una ruta que exponga puzzles individuales fuera del `package` completo restringido a autor/admin/servicio.
- Auditoría de endpoints administrativos (`/api/admin/*`): log de quién hizo qué, con `created_by` donde aplique (mismo patrón que `credit_movements.created_by`).

---

## 12. Relación con el MCP (§11 de especificaciones)

El MCP **no** tiene una API paralela: sus tools (`create_room`, `add_object`, `publish`...) son wrappers finos sobre estas mismas rutas REST (gestión de salas §4) más el WebSocket de edición Yjs, autenticados con el Bearer token OAuth del creador. Esto es deliberado — es la garantía de que "todo lo que el editor visual puede hacer, el MCP puede hacerlo" sin mantener dos superficies de API sincronizadas a mano.
