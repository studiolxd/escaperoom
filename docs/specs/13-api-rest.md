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
  propias tools (`/mcp/creator`, ADR-010). **API pública — futura** (ADR-022, A-8): los clientes
  externos usarían **Bearer/API key** contra esta superficie REST, pero hoy no hay emisión ni
  revocación de API keys — se diseñará con el primer integrador (ver `docs/DEUDA.md`).
- **Errores:** siempre `{ "error": { "code": "STRING_CODE", "message": "texto legible" } }` con el
  HTTP status correspondiente (400/401/403/404/409/422/429/500). Nunca se filtra un stack trace.
  Códigos fijados en toda la superficie REST (A-22, auditoría 2026-09-24 — antes variaban de un
  adaptador a otro; el contrato compartido vive en `packages/web/src/server/rest/_http.ts`):
  - `VALIDATION_ERROR` = **422** en todas las rutas (nunca 400).
  - Cuerpo JSON roto (no parsea) = `INVALID_JSON` **400** — distinto de `VALIDATION_ERROR`: es la
    forma, no el contenido.
  - Sin sesión = `UNAUTHORIZED` **401** (nunca `UNAUTHENTICATED` ni otra variante).
  - Toda respuesta privada (con sesión) o de error lleva `Cache-Control: no-store`.
- **Paginación:** cursor-based (`?cursor=...&limit=20`), respuesta
  `{ items: [...], nextCursor: string | null }`.
- **Idempotencia — API pública, futura** (A-8): la intención es que todo POST con efecto económico
  (checkout, generación de claves en lote) acepte cabecera `Idempotency-Key` y persista la respuesta
  24 h; hoy ningún handler la lee (la idempotencia real actual es otra: dedupe de eventos de Stripe
  por `event.id` en el webhook, §7, y comprobaciones de estado en cada servicio). Se implementará
  junto con la API pública para terceros.
- **Versionado:** sin prefijo `/v1/`; el contrato evoluciona de forma aditiva.
- **Autorización:** se aplica siempre en el handler, nunca solo en el cliente.

## 2. Autenticación y perfil

