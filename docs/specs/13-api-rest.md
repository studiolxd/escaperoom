# 13 — API REST del backend

Depende de `02-modelo-de-negocio.md`, `14-modelo-de-datos-sql.md` y `11-protocolo-multijugador.md`.
Fija los endpoints concretos del backend Next.js. **No cubre** el protocolo de partida en vivo
(eso va por WebSocket de Colyseus). La API REST y Colyseus comparten base de datos pero son
procesos distintos.

---

> **Tres puertas, una sola lógica (ADR-022).** La UI de web y editor usa **tRPC**; esta spec describe
> la **superficie REST** — catálogo anónimo, checkout, eventos/claves, webhooks y admin — que es
> también la base de la **API pública para terceros**; el **MCP** no pasa por aquí: llama a los
> mismos **servicios de dominio** (`packages/shared/services`). Las tres puertas invocan esa capa
> única; ningún handler, procedure ni tool reimplementa lógica. Los endpoints marcados `usuario`/
> `autor` son candidatos a servirse por tRPC en la UI; en REST se conservan los que la API pública o
> los flujos anónimos necesitan.

## 1. Convenciones generales

- **Base URL:** `/api/*` (rutas de Next.js, App Router — `route.ts` por recurso).
- **Formato:** JSON en request y response, salvo subida de assets (multipart) y export de PDF
  (binario o URL firmada, §9).
- **Auth:** Better Auth con sesión por cookie httpOnly para la UI. El MCP usa **OAuth 2.1** contra sus
  propias tools (`/mcp/creator`, ADR-010); los clientes externos usan **Bearer/API key** contra esta
  superficie REST.
- **Errores:** siempre `{ "error": { "code": "STRING_CODE", "message": "texto legible" } }` con el
  HTTP status correspondiente (400/401/403/404/409/422/429/500). Nunca se filtra un stack trace.
- **Paginación:** cursor-based (`?cursor=...&limit=20`), respuesta
  `{ items: [...], nextCursor: string | null }`.
- **Idempotencia:** todo POST con efecto económico (checkout, generación de claves en lote) acepta
  cabecera `Idempotency-Key`; se persiste la respuesta 24 h.
- **Versionado:** sin prefijo `/v1/`; el contrato evoluciona de forma aditiva.
- **Autorización:** se aplica siempre en el handler, nunca solo en el cliente.

## 2. Autenticación y perfil

Better Auth gestiona `/api/auth/*` (signin, callback OAuth, signout, session; plugin de organización). Rutas propias:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/me` | usuario | Perfil: `user`, saldo de `creditAccount` (personal + cada org), organizaciones |
| PATCH | `/api/me` | usuario | Actualiza `name`, `image`, `locale` |
| POST | `/api/me/stripe-connect` | usuario | Inicia onboarding de Stripe Connect; devuelve URL hospedada |
| GET | `/api/me/stripe-connect/status` | usuario | `not_started \| pending \| complete` |
| GET | `/api/me/purchases` | usuario | Historial paginado de `purchase` propias |
| GET | `/api/me/rooms` | usuario | Todas sus salas (incluidos drafts) |
| GET | `/api/me/events` | usuario | Sus eventos como organizador |
| POST | `/api/organizations` | usuario | Crea organización (el creador pasa a `owner`) |
| POST | `/api/organizations/:orgId/members` | owner/admin | Invita a un miembro por email |
| GET | `/api/me/data-export` | usuario | Export completo de datos (portabilidad RGPD) |
| DELETE | `/api/me` | usuario | Cierre de cuenta y anonimización según plazos |
| POST | `/api/organizations/:id/dpa/sign` | owner/admin | Aceptación del DPA antes de habilitar claves individuales con email |

## 3. Catálogo (público)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/rooms` | público | Listado paginado de salas `published`. Filtros: `q` (título, `pg_trgm`), `difficulty`, `language` (la sala **incluye** el idioma), `minPrice`, `maxPrice`, `players`; `sort=recent\|rating\|price_asc\|price_desc` |
| GET | `/api/rooms/:roomId` | público | Detalle de catálogo (metadata de la última versión publicada) — **nunca** el `package` completo |
| GET | `/api/rooms/:roomId/versions` | público | Histórico de versiones (solo metadata `semver`, `changelog`, `published_at`) |
| GET | `/api/rooms/:roomId/reviews` | público | Listado paginado de reseñas |
| POST | `/api/rooms/:roomId/reviews` | comprador/jugador | Crea/actualiza su reseña (`UNIQUE(user_id, room_id)`) |
| POST | `/api/rooms/:roomId/report` | usuario | Crea `contentReport` (`REPORT_REASON_REQUIRED` si falta motivo) |