Better Auth gestiona `/api/auth/*` (signin, callback OAuth, signout, session; plugin de organización). Rutas propias:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/me` | usuario | Perfil: `user`, saldo de `creditAccount` (personal + cada org), organizaciones |
| PATCH | `/api/me` | usuario | **No implementado** (A-8, auditoría 2026-09-24): `name`/`image` ya los cubre `POST /api/auth/update-user` de Better Auth (sin plugin propio); `locale` no tiene ningún punto de escritura hoy porque no existe una página de perfil/ajustes que lo use — el `LocaleSwitcher` solo cambia el segmento de la URL, no persiste. Se retoma si aparece una necesidad real (página de ajustes) |
| POST | `/api/me/stripe-connect` | usuario | Inicia onboarding de Stripe Connect; devuelve URL hospedada |
| GET | `/api/me/stripe-connect/status` | usuario | `not_started \| pending \| complete` |
| GET | `/api/me/purchases` | usuario | **API pública — futura** (A-8): la web no lo necesita (el organizador ve sus compras en sus propios paneles); solo tendría sentido para un integrador externo que consulte el historial de un usuario |
| GET | `/api/me/rooms` | usuario | **API pública — futura**: idem, listado de salas propias por REST para un integrador externo |
| GET | `/api/me/events` | usuario | Sus eventos como organizador |
| POST | `/api/organizations` | usuario | **API pública — futura**: alta de organización por REST para un integrador; hoy las organizaciones de este proyecto no se crean desde la UI |
| POST | `/api/organizations/:orgId/members` | owner/admin | **API pública — futura**: hoy la invitación se crea con Better Auth `POST /api/auth/organization/invite-member` (plugin `organization()`, `lib/auth.ts`), que desde A-8 sí envía el email (`sendInvitationEmail`) |
| GET | `/api/me/data-export` | usuario | Export completo de datos (portabilidad RGPD) |
| DELETE | `/api/me` | usuario | Cierre de cuenta y anonimización según plazos |
| POST | `/api/organizations/:id/dpa/sign` | owner/admin | Aceptación del DPA antes de habilitar claves individuales con email. Cuerpo `{ version }` (la vigente; si no, 409 `DPA_VERSION_MISMATCH`); responde `{ organizationId, currentVersion, signed, version, signedBy, signedAt, alreadySigned }`. Miembro sin rol → 403 (specs/18 §3.1) |

## 3. Catálogo (público)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/rooms` | público | Listado paginado de salas `published`. Filtros: `q` (título, `pg_trgm`), `difficulty`, `language` (la sala **incluye** el idioma), `minPrice`, `maxPrice`, `players`; `sort=recent\|rating\|price_asc\|price_desc` |
| GET | `/api/rooms/:roomId` | público | Detalle de catálogo (metadata de la última versión publicada) — **nunca** el `package` completo |
| GET | `/api/rooms/:roomId/versions` | público | Histórico de versiones (solo metadata `semver`, `changelog`, `published_at`) |
| GET | `/api/rooms/:roomId/reviews` | público | Listado paginado de reseñas |
| POST | `/api/rooms/:roomId/reviews` | comprador/jugador | Crea/actualiza su reseña (`UNIQUE(user_id, room_id)`) |
| POST | `/api/rooms/:roomId/report` | usuario | Crea `contentReport` (`REPORT_REASON_REQUIRED` si falta motivo). Cuerpo `{ category, reason, details? }`; la severidad la fija el servidor según la categoría (specs/17 §4.1): `minor_safety`/`illegal_content` son críticas y despublican la sala al instante. Repetir el mismo reporte pendiente responde 200 con el existente |
| POST | `/api/reports` | usuario | Igual para cualquier destino: `{ targetType: room\|review\|user, targetId, category, reason, details? }` (ticket 6.1) |

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
| POST | `/api/rooms` | usuario | **API pública — futura** (A-8): hoy una sala nueva se crea por onboarding (fixture, `POST /api/onboarding/rooms`) o por el MCP (`create_room`, `RoomDraftService.createDraft`), nunca por este endpoint genérico; solo haría falta para un integrador externo |
| PATCH | `/api/rooms/:roomId` | autor | **API pública — futura**: metadata (`title`, `priceCents`, `saleIndividual`, `saleEvents`, `licensable`, `licensePriceCents`, `status: 'archived'`) se fija al crear/publicar y hoy no tiene UI de edición posterior |
| DELETE | `/api/rooms/:roomId` | autor | **API pública — futura**: borrado lógico sin implementar; hoy no hay UI para archivar/borrar una sala publicada |
| GET | `/api/rooms/:roomId/draft` | autor/colaborador | Bootstrap del editor: último snapshot + updates posteriores |
| POST | `/api/rooms/:roomId/validate` | autor (o MCP) | Corre el validador sobre el draft: `{ valid, errors, warnings, estimatedMinutes, estimatedDifficulty }` |
| POST | `/api/rooms/:roomId/publish` | autor | `{ changelog }`. El semver es siempre automático (ADR-035, `classifyRoomPackageChange` sobre el `RoomPackage` candidato frente al de la última versión): ya no se puede pedir uno. Exige `validate` en verde (repetido server-side). Empaqueta, sube assets a R2, calcula `assetsHash`, inserta `roomVersion`. `VALIDATION_FAILED` si no pasa; `NOTHING_TO_PUBLISH` (409) si el contenido es idéntico al de la última versión publicada |
| GET | `/api/rooms/:roomId/versions/:versionId/package` | autor, admin o servicio interno | El `RoomPackage` completo — única ruta que lo expone, nunca al público |
| POST | `/api/rooms/:roomId/license-checkout` | creador | Compra la licencia de la sala de otro → Stripe Checkout, `purchase_type: 'room_license'` |
| POST | `/api/rooms/:roomId/gift-copy` | autor | Envía copia gratuita a otro creador (`{ recipientEmail }`) — sin Stripe, fork inmediato |
| GET | `/api/rooms/:roomId/access` | usuario | `{ owned, playable, gameToken?, roomId? }` (C-4/B-4, auditoría 2026-09-24): `playable: false` solo cuando la partida ya TERMINÓ (`game_ended`, specs/02 §2.1); mientras esté libre o en curso, `playable: true` con el `gameToken` que exige `onAuth` de la `GameRoom` — con `roomId` cuando hay una partida en curso a la que unirse en vez de crear otra. **Implementada** (`server/rest/room-access.ts`); A-8 corrige la mención de esta fila como "ausente" en la nota A-8 de la auditoría 2026-09-24 |

### 4.1 Audio del creador (ticket 3.11)

Biblioteca incluida + subida propia de MP3, **disponible al instante, sin moderación previa**
(decisión de 2026-09-26, ADR-039; `specs/15` §1 y §4, `specs/17` §1). En el borrador,
`LocalizedText.audioUrl` y los efectos (`play_sound`) guardan una referencia estable
(`library:<trackId>` o `upload:<uuid>`), no una URL firmada; la publicación la resuelve a R2.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/audio/library` | público | Biblioteca incluida (`?kind=music\|sfx\|voice`), con licencia, créditos y `ref` |
| GET | `/api/audio/uploads` | usuario | Subidas propias con `status` (`approved`/`rejected`) y `rejectionReason` |
| POST | `/api/audio/uploads` | usuario | Multipart: `file` (MP3) + `rightsDeclared=true`. Valida el contenido real, tamaño y duración → 201 `approved`, usable de inmediato. `415 UNSUPPORTED_MEDIA_TYPE`, `413 PAYLOAD_TOO_LARGE`, `422 VALIDATION_ERROR` |
| GET | `/api/audio/uploads/:id` | dueño | Metadatos + `previewUrl` firmada (nula si está rechazado); 404 para cualquier otro usuario |

Un audio subido solo lo puede usar su dueño. `rejected` es histórico (decisiones humanas ya
tomadas antes de esta fecha por la extinta cola de moderación) y sigue sin ser usable
(`AUDIO_REJECTED`, con motivo); no hay forma nueva de llegar a ese estado.

### 4.1b Medios de la introducción (encargo lobby-diseño)

Vídeo (mp4/webm, hasta 200 MB, sin límite de duración) y subtítulos WebVTT por idioma de
`meta.intro` (`specs/04` §10). **Solo el autor de la sala**; sin moderación previa. El borrador
guarda la referencia `media:<uuid>` que devuelven estas rutas; la publicación la reescribe a la
clave direccionada por contenido. Servicio: `IntroMediaService` (`@escaperoom/shared/services`),
adaptador `server/rest/intro-media.ts`.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/rooms/:roomId/intro-media/video` | autor | `{ filename, contentType, byteSize }` (`video/mp4`\|`video/webm`; `application/octet-stream` se decide por la extensión) → 201 `{ assetId, uploadUrl, headers }`. El vídeo **no pasa por el servidor**: el navegador hace `PUT uploadUrl` con el fichero y exactamente esas `headers` (firma `content-type` y `content-length`; caduca en 15 min). `415`, `413` (declarado > 200 MB), `422` |
| POST | `/api/rooms/:roomId/intro-media/video/:assetId/complete` | autor | Comprueba el objeto subido (HEAD: tamaño ≤ 200 MB; GET por rango: magic bytes, `ftyp` en el offset 4 = mp4, EBML `1A 45 DF A3` = webm, y deben coincidir con el tipo declarado) → 200 `{ ref: "media:<uuid>" }`. Idempotente. `409 UPLOAD_INCOMPLETE` si el PUT aún no ha terminado; `415`/`413` si no cuadra (el objeto y el asset se **borran**: hay que empezar otra subida) |
| POST | `/api/rooms/:roomId/intro-media/subtitles?lang=xx` | autor | Cuerpo = el `.vtt` tal cual (`Content-Type: text/vtt`, UTF-8, empieza por `WEBVTT`, ≤ 512 KB) → 201 `{ ref: "media:<uuid>" }`. `422` (sin `lang` o idioma inválido), `415`, `413` |
| GET | `/api/rooms/:roomId/intro-media/url?ref=…` | autor | `{ url }`: URL firmada (1 h) de un `media:` propio y listo, o de una clave publicada, para previsualizar en el editor. `409 NOT_READY` (vídeo sin completar), `403`, `404` |

Cuotas (`docs/reference/seguridad.md` §1): `intro-media-upload` (vídeo y subtítulos, compartida
con la meta-tool `upload` del MCP), `intro-media-complete` e `intro-media-read`. En partida y
playtest las URLs (6 h) las firma el servidor al montar la página (`introMediaUrlResolver`,
`server/intro-media-url.ts`); no hay ruta pública para ello.

### 4.2 Licencias entre creadores (ticket 5.10)

Reglas en `specs/02` §5. El fork es una sala **nueva** en `draft` del comprador/receptor, con
`forkedFromRoomId`/`forkedFromVersionId`, cuyo draft Yjs se siembra con el `package` congelado de la
versión (`roomPackageToDoc`) como primer `roomUpdate` (`meta.id`/`meta.authorId` pasan a ser los del
fork). Los assets publicados (`r2://…`) se referencian, no se copian.