Forma de respuesta de `GET /api/rooms/:roomId`:

```json
{
  "id": "uuid",
  "title": "La Maldición del Rey Aldric",
  "authorDisplayName": "...",
  "description": "...",
  "difficulty": 2,
  "estimatedMinutes": 55,
  "players": { "min": 1, "max": 4 },
  "languages": ["es"],
  "priceCents": 299,
  "currency": "EUR",
  "saleIndividual": true,
  "saleEvents": true,
  "licensePriceCents": null,
  "ratingAvg": 4.6,
  "ratingCount": 128,
  "latestVersion": { "id": "uuid", "semver": "1.0.0", "publishedAt": "..." }
}
```

## 4. Gestión y publicación de salas (creador)

La edición en vivo del contenido (pintar tiles, colocar objetos, grafo de reglas) **no pasa por
estos endpoints**: va por el canal de sincronización Yjs. Estos endpoints cubren el ciclo de vida
alrededor de la edición:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/rooms` | usuario | Crea sala: `{ title, theme? }` → fila `room` (`draft`) + doc Yjs vacío |
| PATCH | `/api/rooms/:roomId` | autor | Metadata: `title`, `priceCents`, `saleIndividual`, `saleEvents`, `licensable`, `licensePriceCents`, o `status: 'archived'` |
| DELETE | `/api/rooms/:roomId` | autor | Borrado lógico (`deleted_at`); con `purchase`/`review` nunca se borra físicamente |
| GET | `/api/rooms/:roomId/draft` | autor/colaborador | Bootstrap del editor: último snapshot + updates posteriores |
| POST | `/api/rooms/:roomId/validate` | autor (o MCP) | Corre el validador sobre el draft: `{ valid, errors, warnings, estimatedMinutes, estimatedDifficulty }` |
| POST | `/api/rooms/:roomId/publish` | autor | `{ semver, changelog }`. Exige `validate` en verde (repetido server-side). Empaqueta, sube assets a R2, calcula `assetsHash`, inserta `roomVersion`. `VALIDATION_FAILED` si no pasa |
| GET | `/api/rooms/:roomId/versions/:versionId/package` | autor, admin o servicio interno | El `RoomPackage` completo — única ruta que lo expone, nunca al público |
| POST | `/api/rooms/:roomId/license-checkout` | creador | Compra la licencia de la sala de otro → Stripe Checkout, `purchase_type: 'room_license'` |
| POST | `/api/rooms/:roomId/gift-copy` | autor | Envía copia gratuita a otro creador (`{ recipientEmail }`) — sin Stripe, fork inmediato |
| GET | `/api/rooms/:roomId/access` | usuario | `{ owned, playable }` — `playable: false` si ya se consumió la única partida (B2C) |

### 4.1 Audio del creador (ticket 3.11)

Biblioteca incluida + subida propia de MP3 con **moderación previa** (`specs/15` §1, `specs/17` §1).
En el borrador, `LocalizedText.audioUrl` y los efectos (`play_sound`) guardan una referencia estable
(`library:<trackId>` o `upload:<uuid>`), no una URL firmada; la publicación la resuelve a R2.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/audio/library` | público | Biblioteca incluida (`?kind=music\|sfx\|voice`), con licencia, créditos y `ref` |
| GET | `/api/audio/uploads` | usuario | Subidas propias con `status` (`pending`/`approved`/`rejected`) y `rejectionReason` |
| POST | `/api/audio/uploads` | usuario | Multipart: `file` (MP3) + `rightsDeclared=true`. Valida el contenido real, tamaño y duración → 201 `pending`. `415 UNSUPPORTED_MEDIA_TYPE`, `413 PAYLOAD_TOO_LARGE`, `422 VALIDATION_ERROR`/`UPLOAD_BLOCKED` |
| GET | `/api/audio/uploads/:id` | dueño o moderador | Metadatos + `previewUrl` firmada (nula si está rechazado); 404 para cualquier otro usuario |

Un audio subido solo lo puede usar su dueño; `pending` sirve en el borrador pero bloquea
publicar (`AUDIO_PENDING_MODERATION`) y `rejected` no es usable (`AUDIO_REJECTED`, con motivo).

## 5. Compras (venta individual de salas)