- `license-checkout` — cuerpo opcional `{ roomVersionId? }` (por defecto, la última versión). Exige
  `licensable = true` y `licensePriceCents` no nulo (`422 LICENSE_NOT_AVAILABLE`); el autor no compra
  la suya (`409 LICENSE_OWN_ROOM`). Con precio: crea `purchase` `room_license` `pending` y abre el
  pago en el puerto `PaymentGateway` → `200 { purchase, checkoutUrl }`; el fork se crea al confirmar
  el pago (webhook de 5.1 → `confirmLicensePayment`, idempotente). A precio 0: `201 { purchase, room }`.
  Sin pasarela cableada: `501 PAYMENT_GATEWAY_UNAVAILABLE`.
- `gift-copy` — `{ recipientEmail, roomVersionId? }`, solo el autor (`403`). `201 { purchase, room }`
  con `purchase` a precio 0. No exige `licensable`. `404 RECIPIENT_NOT_FOUND`, `422 INVALID_RECIPIENT`
  (a sí mismo).
- Ambas: `409 LICENSE_ALREADY_OWNED` (con `resultingRoomId`) si el receptor ya tiene esa versión;
  `422 ROOM_VERSION_UNAVAILABLE` si la sala no tiene esa versión publicada.

## 5. Compras (venta individual de salas)

Checkout con **Stripe Checkout** hospedado (no se gestionan tarjetas directamente).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/purchases/room-checkout` | usuario | `{ roomVersionId }` → valida `saleIndividual` y precio, crea `purchase` (`pending`) + Checkout Session con `metadata.purchaseId`. Devuelve `{ checkoutUrl }` |
| GET | `/api/purchases/:id` | comprador o admin | Estado de una compra |
| GET | `/api/rooms/:roomId/free-access` | público, sin sesión | `{ eligible, gameToken?, roomVersionId? }` (punto i de "CTA Jugar", `docs/DEUDA.md`; specs/02 §2.2): sala realmente gratis (`priceCents: 0` + `saleIndividual: true`), sin `purchase` ni Stripe. Rate-limitada por IP (`free-room-play`, `docs/reference/seguridad.md` §1) — cada emisión corresponde a una `GameRoom` nueva |

El reparto 70/30 se calcula al liquidar el pago en el webhook (§7), no en la creación; el
`stripeTransferId` lo resuelve un barrido periódico de `@escaperoom/worker` (B-9, auditoría
2026-09-24), fuera del camino crítico del webhook.

## 6. Eventos y claves de acceso

### 6.1 Ciclo de vida del evento

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events` | usuario | `{ roomVersionId, title, maxSimultaneousSessions, groupingMode, requireConfirmation, expiryRules, playersPlanned, audience?, allowVideo?, recordingEnabled? }` → valida `saleEvents`, calcula `pricingSnapshot` desde `pricingTier` y el total. Si `organizerId === room.authorId`, claves gratis y activable sin checkout |
| PATCH | `/api/events/:id` | organizador | Edita config mientras `status = draft` |
| GET | `/api/events/:id` | organizador o admin | Detalle + resumen (nº sesiones, nº claves por estado) |
| POST | `/api/events/:id/checkout` | organizador | Checkout por el total (si no es autoventa gratuita) |
| POST | `/api/events/:id/activate` | organizador | `draft → active` con el pago saldado (autoventa o `payment.status = paid`; nunca si `refunded`); a partir de aquí se generan sesiones y claves. El webhook de Stripe (§7) SOLO marca `payment.status = paid`, nunca activa por sí mismo (auditoría 2026-09-24, B-2): el organizador (o un plan por defecto de la integración) llama a este endpoint explícitamente |

### 6.2 Sesiones, grupos y claves

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events/:id/sessions` | organizador | Crea una o varias sesiones (`{ name, capacity }[]`), hasta `maxSimultaneousSessions` |
| POST | `/api/events/:id/sessions/:sessionId/groups` | organizador | **API pública — futura** (A-8): la agrupación (`groupingMode`) hoy se resuelve al generar las claves (`POST .../access-keys`) y en el `join`, sin un endpoint propio para crear un grupo suelto; solo haría falta para que un integrador gestione grupos por su cuenta |
| POST | `/api/events/:id/access-keys` | organizador | Generación en lote: `{ type, count, sessionId?, groupAssignment, emails? }`. Aplica `groupingMode`; con `emails` encola el envío de cada invitación (Nodemailer/SMTP por defecto, Resend opcional — ADR-020) |
| GET | `/api/events/:id/access-keys` | organizador | Listado paginado con estado — alimenta el panel |
| POST | `/api/access-keys/:code/resend` | organizador | Reenvía el email de invitación (202; recordatorio si aún no confirmó) |
| GET | `/api/events/:id/invitations` | organizador | Resumen de invitaciones por email para el panel: `{ requireConfirmation, invited, sent, confirmed, pending, expired }` ("28/30 confirmados") |
| POST | `/api/events/:id/invitations/resend` | organizador | Recordatorio a todas las claves en `pending_confirmation` (202) |
| POST | `/api/access-keys/:code/regenerate` | organizador | Solo `type = rotating`: invalida la actual y crea nueva con `regeneratedFrom` |
| POST | `/api/access-keys/:code/confirm` | público (enlace del email) | `{ token }` firmado → `pending_confirmation → confirmed` |
| POST | `/api/access-keys/redeem` | público (puede no tener cuenta) | `{ code }` → valida estado y caducidad, marca `used`/`active`, devuelve `{ sessionId, colyseusEndpoint, joinToken }` (`joinToken` = JWT corto, no la clave en claro) |
| GET | `/api/events/:id/dashboard` | organizador | Resumen en vivo: estado del evento, claves (generadas/enviadas/confirmadas/canjeadas), sesiones con su progreso y el ranking del evento |
| GET | `/api/events/:id/progress/export?locale=` | organizador | Progreso y ranking en CSV (adjunto, UTF-8 con BOM, cabeceras en el idioma pedido o el del evento) |
| POST | `/api/events/:id/sessions/:sessionId/spectate` | organizador | Token de observador (5 min) para entrar en la room `event` de una sesión en curso en solo lectura: `{ sessionId, spectatorToken, expiresAt, colyseus: { endpoint, roomName } }` |

**Códigos de error de claves:** `ACCESS_KEY_INVALID`, `ACCESS_KEY_USED`, `ACCESS_KEY_EXPIRED`,
`ACCESS_KEY_NOT_CONFIRMED` (si `requireConfirmation = true` y aún no confirmó), `SESSION_FULL` —
los mismos que usa el `join` de Colyseus, porque `redeem` es el paso previo inmediato.

**Invitaciones y confirmación (ticket 5.6).** Activar (`POST /api/events/:id/activate` con
`keyPlan[].emails`) o generar claves con `emails` encola un job por clave en la cola BullMQ
`mail.invitation` y responde además `emails: { requested, queued }` (`queued: 0` con
`QUEUES_ENABLED=false`); lo entrega `@escaperoom/worker` con 5 intentos y backoff exponencial. Una sola
dirección usa la plantilla de invitación individual y varias la masiva; el reenvío de una clave
pendiente de confirmar, la de recordatorio. Idioma: `event.config.locale` (campo `locale` opcional de
`POST`/`PATCH /api/events`), si no el del organizador, si no `es`. El envío correcto sella
`accessKey.sentAt` y, con `requireConfirmation`, pasa la clave de `generated` a
`pending_confirmation`. El email lleva un enlace a la página pública
`/{locale}/invitations/{code}/confirm?token=…`, que confirma con un POST explícito (los escáneres de
enlaces del correo hacen GET y no deben confirmar por el asistente). El token es un HMAC-SHA256
(`CONFIRMATION_TOKEN_SECRET`, por defecto `APP_SECRET`) sobre `{ código, exp }`; caduca a los 30 días
(`CONFIRMATION_TOKEN_TTL_SECONDS`) o con la clave, lo que llegue antes. Errores: 403
`CONFIRMATION_INVALID` (firma alterada, token de otra clave), 410 `CONFIRMATION_EXPIRED`, 409
`ACCESS_KEY_EXPIRED` (clave caducada o rotada), 409 `ACCESS_KEY_NO_EMAIL` al reenviar una clave sin
email, 503 `CONFIRMATION_UNAVAILABLE` sin secreto en producción, 403 `DPA_REQUIRED` al generar
claves con `emails`, activar con emails en el `keyPlan` o reenviar invitaciones si la organización
activa no tiene firmado el DPA vigente (ticket 5.11, specs/18 §3.1). Confirmar dos veces responde 200 con
`alreadyConfirmed: true`.

**Canje (ticket 5.8).** Cuerpo `{ code, displayName?, sessionId?, groupId? }`: `sessionId`/`groupId`
solo cuentan en `groupingMode: free` (el asistente elige); sin `sessionId` en `free` responde
422 `SESSION_REQUIRED` con `sessions: [{ id, name, capacity, available }]` elegibles. Respuesta
`{ eventId, sessionId, groupId, colyseusEndpoint, roomName: "event", joinToken, expiresAt, player }`.
El invitado sin cuenta recibe una identidad efímera `guest:<uuid>` que solo vive en el `joinToken`
(JWT HS256, `JOIN_TOKEN_SECRET` compartido con Colyseus, 2 h por defecto — specs/11 §8: el mismo
token sirve para el `join` inicial y para volver a la MISMA plaza durante toda la partida; ajustable
con `JOIN_TOKEN_TTL_SECONDS`). La room `event` de Colyseus rechaza el `join` sin token válido,
caducado o de otra sesión (`JOIN_TOKEN_*`).

**Panel del organizador (ticket 5.9).** Solo el organizador del evento (401 sin sesión, 403 otro
usuario, 404 evento inexistente). El dashboard cruza Postgres (sesiones con su ocupación, claves por
estado, invitaciones de 5.6) con el progreso en vivo que publica cada room `event` (fase, puzzles
resueltos/totales, pistas, jugadores conectados, inicio/fin y tiempo jugado; nunca soluciones), que
web lee de la ruta interna de Colyseus `GET /internal/events/:eventId/progress` (credencial derivada
de `JOIN_TOKEN_SECRET`). Si Colyseus no responde, `liveAvailable: false` y solo se muestra lo
persistido. Una fila por sesión (= grupo en juego) con `state: not_started | lobby | playing | ended
| offline`, ordenada por el ranking de `specs/21` §4: primero los que escaparon por tiempo
(desempates: menos pistas, menos jugadores), después el resto por puzzles resueltos (desempates:
menos pistas, menos tiempo); las sesiones sin empezar no tienen puesto. `spectate` responde 404
`SESSION_NOT_FOUND` (sesión de otro evento), 409 `SESSION_NOT_LIVE` (sin partida en curso) y 503
`SPECTATOR_UNAVAILABLE` (sin `JOIN_TOKEN_SECRET` en producción).

### 6.3 Grabaciones — API pública, futura

**No implementado** (A-8, auditoría 2026-09-24): ninguna de las dos rutas existe hoy. La grabación en
sí (LiveKit + `allowVideo`, specs/11) tampoco tiene todavía un flujo de exportación/borrado propio en
la web — se retoma junto con la API pública para terceros.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| DELETE | `/api/events/:id/recordings/:recordingId` | owner/admin de la org | Solicita borrado anticipado |
| GET | `/api/events/:id/recordings/:recordingId/download` | owner/admin de la org | URL firmada (24 h) |

## 7. Webhook de Stripe

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/stripe/webhook` | firma Stripe (`Stripe-Signature`, sin sesión) | Único punto de entrada de eventos de Stripe |