Checkout con **Stripe Checkout** hospedado (no se gestionan tarjetas directamente).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/purchases/room-checkout` | usuario | `{ roomVersionId }` → valida `saleIndividual` y precio, crea `purchase` (`pending`) + Checkout Session con `metadata.purchaseId`. Devuelve `{ checkoutUrl }` |
| GET | `/api/purchases/:id` | comprador o admin | Estado de una compra |

El reparto 70/30 y el `stripeTransferId` se resuelven en el webhook (§7), no en la creación.

## 6. Eventos y claves de acceso

### 6.1 Ciclo de vida del evento

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events` | usuario | `{ roomVersionId, title, maxSimultaneousSessions, groupingMode, requireConfirmation, expiryRules, playersPlanned, audience?, allowVideo?, recordingEnabled? }` → valida `saleEvents`, calcula `pricingSnapshot` desde `pricingTier` y el total. Si `organizerId === room.authorId`, claves gratis y activable sin checkout |
| PATCH | `/api/events/:id` | organizador | Edita config mientras `status = draft` |
| GET | `/api/events/:id` | organizador o admin | Detalle + resumen (nº sesiones, nº claves por estado) |
| POST | `/api/events/:id/checkout` | organizador | Checkout por el total (si no es autoventa gratuita) |
| POST | `/api/events/:id/activate` | servicio interno / webhook | `draft → active`; a partir de aquí se generan sesiones y claves |

### 6.2 Sesiones, grupos y claves

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events/:id/sessions` | organizador | Crea una o varias sesiones (`{ name, capacity }[]`), hasta `maxSimultaneousSessions` |
| POST | `/api/events/:id/sessions/:sessionId/groups` | organizador | Crea grupo dentro de una sesión |
| POST | `/api/events/:id/access-keys` | organizador | Generación en lote: `{ type, count, sessionId?, groupAssignment, emails? }`. Aplica `groupingMode`; con `emails` dispara el envío (Resend/Postmark) |
| GET | `/api/events/:id/access-keys` | organizador | Listado paginado con estado — alimenta el panel |
| POST | `/api/access-keys/:code/resend` | organizador | Reenvía el email de invitación |
| POST | `/api/access-keys/:code/regenerate` | organizador | Solo `type = rotating`: invalida la actual y crea nueva con `regeneratedFrom` |
| POST | `/api/access-keys/:code/confirm` | público (enlace del email) | `pending_confirmation → confirmed` |
| POST | `/api/access-keys/redeem` | público (puede no tener cuenta) | `{ code }` → valida estado y caducidad, marca `used`/`active`, devuelve `{ sessionId, colyseusEndpoint, joinToken }` (`joinToken` = JWT corto, no la clave en claro) |
| GET | `/api/events/:id/dashboard` | organizador | Resumen en vivo: estado de cada sesión, progreso por grupo (`progressEvent`), ranking |

**Códigos de error de claves:** `ACCESS_KEY_INVALID`, `ACCESS_KEY_USED`, `ACCESS_KEY_EXPIRED`,
`ACCESS_KEY_NOT_CONFIRMED` (si `requireConfirmation = true` y aún no confirmó), `SESSION_FULL` —
los mismos que usa el `join` de Colyseus, porque `redeem` es el paso previo inmediato.

**Canje (ticket 5.8).** Cuerpo `{ code, displayName?, sessionId?, groupId? }`: `sessionId`/`groupId`
solo cuentan en `groupingMode: free` (el asistente elige); sin `sessionId` en `free` responde
422 `SESSION_REQUIRED` con `sessions: [{ id, name, capacity, available }]` elegibles. Respuesta
`{ eventId, sessionId, groupId, colyseusEndpoint, roomName: "event", joinToken, expiresAt, player }`.
El invitado sin cuenta recibe una identidad efímera `guest:<uuid>` que solo vive en el `joinToken`
(JWT HS256, `JOIN_TOKEN_SECRET` compartido con Colyseus, 15 min por defecto). La room `event` de
Colyseus rechaza el `join` sin token válido, caducado o de otra sesión (`JOIN_TOKEN_*`).

### 6.3 Grabaciones

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| DELETE | `/api/events/:id/recordings/:recordingId` | owner/admin de la org | Solicita borrado anticipado |
| GET | `/api/events/:id/recordings/:recordingId/download` | owner/admin de la org | URL firmada (24 h) |

## 7. Webhook de Stripe

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/webhooks/stripe` | firma Stripe (`Stripe-Signature`, sin sesión) | Único punto de entrada de eventos de Stripe |