| Evento Stripe | Efecto |
|---|---|
| `checkout.session.completed` / `checkout.session.async_payment_succeeded` | Solo si `payment_status = paid` (auditoría 2026-09-24, B-12: un método asíncrono como SEPA llega a `completed` con `payment_status: unpaid` y pasa a `paid` en el evento `async_payment_succeeded`). Recupera `purchaseId` de `metadata`. Si `purchase_type = room`: `purchases.status = succeeded` (la `Transfer` del 70 % al creador ya NO es síncrona aquí — B-9 — sino un barrido periódico de `@escaperoom/worker`, `creator-payouts.ts`, con reintentos). Si `room_license`: crea el fork → `resulting_room_id` (misma nota sobre la `Transfer`). Si `event_credits`: liquida por `purchaseId` comprobando que `session.id` y el importe cobrado coinciden con lo congelado al abrir el checkout (B-1/B-8) y marca `payment.status = paid` — **nunca activa el evento** (B-2): el organizador llama a `POST /api/events/:id/activate` |
| `checkout.session.expired` | Solo `event_credits`: libera `payment.checkoutRef` para que el organizador pueda abrir un checkout nuevo (B-1) |
| `payment_intent.payment_failed` / `checkout.session.async_payment_failed` | `room`/`room_license`: `purchases.status = failed`. `event_credits`: **sin efecto** (B-1) — Stripe Checkout deja reintentar con otra tarjeta en la misma Session, así que un fallo de cobro ya no libera el importe/checkout congelado (antes lo hacía, y eso es lo que permitía manipular `playersPlanned` y reintentar con el precio antiguo) |
| `charge.refunded` | Reembolso **total**: `purchases.status = refunded`; si era sala, revoca acceso; si era evento, bloquea `activate`/la generación de más claves (jugado es jugado: no revoca claves ya canjeadas). Reembolso **parcial**: se registra (log) pero NO cambia el estado — el acceso/evento sigue vivo. Si ya se había transferido el reparto al creador (`room`/`room_license`), se revierte proporcionalmente al importe reembolsado con `PaymentGateway.reverseTransfer` (B-5) |
| `account.updated` | Actualiza el estado de onboarding de Stripe Connect |

**Idempotencia y seguridad:**
- Verificación de firma con `STRIPE_WEBHOOK_SECRET` antes de procesar.
- Tabla de apoyo `stripe_webhook_events (id text primary key, type text, received_at timestamptz)`:
  `id` = `event.id` de Stripe; si ya existe, 200 sin reprocesar (Stripe reintenta y no garantiza
  entrega única).
- Respuesta 200 rápida (<5 s); el trabajo pesado se delega a una cola Redis.
- Cada `Transfer` (`PaymentGateway.createTransfer`) es idempotente por `purchaseId`
  (`idempotencyKey` + comprobación de `transfers.list({transfer_group})` antes de crear, B-3): un
  reintento del webhook o del barrido de payouts nunca duplica una transferencia.

## 8. Sesiones y progreso (lectura) — API pública, futura

**No implementado** (A-8): ninguna de las dos rutas existe hoy. El organizador ya ve este progreso
en `GET /api/events/:id/dashboard` (§6.2), que cruza Postgres con el estado en vivo de Colyseus; estas
dos serían el equivalente de solo-lectura por sesión para un integrador externo.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/sessions/:id` | organizador, jugadores de la sesión, admin | Estado persistido de la sesión |
| GET | `/api/sessions/:id/progress` | organizador, admin | `progressEvent`: puzzles resueltos, tiempos, pistas por grupo |

## 9. Generación de PDF de tarjetas-clave

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/events/:id/access-keys/export-pdf` | organizador | `{ codes?: string[], locale? }` (omitir `codes` = todas las claves vivas). <50 tarjetas: 200 con el PDF (`pdf-lib` + `qrcode`); mayor: job async → 202 `{ jobId, status: "queued", cards }` |
| GET | `/api/exports/:jobId` | organizador que lo pidió | `{ jobId, eventId, status, cards, downloadUrl, expiresAt }`; `status`: `queued`/`processing`/`completed`/`failed`/`expired` |
| GET | `/api/exports/:jobId/download?expires&signature` | enlace firmado (sin sesión) | El PDF del job. Firma manipulada → 403 `EXPORT_LINK_INVALID`; caducada → 410 `EXPORT_LINK_EXPIRED` |

**Tarjetas (ticket 5.7).** A4 con 2 × 4 tarjetas y líneas de corte. Cada tarjeta lleva el título del
evento y de la sala, la clave `XXXX-XXXX-XXXX` en grande, un QR con la URL de canje
(`/{locale}/redeem?code=…`), los asientos si la clave es compartida, la caducidad si la tiene y
unas instrucciones breves. Idioma: el por defecto de la versión de sala (`meta.defaultLanguage`) si
es uno de los 6 locales, o el que pida `locale`. Sin `codes` se imprimen solo las claves vivas; con
`codes`, esas en ese orden (reimpresión). El job va por la cola BullMQ `access-keys.cards-pdf` del
worker, que sube el PDF al bucket privado (`exports/access-key-cards/<jobId>.pdf`). La
`downloadUrl` la firma la app (HMAC-SHA256 con clave derivada de `APP_SECRET`) y caduca 24 h después
de terminar el job; la ruta de descarga lee el objeto del bucket y lo sirve. Sin cola
(`QUEUES_ENABLED=false`) o sin `APP_SECRET` en producción, pedir 50 tarjetas o más responde 503
`EXPORT_UNAVAILABLE`.

## 10. Moderación y apelaciones (admin/moderador)