| Evento Stripe | Efecto |
|---|---|
| `checkout.session.completed` | Recupera `purchaseId` de `metadata`. Si `purchase_type = room`: `purchases.status = succeeded`, concede acceso, dispara `stripeTransferId` (70 % al creador vía Connect). Si `room_license`: crea el fork → `resulting_room_id`. Si `event_credits`: succeeded y llama a `activate` del evento |
| `payment_intent.payment_failed` | `purchases.status = failed` |
| `charge.refunded` | `purchases.status = refunded`; si era sala, revoca acceso; si era evento activo, **no** revoca claves ya canjeadas (jugado es jugado) pero bloquea nuevas activaciones |
| `account.updated` | Actualiza el estado de onboarding de Stripe Connect |

**Idempotencia y seguridad:**
- Verificación de firma con `STRIPE_WEBHOOK_SECRET` antes de procesar.
- Tabla de apoyo `stripe_webhook_events (id text primary key, type text, received_at timestamptz)`:
  `id` = `event.id` de Stripe; si ya existe, 200 sin reprocesar (Stripe reintenta y no garantiza
  entrega única).
- Respuesta 200 rápida (<5 s); el trabajo pesado se delega a una cola Redis.

## 8. Sesiones y progreso (lectura)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/sessions/:id` | organizador, jugadores de la sesión, admin | Estado persistido de la sesión |
| GET | `/api/sessions/:id/progress` | organizador, admin | `progressEvent`: puzzles resueltos, tiempos, pistas por grupo |

## 9. Generación de PDF de tarjetas-clave

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events/:id/access-keys/export-pdf` | organizador | `{ codes?: string[] }` (omitir = todas). <50 tarjetas: PDF directo (`@react-pdf/renderer`); mayor: job async → `{ jobId }` |
| GET | `/api/exports/:jobId` | organizador | `{ status, downloadUrl? }` (URL firmada de R2, expira en 24 h) |

## 10. Moderación y apelaciones (admin/moderador)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/admin/reports` | `is_admin \| is_moderator` | Listado paginado de `contentReport`, filtrable por `status`/`severity` |
| PATCH | `/api/admin/reports/:id` | `is_admin \| is_moderator` | `{ status, resolutionNote? }`; con `actioned` puede despublicar la sala |
| POST | `/api/rooms/:roomId/appeal` | autor de la sala | Apela un bloqueo de pre-check o una retirada |
| POST | `/api/me/appeal` | usuario | Apela una suspensión de cuenta |
| GET | `/api/admin/appeals` | `is_admin \| is_moderator` | Cola de apelaciones pendientes |
| PATCH | `/api/admin/appeals/:id` | `is_admin \| is_moderator` | Resuelve: `upheld` u `overturned` |
| GET | `/api/admin/audio` | `is_admin \| is_moderator` | Cola de audio subido (`?status=pending` por defecto, las más antiguas primero) |
| PATCH | `/api/admin/audio/:id` | `is_admin \| is_moderator` | `{ decision: 'approved' \| 'rejected', reason? }` (motivo obligatorio al rechazar); `409 ALREADY_REVIEWED` si ya se revisó |
| GET/POST/PATCH | `/api/admin/pricing-tiers` | `isAdmin` | Gestión de tramos de precio editables |
| GET/PATCH | `/api/admin/settings/:key` | `isAdmin` | Ajustes de plataforma (p. ej. `maxPlayersPerRoom`) |

## 11. Rate limiting y seguridad

- Redis para rate limiting por IP + ruta; límites más estrictos en rutas públicas sensibles:
  `POST /api/access-keys/redeem` (fuerza bruta de códigos), `POST /api/rooms/:roomId/reviews`,
  `POST /api/webhooks/stripe` (excepción: se limita por firma válida, no por IP).
- CSP estricta en el frontend. Ninguna ruta REST devuelve soluciones/pesos/melodías (eso es
  exclusivo del protocolo de Colyseus, ya filtrado en su `GameState`).
- Auditoría de endpoints administrativos: log de quién hizo qué.

## 12. Relación con el MCP

El MCP **no tiene API ni lógica paralelas** (ADR-010/022): sus tools comparten la **capa de servicios
de dominio** con esta superficie REST y con el tRPC del editor, con un `actor` como única diferencia.
Se autentica con OAuth 2.1 (`@slxd/mcp-auth`) y se sirve en `/mcp/creator`. Garantiza que "todo lo que
el editor visual puede hacer, el MCP puede hacerlo" sin mantener dos superficies sincronizadas.

## 13. Dependencias

- `specs/14-modelo-de-datos-sql.md` — tablas y constraints.
- `specs/02-modelo-de-negocio.md` — reglas de licencias, tramos, claves y una-partida.
- `specs/18-legal-rgpd-y-menores.md` — endpoints de derechos RGPD y DPA.