Desde 2026-09-26 (ADR-039) el audio del creador ya no tiene cola de admin propia
(`/api/admin/audio*` retirada): se modera igual que el resto de contenido, por reportes.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/admin/reports` | `is_admin \| is_moderator` | Listado de `contentReport`, filtrable por `status` (por defecto `pending`)/`severity`, priorizado (severidad → evento activo → nº de reportes sobre el mismo contenido → antigüedad) con `slaDueAt` y `overdue` |
| PATCH | `/api/admin/reports/:id` | `is_admin \| is_moderator` | `{ status: actioned\|dismissed, action?: unpublish\|hide\|warn, resolutionNote? }`. `dismissed` revierte la acción automática (restaura la sala o la reseña); `actioned` aplica la acción (por defecto: sala alta/crítica → `unpublish`, normal → `warn`; reseña → `hide`) y el strike de specs/17 §6. `409 ALREADY_REVIEWED` si ya se resolvió |
| POST | `/api/rooms/:roomId/appeal` | autor de la sala | Apela un bloqueo de pre-check o una retirada: `{ reason, contentReportId? }` (sin id, la última acción sobre la sala). `409 APPEAL_NOT_ALLOWED` (crítico), `APPEAL_ALREADY_PENDING`, `NOTHING_TO_APPEAL` |
| POST | `/api/me/appeal` | usuario | Apela una suspensión de cuenta: `{ reason }` (apela el strike que la causa) |
| GET | `/api/me/moderation` | usuario | Estado del creador: `status` (`good\|warned\|suspended\|banned`), `suspendedUntil`, `activeStrikes`, `frozen` |
| GET | `/api/admin/appeals` | `is_admin \| is_moderator` | Cola de apelaciones pendientes |
| PATCH | `/api/admin/appeals/:id` | `is_admin \| is_moderator` | Resuelve: `upheld` u `overturned` |
| GET/POST/PATCH | `/api/admin/pricing-tiers` | `isAdmin` | Gestión de tramos de precio editables |
| GET/PATCH | `/api/admin/settings/:key` | `isAdmin` | Ajustes de plataforma (p. ej. `maxPlayersPerRoom`) |

## 11. Rate limiting y seguridad

- Redis para rate limiting por IP + ruta; límites más estrictos en rutas públicas sensibles:
  `POST /api/access-keys/redeem` (fuerza bruta de códigos), `POST /api/rooms/:roomId/reviews`,
  `POST /api/stripe/webhook` (excepción: se limita por firma válida, no por IP).
- CSP estricta en el frontend. Ninguna ruta REST devuelve soluciones/pesos/melodías (eso es
  exclusivo del protocolo de Colyseus, ya filtrado en su `GameState`).
- Auditoría de endpoints administrativos: log de quién hizo qué.

## 12. Relación con el MCP

El MCP **no tiene API ni lógica paralelas** (ADR-010/022): sus tools comparten la **capa de servicios
de dominio** con esta superficie REST y con el tRPC del editor, con un `actor` como única diferencia.
Se autentica con OAuth 2.1 (`@slxd/mcp-auth`) y se sirve en `/mcp/creator`. Garantiza que "todo lo que
el editor visual puede hacer, el MCP puede hacerlo" sin mantener dos superficies sincronizadas.

**Publicar por MCP exige confirmación humana (ticket 4.5).** La tool `publish` no publica: comprueba
lo mismo que `POST /api/rooms/:roomId/publish` sin escribir nada y devuelve un enlace
`/{locale}/publish-confirm?token=…`. El creador lo abre con su sesión y confirma:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/publish-confirm` | autor (sesión, mismo sitio) | `{ token }` → 201 `{ version, warnings }`. Publica con el servicio de §4 solo si el draft y la última versión son los aprobados: `DRAFT_CHANGED`/`VERSION_CHANGED` (409), `EXPIRED` (410), `INVALID_TOKEN` (400), `FORBIDDEN` (403), `CROSS_SITE` (403), `PUBLISH_CONFIRM_DISABLED` (503) y los errores de §4 (422 con el informe). |

El token es sin estado (HMAC con `PUBLISH_CONFIRM_SECRET`) y liga sala, autor, huella del
`RoomPackage` validado, última versión publicada, notas y caducidad; ver
`packages/mcp-server/README.md` § «Mecanismo de confirmación».

## 13. Dependencias

- `specs/14-modelo-de-datos-sql.md` — tablas y constraints.
- `specs/02-modelo-de-negocio.md` — reglas de licencias, tramos, claves y una-partida.
- `specs/18-legal-rgpd-y-menores.md` — endpoints de derechos RGPD y DPA.
