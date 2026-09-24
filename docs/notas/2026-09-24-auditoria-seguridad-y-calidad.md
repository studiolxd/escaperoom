# Auditoría de seguridad, completitud y calidad del código (2026-09-24)

Informe para el agente (o agentes) que vaya a corregir. Lectura de TODO el código fuente del
monorepo sobre `main` en `d8e2f90` (10 paquetes, ~125 k líneas TS), repartida en seis frentes
paralelos y con cada hallazgo alto/crítico re-verificado leyendo el código. No se ha modificado
ningún fichero de producto.

## 0. Estado verificado del repo

| Comprobación | Resultado |
|---|---|
| `pnpm -r run typecheck` (10 paquetes) | limpio |
| `pnpm -r run lint` | limpio (pero el preset solo lleva `@eslint/js` + `typescript-eslint`; ver F-24) |
| `pnpm -r run test` (sin Postgres/Redis) | 1 702 tests en verde, 45 saltados (`describe.skipIf(!DATABASE_URL / !REDIS_URL)`) |
| `pnpm audit` | 15 avisos (1 crítico, 10 altos), **todos en dependencias transitivas de devDependencies** (`@better-auth/cli` 1.4.21 arrastra un `better-auth` viejo; `drizzle-orm`, `lodash`, `deepmerge-ts`). El `better-auth` de runtime es 1.7.5 y no está afectado. Ver §7. |
| Historial git (50 commits) | sin `.env` ni claves con formato conocido |
| CI `verify` | no levanta Postgres/Redis: **ningún test de integración Prisma/Redis corre en CI** (E-14) |

`turbo` no arranca en este contenedor (binario para otra arquitectura); los comandos anteriores se
lanzaron con `pnpm -r`.

## 1. Cómo usar este informe

- Cada hallazgo tiene un id `<área>-<n>` (A auth/REST, B negocio/pagos, C tiempo real, D motor/
  validador/MCP, E infraestructura/jobs/datos, F frontend), severidad (CRÍTICA/ALTA/MEDIA/BAJA/
  MEJORA), categoría, ficheros con línea (sobre `d8e2f90`), evidencia, impacto, corrección y
  confianza (**confirmada** = leído el camino completo; **plausible** = depende de despliegue o de
  comportamiento de una librería no ejecutado).
- §2 es la lista priorizada de lo que hay que arreglar primero. §3–§8 el detalle por área.
  §9 agrupa el trabajo en PRs sugeridas. §10 resume huecos de tests.
- Flujo de trabajo obligatorio para el agente que corrija: el de `CLAUDE.md` (worktree + PR, base
  de datos por worktree con `pnpm dev:env` + `pnpm db:reset`, nunca `pkill` por patrón, UI solo con
  shadcn/ui). Cada corrección de seguridad debe llevar test de regresión.

## 2. Prioridades

### P0 — bloquean producción o exponen credenciales/dinero

| Id | Qué | Dónde |
|---|---|---|
| A-1 | El magic link (único login además de Google) **no se envía**: se imprime en stdout con la URL de sesión de un solo uso | `packages/web/src/lib/auth.ts:22-27` |
| B-1 | Precio de evento manipulable: `payment_failed` libera `checkoutRef`, el organizador sube `playersPlanned` y reintenta en la misma Checkout Session; `markPaid` no compara importe ni `session.id` | `packages/shared/src/services/events.ts:545-553, 626-653`; `packages/web/src/server/rest/stripe-webhook.ts:76-81` |
| B-2 | Evento pagado por webhook queda `active` **sin sesiones ni claves**; después `activate` rechaza (`EVENT_NOT_EDITABLE`) y el canje da `SESSION_FULL` | `events.ts:626-637`, `access-keys.ts:739`, test `events.test.ts:310-316` lo consagra |
| B-3 | `Transfer` a creadores sin `idempotencyKey` y `attachTransfer` traga errores → doble pago al creador en reintentos del webhook | `stripe-gateway.ts:112`, `purchases.ts:273-289`, `purchases-prisma-store.ts:516-521` |
| C-4 | Rooms `game` y `lobby_test` de Colyseus sin `onAuth` en producción: rooms ilimitadas y tokens LiveKit de publicación gratis | `packages/colyseus-server/src/server.ts:38-39` |
| C-3 | El cliente decide `allowVideo`/`name` del token LiveKit; `EventRoom` nunca lee `allowVideo` del evento (privacidad de menores) | `media/join-options.ts:15-22`, `media/service.ts:59` |
| E-1 | `restore-postgres.sh --direct` hace `pg_restore --clean` sobre `DATABASE_URL` ignorando `--target` | `scripts/restore-postgres.sh:61-64` |
| E-4 / C-5 | Secretos de desarrollo comiteados se activan siempre que `NODE_ENV !== "production"`; nadie fija `NODE_ENV` ni valida el entorno al arrancar (`env.ts` sin cablear) | 7 puntos, ver E-4 |
| D-2 | Timer periódico con `durationSec` ínfimo → bucle de ~10⁸ eventos por tick; cuelga el proceso Colyseus para todas las partidas | `schemas/rules.ts:75`, `engine/engine.ts:540-552` |
| D-1 | `RoomPackage` sin topes (rejillas, `players.max`, arrays): un `validate` bloquea el event loop de Next/MCP minutos o provoca OOM | `schemas/common.ts:10-13`, `validator/validate.ts:167-177`, etc. |

### P1 — abuso, integridad de datos, RGPD

A-2/B-15 (`/api/analytics/collect` sin auth ni cuota), A-3 (un reporte "crítico" despublica y
congela al instante), A-4/D-4 (registro OAuth dinámico sin cuota real, TTL 1 año), C-1 (joinToken
reutilizable N veces), C-2 (sin reconexión: host e inventario se pierden), B-4 (compra B2C no
concede nada), B-5 (reembolsos no revierten la Transfer), B-6 (creator-chat sin tope por usuario),
E-3 (purga HMAC con `APP_SECRET` crudo, distinta de los helpers testeados), E-5/A-5 (borrado de
cuenta deja PII y grants OAuth vivos), E-2 (contraseña de Postgres en `ps` y `.env` ejecutado como
shell), F-3 (LiveKit publica mic y cámara automáticamente al conectar), E-8 (códigos de acceso
canjeables 48 h en Redis).

### P2 — rendimiento y robustez con impacto real

C-9 (paneles reenviados a 4 Hz), F-4 (re-render del HUD completo a 20 Hz), F-21/F-22 (Phaser
recrea la sala en cada tecla del inspector), B-13/B-14/E-7 (índices que faltan), E-6 (particiones
sin DEFAULT y solo un mes de antelación), E-9 (worker sin health ni timeout de apagado), F-2 (sin
`error.tsx`/`not-found.tsx`/`loading.tsx`), A-10 (doble consulta de sesión por petición), D-9
(oráculo de `split_clue` exponencial sin caché), D-17 (serialización completa del doc Yjs por
transacción).

### P3 — completitud, deuda y legibilidad

Rutas de specs/13 sin implementar (A-8), mensajes de specs/11 sin implementar (C-13), checks del
validador que faltan (D-10, D-3), gate de confirmación del MCP prometido y no implementado (D-12),
i18n incompleto en 5 locales (F-9, F-10), controles nativos en el editor (F-6, F-7), duplicación
transversal (§8), código muerto (E-17, F-19, F-26).

---

## 3. Área A — autenticación, autorización, REST, admin, MCP OAuth, cabeceras

### A-1 · CRÍTICA · incompleto/seguridad · magic link a los logs
- `packages/web/src/lib/auth.ts:22-27`
  ```ts
  magicLink({
    sendMagicLink: async ({ email, url }) => {
      // TODO(0.11): enviar con @escaperoom/mailer (Nodemailer por defecto, ADR-020).
      console.info(`[magic-link] ${email} → ${url}`);
  ```
- Lo usan `components/auth/auth-form.tsx:52`, `mcp-oauth/consent-login.tsx:46`,
  `onboarding/onboarding-login.tsx:41`, que muestran "enlace enviado". El transporte ya existe
  (`@escaperoom/shared/mail` → `createMailTransportFromEnv`, lo usa `getContactService`).
- Impacto: login por email no funciona; cada intento deja en stdout/agregador de logs una URL que
  inicia sesión como ese email (incluidos `isAdmin`). Sin `disableSignUp`, cualquiera "registra"
  emails ajenos.
- Corrección: enviar con el transporte existente; nunca loguear la URL (a lo sumo en
  `NODE_ENV=development` y solo el email); valorar `magicLink({ disableSignUp: true })` si el alta
  pasa por onboarding; test que falle si `sendMagicLink` no invoca el transporte. Confirmada.

### A-2 · ALTA · seguridad · `POST /api/analytics/collect` sin sesión, sin cuota, cualquier tipo
- `packages/web/src/server/rest/analytics-collect.ts` (todo), `app/api/analytics/collect/route.ts:11`,
  `packages/shared/src/schemas/analytics.ts:143-149` (`sessionId`/`playerId` libres).
- El navegador solo emite `onboarding_step` legítimamente (`lib/analytics-client.ts:10-19`), pero
  el endpoint acepta `purchase_completed`, `session_ended`, `user_registered`, `credit_spent`…
  con ids de otros usuarios, 100 eventos por lote, sin `withRateLimit`.
- Impacto: analítica envenenada; relleno de Redis y `analyticsEvent`. (Rankings y
  `hasPlayedOrPurchased` no se ven afectados: usan `progressEvent`.)
- Corrección: lista blanca de tipos emitibles desde navegador; `playerId` derivado de la sesión;
  secreto server-to-server (cabecera) para Colyseus/worker; política `analytics-collect` en
  `RATE_LIMIT_POLICIES`. Confirmada.

### A-3 · ALTA · abuso · un reporte "crítico" de cualquier usuario despublica y congela
- `packages/shared/src/services/moderation.ts:660-673` (`report`), `:152-158` (`ACCOUNT_FROZEN`),
  `rest/moderation.ts:158-180`.
  ```ts
  if (parsed.targetType === "room" && target.roomId && (severity === "critical" || repeatOffender)) {
    roomStatusBefore = await unpublishRoom(tx, target.roomId);
  ```
- La severidad la fija la categoría elegida por el reportante (`illegal_content`,
  `minor_safety`). Cuota 10/10 min por usuario → 60 salas/h retiradas por una cuenta gratuita.
  Es la decisión de specs/17 §5.1 / ADR-013, pero el daño es inmediato, automatizable y solo lo
  revierte un moderador.
- Corrección: mantener prioridad crítica en cola pero condicionar la acción automática (≥2
  reportantes distintos, o reportante con compra/partida en esa sala, o solo `unlisted` temporal sin
  congelar cuenta); cuota específica para categorías críticas; strike al reportante por críticos
  descartados en serie. Confirmada.

### A-4 / D-4 · ALTA · seguridad · registro dinámico OAuth (RFC 7591) sin cuota real, TTL 1 año
- `packages/web/src/server/rest/mcp-oauth.ts:62-68` usa la **primera** entrada de
  `x-forwarded-for` (la escribe el cliente) al contrario que `clientIpFromHeaders`
  (`packages/kit/src/rate-limit/http.ts:24-31`); limitador en memoria por proceso.
  `packages/mcp-server/src/oauth/provider.ts:414-478, :46` (`clientTtlSeconds` = 365 d), sin
  `.max()` en `client_name`/URIs.
- Impacto: filas ilimitadas en `verification` (tabla compartida con magic links/OAuth de Better
  Auth), `client_name` arbitrario en la pantalla de consentimiento.
- Corrección: `clientIpFromHeaders` + limitador Redis de `@escaperoom/kit/rate-limit` (política
  `mcp-register`); TTL corto (1 h) hasta el primer `authorize`; `.max(120)` en nombre/URIs; purga
  periódica; o exigir sesión para registrar. Confirmada.

### A-5 / E-5 · MEDIA→ALTA · RGPD · `DELETE /api/me` incompleto
- `packages/shared/src/services/user-data-rights-prisma-store.ts:139-155`: solo `user.update`
  (email/name/image), `session.deleteMany`, `account.deleteMany`.
- Quedan: grants OAuth del MCP en `verification` (`mcp-oauth:*`, refresh 30 d renovable; solo se
  mira `revoked-grant:<grantId>`), `verification` de magic links vigentes, `invitation.email`,
  `accessKey.email` si fue participante, `termsAcceptance.ipAddress/userAgent`,
  `user.stripeCustomerId/stripeAccountId`, `member` (sigue siendo miembro/owner de organizaciones),
  `audioAsset.originalFilename`, avatar en S3 si `image` era key propia. `anonymizedEmail(randomUUID())`
  contradice el comentario ":17 únicos por userId".
- Corrección: ampliar la transacción (`verification.deleteMany` por email y por `userId` en el
  JSON de grants + `revoked-grant` por grantId, `invitation.deleteMany`, `member.deleteMany` con
  guardia de único owner, hash inmediato en `termsAcceptance`, borrar avatar, limpiar
  `stripeCustomerId`); documentar en `user-data-rights.ts` qué se conserva y por qué (facturación);
  test de integración Prisma que compruebe ausencia de PII tras el borrado. Confirmada.

### A-6 / D-5 · MEDIA · seguridad · refresh token rotado reutilizado no revoca la familia
- `packages/mcp-server/src/oauth/provider.ts:631-646`: `store.take` devuelve `null` → `invalid_grant`
  y fin. OAuth 2.1 §4.3.1: detección de reutilización ⇒ `revokeGrant(grantId)`.
- Corrección: guardar `used-refresh:<hash> → grantId` con el TTL del refresh; al verlo, revocar.
  Confirmada.

### A-7 · MEDIA · legal · IP de `termsAcceptance` la declara el cliente
- `packages/web/src/server/rest/legal-acceptance.ts:17-23` (primera entrada de `x-forwarded-for`).
- Corrección: `clientIpFromHeaders` de `@escaperoom/kit/rate-limit/http` (también en A-4). Confirmada.

### A-8 · MEDIA · incompleto · rutas de specs/13 ausentes o en otra ruta
- Faltan `PATCH /api/me`, `GET /api/me/purchases`, `GET /api/me/rooms`, `POST /api/organizations`,
  `POST /api/organizations/:orgId/members`, `POST /api/rooms`, `PATCH/DELETE /api/rooms/:roomId`,
  `GET /api/rooms/:roomId/access` (ver B-4), `POST /api/events/:id/sessions[/…/groups]`, §6.3
  grabaciones, §8 `GET /api/sessions/:id[/progress]`; `Idempotency-Key` (§1) no existe; el webhook
  vive en `/api/stripe/webhook` y specs/13 §7 + `docs/reference/seguridad.md` dicen
  `/api/webhooks/stripe`; no hay emisión de API keys (§1). Las invitaciones a organización solo
  existen vía `/api/auth/organization/*` de Better Auth **sin** `sendInvitationEmail` (nunca llegan).
- Corrección: decidir por ruta (implementar o marcar descartada en la spec); implementar
  `PATCH /api/me` y organizaciones/miembros con email; corregir docs del webhook. Confirmada.

### A-9 · MEDIA · seguridad/rendimiento · `POST /api/onboarding/rooms` sin cuota
- `app/api/onboarding/rooms/route.ts:14`, `server/rest/onboarding.ts:95-120`: sin `withRateLimit`;
  parsea y valida el fixture Rey Aldric en cada llamada y persiste un doc Yjs completo; errores sin
  `Cache-Control: no-store`; validación a mano (única ruta sin Zod).
- Corrección: política `onboarding-room-create` (5/h por usuario); memoizar `loadRoomPackage` del
  fixture (solo está memoizado el JSON crudo); Zod + `NO_STORE`. Confirmada.

### A-10 · MEDIA · rendimiento · sesión consultada dos veces por petición limitada
- `packages/web/src/server/rate-limit.ts:104-113, 140-152`: `defaultResolveUserId` resuelve el actor
  (sesión + user + member) y luego el handler lo vuelve a resolver. tRPC lo evita (`context.ts:60-63`).
- Corrección: `withRateLimit` resuelve una vez e inyecta el actor, o `WeakMap<Request, Promise<Actor>>`
  en `context.ts`. Confirmada.

### A-11 · MEDIA · mala práctica · fallo de infraestructura = "anónimo" en silencio
- `packages/web/src/server/context.ts:12-19`: `catch { return ANONYMOUS_ACTOR; }`. Con Postgres caído
  o `BETTER_AUTH_SECRET` mal, todo responde 401 sin traza.
- Corrección: `logger.error`, distinguir "sin sesión" de error (lanzar; rutas públicas toleran).
  Confirmada.

### A-12 / E-17 · MEDIA · seguridad/mala práctica · `cover-image` fuera del patrón y sin sniff
- `packages/web/src/app/api/rooms/[roomId]/cover-image/route.ts:32-72`: Prisma + storage directos
  en la `route.ts` (única así, sin test); `contentType: file.type` sin magic bytes aunque
  `packages/kit/src/storage/validation.ts` ya tiene `sniffImageMime` (sin consumidores); no filtra
  `deletedAt`; sin cuota; borra el objeto anterior **antes** de confirmar el `update`.
- Corrección: `rest/room-cover.ts` + servicio en `shared` con `sniffImageMime`, orden
  `putObject → update → deleteObject(old)`, `withRateLimit`, test. Confirmada.

### A-13 · BAJA · seguridad · `authorize` como redirector abierto para clientes DCR
- `rest/mcp-oauth.ts:117-121`, `provider.ts:497-540`: errores "seguros" redirigen 302 a cualquier
  `https://` registrado por DCR abierto → URL de phishing con dominio de confianza.
- Corrección: para clientes DCR no verificados, mostrar pantalla con el error y enlace explícito
  en vez de 302 automático. Confirmada.

### A-14 · BAJA · seguridad · `redirect_uri` opcional al canjear el código
- `provider.ts:618-621`: `if (redirectUri && …)`. OAuth 2.1 §4.1.3 exige repetirla si se envió.
  PKCE mitiga. Corrección: exigirla cuando `record.redirectUri` vino explícita. Confirmada.

### A-15 · BAJA · rendimiento · `verification` crece con tokens caducados del MCP
- `server/mcp-oauth.ts:24,49`, `mcp-oauth-store.ts`: access (1 h) y `revoked-grant` (30 d) quedan
  hasta que algo los purgue. Corrección: job en `@escaperoom/worker`
  (`identifier LIKE 'mcp-oauth:%' AND expiresAt < now()`). Plausible.

### A-16 · BAJA · información · `POST /api/contact` devuelve el error SMTP
- `packages/shared/src/services/contact.ts:116-121`. Corrección: mensaje fijo + `logger.warn`. Confirmada.

### A-17 · BAJA · mala práctica · Google configurado con credenciales vacías
- `lib/auth.ts:16-21` (`?? ""`). Corrección: incluir el proveedor solo si hay ambas variables. Confirmada.

### A-18 · BAJA · rendimiento · moderación lista toda la cola para contar
- `moderation.ts:713-716, 650-657, 794`. Corrección: `countPendingByTarget(keys[])` agregado y
  `EXISTS`. Confirmada.

### A-19 · ver E-4 (validación de entorno).

### A-20 / D-6 · BAJA · seguridad · `/mcp/creator` con cookie sin comprobar `Origin`
- `server/mcp-oauth.ts:60-63`, `packages/mcp-server/src/transports/http.ts:73-99`: CSRF mitigado de
  facto por `Content-Type`/`Accept` obligatorios (preflight), pero depende del SDK.
- Corrección: si la identidad viene de cookie, exigir `Sec-Fetch-Site: same-origin` u `Origin` =
  issuer (mismo criterio que `publish-confirm.ts`); `enableDnsRebindingProtection` + `allowedHosts`
  en `startHttpServer`. Plausible.

### A-21 · BAJA · auditoría admin · retirar un tramo no deja autor
- `admin-prisma-store.ts:54-57` (`closeTier` solo `activeUntil`). Corrección: `closedBy` o
  `logger.info({actor, route, target})` en el wrapper `handle()` de admin. Confirmada.

### A-22 · MEJORA · duplicación y contrato de error inconsistente en `server/rest/*`
- ≈20 ficheros reimplementan `NO_STORE`, `errorResponse`, `readJson` (3 variantes), `handle`,
  `queryOf`. `VALIDATION_ERROR` es 400 en `room-publish`, `room-reviews`, `onboarding`,
  `publish-confirm` y 422 en el resto; JSON roto es `BAD_REQUEST`/`VALIDATION_ERROR`/`INVALID_JSON`
  según ruta; `room-draft`, `room-publish`, `room-reviews`, `rooms-list`, `onboarding`,
  `publish-confirm` no ponen `no-store` en errores/privados. `reviews` usa `UNAUTHENTICATED`, el
  resto `UNAUTHORIZED`.
- Corrección: `server/rest/_http.ts` (`readJson({allowEmpty})`, `errorResponse`, `queryOf`,
  `handleDomainErrors(ErrorClass, STATUS_BY_CODE)`); fijar en specs/13 §1 los códigos; test de
  contrato que recorra `app/api/**` con cuerpo `{` como hace `admin-audit`. Confirmada.

### A-23 · MEJORA · cabeceras
- Sin `report-to` en la CSP (Sentry lo admite); CSP de API solo en `/api/:path*` (no `/.well-known/*`
  ni `/mcp/*`); falta `Cross-Origin-Resource-Policy`; sin `NEXT_PUBLIC_COLYSEUS_URL` la CSP de
  producción autoriza `ws://localhost:2567`. `style-src 'unsafe-inline'` (F-30) documentar como deuda.

### A-24 · MEJORA · menores
- `app/api/me/route.ts:16-30`: `auth.api.getSession` directo, `include: organization` completa y todas
  las `creditAccount` para 3 campos; sin `no-store`.
- `rest/room-draft.ts:126`: `Number(limitParam)` → `NaN` silencioso.
- `rest/access-key-cards.ts:143-147`: `getDownload` recibe `resolveActor` y no lo usa.
- Documentar en el README del MCP que un token de sesión `bearer` en `/mcp/creator` da `invalid_token`.

---

## 4. Área B — pagos, compras, créditos, claves, eventos, reseñas, mail, audio IA, creator-chat

### B-1 · ALTA · seguridad · precio de evento manipulable tras `payment_failed`
- `events.ts:545-553` (guard solo si `paid` o `checkoutRef !== null`), `:644-653`
  (`markCheckoutFailed` pone `checkoutRef: null` al primer `payment_intent.payment_failed`),
  `:626-637` (`markPaid` no compara `session.id` con `checkoutRef` ni `amount_total` con el precio),
  `stripe-webhook.ts:76-81`.
- Escenario: checkout para 1 jugador → tarjeta rechazada → `checkoutRef = null` →
  `PATCH /api/events/:id {playersPlanned: 100000}` pasa → reintento en la **misma** Checkout Session
  (viva 24 h) → `checkout.session.completed` → evento activo con 100 000 asientos por el precio de 1.
  Sin fila `purchase` (B-8) ni siquiera queda constancia del importe.
- Corrección: congelar importe/jugadores al abrir el checkout (mejor: `purchase` `event_credits`
  `pending` con `amountCents`); en el webhook comprobar `session.id === checkoutRef` y
  `amount_total === importe congelado`; no liberar `checkoutRef` en `payment_failed`, solo en
  `checkout.session.expired`; `expire()` de la sesión antigua al reabrir. Confirmada (lógica);
  explotación plausible.

### B-2 · ALTA · incompleto · evento pagado sin sesiones ni claves
- `events.ts:626-637` escribe `status: "active"`; la creación de `gameSession` + claves vive solo en
  `AccessKeyService.activateEvent` (`access-keys.ts:739`), que llama a `events.activate` → exige
  `draft` → `EVENT_NOT_EDITABLE`. `events.test.ts:310-316` lo afirma como correcto. En `redeem.ts:173-175`
  `pickBalancedSession` → `null` → `SESSION_FULL`. specs/13 §6.1/§7 dicen que `activate` genera
  sesiones y que el webhook llama a `activate`. La UI aún no cablea `/activate` ni `/checkout`.
- Corrección: `markPaid` solo `payment.status = paid` (queda `activatable`), y el organizador llama a
  `POST /activate` con su `keyPlan`; o el webhook invoca `activateEvent` con plan por defecto.
  Actualizar el test. Confirmada.

### B-3 · ALTA · integridad financiera · Transfer sin idempotencia
- `stripe-gateway.ts:112` (`stripe.transfers.create` sin `{idempotencyKey}`; grep 0 resultados),
  `purchases.ts:273-289`, `purchases-prisma-store.ts:516-521` (`attachTransfer` `.catch(() => null)`),
  `room-license.ts:494-511`, `room-license-prisma-store.ts:861-866`.
- Si `attachTransfer` falla o el proceso muere entre `createTransfer` y el `update`, `transferRef`
  queda `null`; el reintento de Stripe (el webhook hace `dedupe.forget` en cualquier error) vuelve a
  transferir. Dos eventos distintos (`completed` y `async_payment_succeeded`) tampoco se deduplican.
- Corrección: `idempotencyKey: transfer_${purchaseId}`; no tragar el error; comprobar
  `stripe.transfers.list({transfer_group})` antes; persistir `stripeTransferId` en la misma operación
  condicional que la liquidación. Confirmada.

### B-4 · ALTA · incompleto · la compra B2C no concede nada
- `purchase.playSessionStartedAt/playSessionColyseusId` solo en schema y stores (nunca se escriben);
  no existe `GET /api/rooms/:roomId/access`; `grep purchase packages/colyseus-server/src` → 0;
  `packages/e2e/tests/purchase-flow.spec.ts:15` sigue en `test.fixme("Pendiente del ticket 5.1")`.
- Corrección: `/api/rooms/:roomId/access` + gate en el matchmake de Colyseus (`onAuth` de `game`,
  ver C-4) que consuma `playSessionStartedAt` con escritura condicional `IS NULL`; desbloquear el e2e.
  Confirmada.

### B-5 · ALTA · incompleto · reembolsos
- `stripe-webhook.ts:112-123`, `purchases.ts:297-300`: `charge.refunded` solo cubre `room`, no
  revierte la Transfer (`transfers.createReversal`), trata parciales como totales, y para
  `event_credits` no bloquea activaciones (specs/13 §7).
- Corrección: reversal proporcional por `stripeTransferId`/`transfer_group`; `refunded` solo si
  total; `event_credits` → `payment.status = refunded` + bloquear `activate`/`generateKeys`;
  `reverseTransfer` en `PaymentGateway`. Confirmada.

### B-6 · ALTA · coste · creator-chat sin tope por usuario ni rate limit
- `server/creator-chat/handler.ts:557-575`, `config.ts:267-272`, `app/api/creator-chat/route.ts`
  (sin `withRateLimit`), `rate-limit.ts:636-690` (sin política). Topes (`maxTurns` 60,
  `maxTokens` 1,5 M) son **por conversación**; cada `POST` sin `conversationId` crea otra.
- Corrección: política `creator-chat` (usuario + IP), tope de conversaciones activas por usuario,
  presupuesto diario/mensual persistido (Redis o `creditMovement`). Confirmada.

### B-7 · MEDIA · coste · preview de audio IA gratis e ilimitada
- `audio-generation.ts:802-814` (solo `hasSufficientBalance(cost)`, nunca descuenta; hasta 5 000
  caracteres a ElevenLabs), `app/api/audio/generate/preview/route.ts` sin `withRateLimit`.
- Corrección: cuota por usuario (20/10 min), caché por hash de texto, o cobrar la preview con
  reembolso al confirmar. Confirmada.

### B-8 · MEDIA · incompleto · sin `purchase` para `event_credits`; `startCheckout` reabre sin límite
- `events.ts:585-617`: solo `event.config.payment` (JSONB); `purchase.eventId` nunca se rellena;
  `startCheckout` no comprueba `checkoutRef !== null` (varias Checkout Sessions cobrables 24 h). El
  email de confirmación recalcula el importe desde el snapshot, no el cobrado. specs/18 §3.3 exige
  retención de `purchase`.
- Corrección: `purchase` `event_credits` `pending` con `amountCents` al abrir (reusar
  `chkPurchasePaidNeedsStripe`), rechazar/expirar checkout abierto, liquidar por `purchaseId`. Confirmada.

### B-9 · MEDIA · robustez · Transfer a cuenta Connect sin onboarding completo
- `purchases.ts:275-287` (`findCreatorAccountForVersion` solo mira `stripeAccountId !== null`, que se
  crea al *iniciar* onboarding), `stripe-webhook.ts:62-66,156-168`: si `createTransfer` lanza, 500 en
  bucle (~3 días) y `confirmations.enqueue` nunca se ejecuta aunque la compra ya esté `succeeded`.
- Corrección: encolar el email justo tras `settlePurchase`; comprobar `getAccountStatus === "complete"`;
  mover la Transfer a un job propio con reintentos (`succeeded` con `transferRef null` como cola).
  Plausible.

### B-10 · MEDIA · seguridad · `gift-copy` enumera usuarios e inserta salas en cuentas ajenas
- `room-license.ts:537-546` (`RECIPIENT_NOT_FOUND` 404 vs 201), `app/api/rooms/[roomId]/gift-copy/route.ts`
  sin rate limit, sin aceptación del receptor.
- Corrección: respuesta indistinguible (202) o invitación pendiente de aceptar; cuota por usuario;
  límite por destinatario. Confirmada.

### B-11 · MEDIA · carrera · `event.config` JSONB con read-modify-write
- `events.ts:556-576, 609-614`, `events-prisma-store.ts:861-874`: condición solo `status = expected`;
  `PATCH` concurrente con `startCheckout` puede pisar `checkoutRef` (salta el guard de B-1) o perder
  `locale`/`recordingAcceptedAt`.
- Corrección: versión optimista o `jsonb_set` atómico; o `payment.*` a columnas. Plausible.

### B-12 · MEDIA · seguridad · `checkout.session.completed` sin `payment_status`
- `stripe-webhook.ts:54-86`: no mira `session.payment_status === "paid"`; no maneja
  `async_payment_succeeded/failed` ni `checkout.session.expired`. Relevante si se habilitan métodos
  asíncronos (SEPA, etc.). Corrección: liquidar solo con `paid`; manejar los tres eventos. Plausible.

### B-13 · MEDIA · rendimiento · `hasPlayedOrPurchased` seq scan sobre `progressEvent`
- `reviews-prisma-store.ts:372-378` (`WHERE pe."playerId" = …`); `progressEvent` solo indexa
  `groupId` y `(sessionId, createdAt)`. Se ejecuta en cada detalle de sala con sesión.
- Corrección: `@@index([playerId])` (o `(playerId, sessionId)`). Confirmada.

### B-14 · MEDIA · rendimiento · `invitationStats` sin índice en `regeneratedFrom`
- `invitations-prisma-store.ts:513-524` (`NOT EXISTS … r."regeneratedFrom" = k.code`); el dashboard lo
  llama en cada sondeo. Corrección: `@@index([regeneratedFrom])`. Confirmada.

### B-15 · ver A-2.

### B-16 · BAJA · incompleto · autocompra y doble compra de la misma versión
- `purchases.ts:180-190` (sin `room.authorId !== actor.userId`; licencias sí lo tienen),
  `purchases-prisma-store.ts:465-471` (`findOwnedPurchase` solo `succeeded`; sin índice único parcial
  `(userId, roomVersionId) WHERE status='succeeded'`). Confirmada.

### B-17 · BAJA · incompleto · `capacity` truncada a 32 767 con `MAX_EVENT_PLAYERS = 100 000`
- `access-keys.ts:498`, `events.ts:44`. Corrección: validar `playersPlanned ≤ sesiones × 32 767` o
  `capacity` a `integer`. Confirmada.

### B-18 · BAJA · seguridad · créditos de organización por `activeOrganizationId` sin revalidar
- `credits-prisma-store.ts:386-390`, `actor.ts:36-43`: un miembro expulsado conserva
  `activeOrganizationId` en sesión y sigue gastando créditos de la organización (`dpaGate` sí revalida).
  Corrección: revalidar `member` en `consume`. Plausible.

### B-19 · BAJA · `stripeWebhookEvent` nunca se purga; reembolsos parciales (ver B-5). Job
  `receivedAt < now() - 30 d`.

### B-20 / F-15 · BAJA · `decodeURIComponent` sobre `params` ya decodificados → `URIError` 500
- `rest/access-keys.ts:492, 513, 525`; `app/[locale]/(play)/playtest/[token]/page.tsx:44`;
  `(play)/invitations/[code]/confirm/page.tsx:24`. `confirm` es público. Corrección: quitar el
  decode o try/catch → 404/"enlace no válido". Confirmada.

### B-21 · BAJA · URLs de retorno de Stripe inconsistentes
- `stripe-gateway.ts:325-326, 347-348` (`NEXT_PUBLIC_APP_URL ?? ""` → URL relativa que Stripe rechaza)
  vs `app/api/purchases/room-checkout/route.ts:134-137` (`publicOrigin(request)`); `success_url` de
  `room` sin `roomId` → `(play)/checkout/confirmation/page.tsx:27-28` no puede enlazar la sala.
- Corrección: los tres `create*Checkout` reciben `successUrl/cancelUrl` construidas con
  `publicOrigin`. Confirmada.

### B-22 · BAJA · cuenta Connect no idempotente
- `creator-connect.ts:99-104`: dos `POST /api/me/stripe-connect` concurrentes → cuenta Stripe huérfana.
  Corrección: `updateMany({where: {id, stripeAccountId: null}})` y descartar si `count === 0`. Confirmada.

### B-23 · MEJORA · invitaciones encoladas una a una (hasta 1 000 `await`)
- `invitations.ts:263-269`. Corrección: `queue.addBulk`. Confirmada.

### B-24 · MEJORA · `startLicenseCheckout` carga `package` JSONB completo para leer `roomId`
- `room-license.ts:286-301`, `room-license-prisma-store.ts:764, 808-822`. Corrección: `findVersionRef`
  ligero. Confirmada.

### B-25 · BAJA · creator-chat: resultados de tools sin marcar como datos; CSRF laxo
- `system-prompt.ts:1237-1262`, `orchestrator.ts:1013-1018`, `handler.ts:536-539`
  (`if (site && site !== "same-origin")` deja pasar peticiones sin cabecera). El draft puede venir de
  un fork licenciado/regalado por otro creador (B-10). `publish` exige confirmación humana, así que
  el daño se acota al propio draft y al presupuesto.
- Corrección: instrucción explícita + delimitadores en `tool_result`; exigir `Sec-Fetch-Site`
  presente (o token CSRF) en `creator-chat` y `publish-confirm`. Plausible.

### B-26 · MEJORA · duplicación transversal (ver §8).

### B-27 · BAJA · docs/tests obsoletos
- `purchase-flow.spec.ts:8-15` (fixme "pendiente de 5.1"); comentarios "hasta que 5.1 cablee Stripe"
  en `purchases.ts:152`, `events.ts:155-157, 415`, `room-license.ts:268`, `audio-generation.ts:684-686`;
  specs/18 §3.3 dice que falta el job de purga de `analyticsEvent` cuando `analytics/partitions.ts`
  ya lo hace.

---

## 5. Área C — Colyseus, editor-sync (Yjs), LiveKit

### C-1 · ALTA · seguridad · `joinToken` reutilizable N veces dentro del TTL
- `packages/colyseus-server/src/rooms/event-room.ts:173-192` (`onAuth`), `join-token.ts:116-155`:
  sin `jti`, y `onJoin` no deduplica por `claims.playerId`.
- Impacto: un invitado abre N pestañas, llena `playerCapacity` (compañeros reciben `SESSION_FULL`) y
  controla varios avatares (rompe `simultaneous_plates` modo `stand`, `split_clue`).
- Corrección: en `onAuth`, si ya hay un cliente conectado con ese `playerId`, tratarlo como
  reconexión (cerrar el socket anterior y heredar `GamePlayerState`/inventario); `jti` + lista de
  usados por room como segunda barrera. Confirmada.

### C-2 · ALTA · incompleto · sin reconexión: inventario en un "fantasma" y host nunca reasignado
- `game-room.ts:367-375` (`onLeave` solo `connected = false`), `:344-365`, `:379-397`
  (`hostId` solo si vacío); `allowReconnection` no aparece en ningún sitio; solo
  `playtest-room.ts:64-69` reasigna host. Inventario indexado por `sessionId`; al volver, otro
  `sessionId` → jugador nuevo vacío. specs/11 §8 promete 60 s de gracia; el `joinToken` caduca a
  los 15 min, así que un desconectado tardío ni puede reentrar.
- Impacto: en lobby de evento, si cae el anfitrión nadie puede empezar; en partida, la `llave-oro`
  del desconectado deja la partida inganable.
- Corrección: `allowReconnection(client, 60)`; al expirar, reasignar host y purgar; en `EventRoom`
  mapear `claims.playerId → sessionId` para heredar inventario (encaja con C-1). Confirmada.

### C-3 · ALTA · seguridad/incompleto · `allowVideo`/`name`/`role` del token LiveKit los decide el cliente
- `media/join-options.ts:15-22`, `media/service.ts:59`
  (`const allowVideo = input.allowVideo ?? config.allowVideoByDefault;`), `game-room.ts:248-250`;
  `EventRoom` no lee `events.config.allowVideo` (specs/12 §4: default `false`, solo el organizador).
- Impacto: en un evento educativo con cámara desactivada, cualquier alumno pide `{allowVideo:true}` y
  recibe JWT con `canPublishSources: [MICROPHONE, CAMERA]`; `name` arbitrario suplanta el nombre en
  LiveKit.
- Corrección: `allowVideo = input === false ? false : política`; `EventRoom` pasa el `allowVideo`
  del evento (cargarlo en `loadEventPackage`), `name = claims.displayName`, `role` derivado de
  `spectators`; ignorar `name`/`role` del payload en rooms autenticadas. Confirmada.

### C-4 · ALTA · seguridad · rooms `game` y `lobby_test` sin `onAuth`
- `server.ts:38-39`; `lobby-test-room.ts:55-69`; `game-room.ts:344`. Matchmaker con
  `Access-Control-Allow-Origin: *`. `lobby_test` responde `request_media_token` con `canPublish: true`
  a cualquiera y no pasa por `MessageRateLimiter`.
- Impacto: con la URL pública (está en la CSP) se crean rooms `game` sin compra (specs/11 §1 exige
  `purchases.play_session_started_at`, ver B-4), miles de rooms vivas (RoomSession + paquete por
  room) y tokens LiveKit publisher → coste de SFU/TURN gratis.
- Corrección: registrar `lobby_test` solo fuera de producción; `onAuth` en `game` con token firmado
  por web (compra/invitación) como en `event`; `maxClients`/límite de rooms por IP; exigir token para
  `request_media_token`; `getCorsHeaders` restringido a `APP_URL`. Confirmada.

### C-5 · ver E-4.

### C-6 · MEDIA · validación autoritativa · `plate_state {active:false}` a distancia y cruce sin puerta
- `room-session.ts:774-781` (`setPlate` solo valida posición si `active`), `game-room.ts:442-449`
  (`nearDoor = door === undefined || …`: si la puerta vive en la habitación destino no hay distancia).
- Corrección: exigir estar sobre la placa también para desactivar (o solo la que ese jugador activó);
  buscar la puerta en ambos sentidos. Confirmada.

### C-7 · MEDIA · `hint_request` sin comprobar habitación ni estado
- `game-room.ts:676-700`, `hints/hints.ts:144-191`: no pasa por `accessiblePuzzle`; se leen pistas de
  puzzles `locked` de fases posteriores y se queman pistas de puzzles resueltos. Corrección:
  `accessiblePuzzle` + rechazar `locked`/`solved`. Confirmada.

### C-8 · MEDIA · DoS · `maxMessagesPerSecond` de Colyseus en `Infinity`
- `game-room.ts:187-206` (`on`), `lobby-test-room.ts:55-69`. El observador se rechaza **antes** del
  limitador y recibe `PERMISSION_DENIED` por cada mensaje (documentado en `seguridad.md` §2 como
  deliberado; discrepo en la consecuencia: inunda a velocidad de línea con `client.send` de vuelta).
  `lobby_test` firma un JWT por `request_media_token` sin límite.
- Corrección: `override maxMessagesPerSecond = 60` en `GameRoom`/`LobbyTestRoom`; contar al
  observador en el limitador o cortar tras N rechazos. Confirmada.

### C-9 · MEDIA · rendimiento · paneles reenviados completos en cada tick (4 Hz)
- `game-room.ts:702-705, 723-774, 837-848`: `handleTick` → `publish` → `syncState(); refreshOpenPanels();`
  incondicional; `refreshOpenPanels` recalcula `puzzleView` (tableros) y `client.send` por panel
  abierto cada 250 ms; `syncState` hace `Object.entries` + `JSON.stringify` por flag por tick;
  `state.clock` cambia cada tick (patch a todos).
- Corrección: refrescar paneles solo si el resultado trae efectos/eventos o cambió
  `puzzleStates`/inventario (versión); nunca desde `handleTick` salvo efectos; `clock` a 1 s o por
  mensaje. Confirmada.

### C-10 · MEDIA · seguridad · WS del editor con cookie y sin allowlist de `Origin` si falta la variable
- `packages/editor/src/sync/server.ts:478-481`
  (`if (options.allowedOrigins && origin && …)`), `web/src/server/editor-sync/server.ts:30-40`,
  `main.ts:32`. Cookies `SameSite=Lax` viajan en upgrades GET desde otro sitio.
- Impacto: cross-site WebSocket hijacking del borrador del creador si `EDITOR_SYNC_ALLOWED_ORIGINS`/
  `NEXT_PUBLIC_APP_URL` no están en el proceso `editor-sync`.
- Corrección: fallar cerrado (sin lista en producción, rechazar todo `Origin` ≠ host; exigir
  `Origin` presente con cookie); opcionalmente ticket corto de un solo uso emitido por REST. Plausible.

### C-11 · MEDIA · DoS · doc Yjs sin tope de tamaño, sin cap de conexiones ni cadencia
- `editor/src/sync/server.ts:160-163, 357-366, 415-455`: `maxPayload` 1 MB + 1 KB por mensaje, pero
  sin límite de mensajes; cada `syncStep1` fuerza `encodeStateAsUpdate` del doc entero; sin cap de
  `room.connections` por usuario.
- Corrección: tope de bytes por doc tras compactar, cap de conexiones por `userId`, rate limit por
  socket (mensajes/s, step-1/min). Plausible.

### C-12 · BAJA · `failRoom` expulsa a todos por un update reproducible
- `sync/server.ts:230-237, 260-273`, `room-draft.ts:361-376`: `maxPayload` (1 MB + 1 KB) >
  `DEFAULT_MAX_UPDATE_BYTES` (1 MB): un update entre ambos se aplica al doc vivo y luego
  `appendUpdate` lanza `PAYLOAD_TOO_LARGE` → `failRoom` cierra todas las conexiones con 4500; al
  reconectar el cliente reenvía → bucle.
- Corrección: validar tamaño/`isValidYjsUpdate` **antes** de `Y.applyUpdate`; cerrar solo ese socket
  (1007/1009); `maxPayload ≤ maxUpdateBytes`. Confirmada.

### C-13 · MEDIA · incompleto · specs/11 sin implementar
- `constants.ts:82-104`, `game-room.ts`: faltan `set_ready`, `leave`, `pause`/`resume`, `kick`
  (§4.1/4.5); broadcasts `player_joined/left`, `phase_changed`, `timer_update` (§6); **ninguna**
  emisión de analítica desde Colyseus (§10; `grep analytics` vacío); gate de compra B2C (§1);
  specs/12 §1.1 (observador con token de solo suscripción) contradice specs/11 (rechazado). Fijar una.
- Corrección mínima: `kick` + reasignación de host + `player_left`; analítica por el `onMilestone`
  existente. Confirmada.

### C-14 · BAJA · `MessageRateLimiter.check` consume el cubo `total` aunque el cubo por tipo rechace
- `message-rate-limit.ts:112-137, 145-157`. Corrección: evaluar primero el cubo por tipo; `peek` +
  `commit`. Confirmada.

### C-15 · BAJA · carrera de cupo en `EventRoom.onAuth`; `void this.setMetadata`
- `event-room.ts:179-190, 128`: el cupo se evalúa en `onAuth` (el cliente no está en `clients` hasta
  `onJoin`); `maxClients = capacidad + 4`. `setMetadata` rechazado en silencio (la ruta
  `/internal/events/:id/progress` filtra por esa metadata). Corrección: contador de `onAuth` en
  vuelo o `maxClients = playerCapacity` + observadores por `reservedSeat`; `await`/log. Plausible.

### C-16 · BAJA · `POST /internal/playtests` devuelve `err.message` interno; registro sin tope global
- `playtest/http.ts:88-97`, `playtest/registry.ts:47-65` (O(n) por registro, 5 por autor, sin cap
  global ni sweep periódico). Confirmada.

### C-17 · BAJA · `void sendMediaTokenToClient` sin `catch` → unhandled rejection
- `game-room.ts:248-250`, `lobby-test-room.ts:62-64`, `media/token.ts:77-94`. Confirmada.

### C-18 · BAJA · `sanitizeName` no quita caracteres de control/zero-width; `players` crece sin límite
- `game-room.ts:921-925, 344-375`. Reutilizar `sanitizeChatText`; purgar desconectados tras la gracia
  (C-2). Confirmada.

### C-19 · MEJORA · `GameRoom` god class (946 líneas) y búsquedas lineales en el camino caliente
- `roomPackage.puzzles.find(...)`/`objects.find(...)!` en `handleMove`, `handleCombine`, `handlePlate`,
  `handleSplitView`, `accessiblePuzzle`, `doorOpened`, `publish`; `RoomSession` ya tiene
  `puzzlesById`/`objectsById` sin exponer; `syncState` compara inventarios con `join("\u0000")` por tick.
- Corrección: extraer `GameStateProjector` y `GameMessageRouter`; exponer índices; `!` →
  `INVALID_STATE`. Confirmada.

### C-20 · MEJORA · logging inconsistente en colyseus-server
- `main.ts` con `console.log`; rooms no registran rechazos de token ni errores de `onCreate`; Sentry
  inicializado pero nada captura excepciones de handlers. Corrección: `logger.child({roomId})` y
  `captureException` en el envoltorio `on()`. Confirmada.

### C-21 · BAJA · `restoreInRoom` calcula el plan sobre BD y lo aplica sin bloquear ediciones
- `sync/server.ts:333-355`; awareness sin filtrar `clientID`s ajenos (`:368-374`). Corrección: modo
  solo lectura durante la restauración o plan sobre `encodeStateAsUpdate(room.doc)`. Plausible.

---

## 6. Área D — esquemas, motor de reglas, plantillas, validador, editor (lógica), MCP

### D-1 · ALTA · DoS · `RoomPackage` sin topes de tamaño
- `schemas/common.ts:10-13` (`GridSchema` solo `positive()`), `schemas/roompackage.ts:30`
  (`players.max` sin techo), `schemas/puzzle.ts` (`pairs`, `recipes`, `fragments`, `plates`,
  `cellTypes`, `solution` sin `.max()`), `schemas/world.ts:9` (`rle`), `validator/validate.ts:167-177`
  (un bucle de validador por cada n entre `players.min` y `max`), `mcp-server/src/tools/validate.ts:23-27`
  (`playerCounts` sin `.max()`), `editor/src/room-doc/serialize.ts:212-215`
  (`new Array(cols*rows)` en cada `roomDocToPackage`), `content.ts:120-126`,
  `templates/sliding-puzzle.ts:127-138` (O(n²)), `templates/pipes.ts:583-658`, `loader/load.ts:441`.
- Impacto: un creador autenticado (editor, `POST /api/rooms/:id/validate`, cualquier tool MCP porque
  `mutateDraft` valida en dry-run, `publish()`) bloquea el event loop minutos u OOM con
  `players.max = 1e9`, `define_subrooms` 1e5×1e5, `sliding_puzzle.grid` 3000×3000, o
  `validate({playerCounts:[1..1e6]})`. Una sola llamada basta.
- Corrección: `GridSchema` `cols/rows ≤ 256`; `players.max ≤ MAX_PLAYERS_PER_ROOM_CEILING`
  (`platform-settings.ts:16`) con `refine(min ≤ max)`; `.max()` en arrays y strings; `playerCounts`
  `z.array(int().min(1).max(8)).max(8)`; clamp defensivo en `resolvePlayerCounts`;
  `setSubRoomGrid`/`defineSubRooms` rechazan rejillas grandes; inversiones del deslizante O(n log n).
  Confirmada.

### D-2 · ALTA · DoS · timer periódico con `durationSec` ínfimo
- `schemas/rules.ts:75` (`durationSec: z.number().optional()`, sin mínimo), `engine/engine.ts:540-552`
  (`while (timer.remainingSec <= 0) { … remainingSec += durationSec }`), tick cada 250 ms en
  `game-room.ts:252, 702-705`.
- Impacto: `start_timer {durationSec: 1e-9}` + `on_timer` ⇒ ~2,5·10⁸ eventos por tick, cada uno con
  `evaluateEvent` y `structuredClone`; el proceso Colyseus se cuelga para todas las partidas. El
  validador no lo detecta.
- Corrección: `durationSec: z.number().min(1)`; en `advanceTimers` tope de eventos por tick; test con
  `durationSec: 0.001` y `tick(60_000)`. Confirmada.

### D-3 · MEDIA · incompleto · encoger una habitación deja objetos fuera y la sala publicada explota
- `editor/src/room-doc/content.ts:100-108, 114-127` (`pruneTilesOutside` solo tiles),
  `validator/checks.ts:199-260` (sin check de posición ∈ rejilla), `loader/load.ts:118, 264, 473-477`
  (lanza), `room-publish.ts:579` (publica sin `toRuntimeModel`), `web/src/lib/game-model.ts:17`.
- Corrección: check `geometry` (objetos, `spawnPoints`, `decorations`, `torch`, `hidingSpot`,
  `plates`, `viewpoints.zone`, `puzzle.position` dentro de su rejilla); `publish()` ejecuta
  `toRuntimeModel` como smoke test. Confirmada.

### D-4 · ver A-4. · D-5 · ver A-6. · D-6 · ver A-20.

### D-7 · MEDIA · bug · `memory` con símbolos repetidos entre parejas
- `templates/memory.ts:224-233, 262-264, 275-280, 383-396`: `pairKeyForSymbol` indexa por símbolo;
  `isCoherentMemoryDefinition` solo exige ids únicos. Dos parejas con el mismo símbolo se resuelven a
  la vez y las otras dos cartas aparecen `matched`.
- Corrección: `pairId` por carta en `shuffleMemoryCards` y emparejar por `pairId`; o exigir símbolos
  únicos en coherencia + `checkReferences`. Confirmada.

### D-8 · MEDIA · incompleto · `memory` `per_player`: rotación de turno desconectada
- `memory.ts:166-169, 424-429` lee `(def as {players?: string[]}).players`, campo que el esquema Zod
  elimina; `room-session.ts:303, 794` no lo inyecta → `nextTurnOwner` `null` → el mismo jugador sigue
  volteando (specs/06 §2.6). `memory.test.ts:286` documenta el fallback como intencional.
- Corrección: `flipCard(state, def, cardId, actorId, now, {players})` con `RoomSession.players()`;
  eliminar casts a extensiones inexistentes. Confirmada.

### D-9 · MEDIA · rendimiento · oráculo `split_clue` exponencial y sin caché
- `templates/split-clue.ts:373-390` (`existsCoveringSubset` 2^viewpoints), `validator/oracles.ts:189-205`
  (se llama en cada `solve_puzzle` candidato de cada nodo del BFS, hasta 200 k estados).
- Corrección: memoizar por `${puzzle.id}|${playerCount}`; guarda a ~12 viewpoints. Confirmada.

### D-10 · MEDIA · incompleto · checks del validador que faltan
- `validator/checks.ts:133-261`: referencias en `dialog.conditions`, `defaultLanguage ∈ languages`,
  `players.min ≤ max` (solo la tool `create_room`), `object.initialState ∈ states` (el loader cae en
  silencio al sprite base), nº `spawnPoints ≥ players.max` (specs/08 §2.1), `hidingSpot.x/y`,
  símbolos únicos en `memory` (D-7), `durationSec > 0` (D-2), longitud de `code_lock.code` (hoy sale
  como "no resoluble").
- Corrección: invariantes estructurales a `RoomPackageSchema.superRefine`; cruzadas a
  `checkReferences`. Confirmada.

### D-11 · MEDIA · DoS · `delay` anidado sin límite → desbordamiento de pila
- `schemas/rules.ts:65-98` (`z.lazy` sin profundidad), `validator/model.ts:176-182`,
  `checks.ts:81-107`, `mcp-server/src/room-graph.ts:75-86`, `engine.ts:626-636`. JSON de ~1 MB
  (dentro de `DEFAULT_MAX_UPDATE_BYTES`) → `RangeError` → 500/INTERNAL.
- Corrección: profundidad ≤ 4 y `actions.length ≤ 64` en `superRefine`; `flattenActions`
  iterativo. Confirmada.

### D-12 · MEDIA · incompleto · gate de confirmación de mutaciones (specs/10 §1.1, ADR-010) no existe
- `mcp-server/src/tools/define.ts:44-53` promete que `destructiveHint` lo intercepta el gate de
  4.4/4.5; `server.ts:101-131` ejecuta directo; `grep confirm` vacío; tampoco existen `find_tools`/
  `tool_schema`/`run_tool`/`upload`. El pipeline real (validador incremental + `dryRun` opt-in) es
  razonable.
- Corrección: implementar el gate (`confirm: true` obligatorio para `MUTATION`) o actualizar
  specs/10, ADR-010 y el comentario. Confirmada.

### D-13 · BAJA · el check `assets` nunca corre por MCP ni en `publish()`
- `tools/validate.ts:32`, `room-publish.ts:579` (sin `assetManifest` → "Assets no comprobados").
  Corrección: inyectar `loadAssetManifest` en `CreatorMcpDeps` y `RoomPublishService`. Confirmada.

### D-14 · BAJA · la ruta crítica del informe incluye el código del candado
- `validator/validate.ts:405`, `oracles.ts:76`. Hoy solo lo ve el autor; cualquier pantalla futura de
  moderación/colaborador lo filtraría. Corrección: describir sin el secreto. Confirmada.

### D-15 · BAJA · comparación de respuestas no constante (`code-lock.ts:256`, `split-clue.ts:412,419`)
- Impacto práctico nulo (lockout + jitter de red). Higiene: `timingSafeEqual`. Confirmada.

### D-16 · BAJA · comentario de `code_lock` dice que la vista pública no incluye pistas y sí las incluye
- `code-lock.ts:149-150` vs `:162` (son ids de `HintDef`, no textos). Corregir comentario. Confirmada.

### D-17 · MEDIA · rendimiento · `useRoomPackage` re-serializa el doc entero en cada transacción
- `editor/src/room-doc/use-room-package.ts:16-18`, `serialize.ts:265-326`,
  `tool-controller.ts:206-227` (una transacción por celda del trazo). Cada `pointermove` con pincel
  → `roomDocToPackage` completo + re-render del runtime (ver F-21).
- Corrección: agrupar el trazo en una transacción hasta `up`; memoizar por colección
  (`observeDeep` por raíz). Plausible.

### D-18 · BAJA · rendimiento · motor: `structuredClone` del estado por regla y escaneos lineales
- `engine.ts:225, 279, 577, 264-266, 527-531, 43-45`. Despreciable a escala Rey Aldric; se multiplica
  con `once:false` y timers. Corrección: indexar reglas por `trigger.type`; clonar solo porciones.

### D-19 · MEJORA · validador re-filtra y reordena reglas por evento del BFS
- `validator/model.ts:644-648, 288-307, 743-796`. Precomputar `rulesByTrigger` en `RoomIndex`.

### D-20 · MEJORA · duplicación entre las 8 plantillas y nombres inconsistentes
- 8× `requiresSolved.length > 0 ? "locked" : "available"`, 8× guardas `solved`/`locked||failed`, 8×
  `isXSolvable` con el mismo prólogo; `code-lock.ts:291, 313` exporta `toPublicView`/`isSolvableGiven`
  sin prefijo (obliga a comentarios como `hidden-key.ts:95-97`).
- Corrección: `templates/base.ts` (`initialPuzzleState`, `guardPlayable`, `publicBase`); renombrar a
  `toCodeLockPublicView`/`isCodeLockSolvable`.

### D-21 · MEJORA · sin exhaustividad (`never`) en switches
- `engine.ts:394-508` (`applyAction`: acción nueva ignorada en silencio), `validator/model.ts:587-624`,
  `validate.ts:247-248`, `checks.ts:64-65, 103-104`, `room-graph.ts`.

### D-22 · MEJORA · strings mágicos y colisiones
- `"open"` literal (`engine.ts:404`, `model.ts:109, 706`); flags reservadas `game_started/
  game_ended/time_remaining` (`state.ts:36-42`); `ruleId: "__grant_item__"` (`engine.ts:222`); prefijo
  `decoy:` en `memory.ts:189, 405` (un creador con `symbol: "decoy:0"` nunca empareja); `symbol:<index>`
  sale al cliente en `matchedPairIds` (`memory.ts:359`).

### D-23 · BAJA · esquemas laxos donde ya existe validación mejor
- `LocalizedTextSchema` acepta cualquier clave (`isLanguageCode` sin usar), `audioUrl: z.string()`,
  `PositionSchema` no entera (el loader la rechaza), `code_lock.code: z.string()`, ids de `icon`/
  `sprite`/`tileset` sin patrón (`build-pack` sí lo exige). Compartir `ID_PATTERN` (`commands.ts:186`)
  en `schemas/common.ts`. Confirmada.

### D-24 · BAJA · sin ruta de migración del formato (`packageFormat`, doc Yjs sin versión)
- `roompackage.ts:13, 23`, `room-publish.ts:197, 571-576`, `serialize.ts:189`. Reservar
  `loadRoomPackage → migrate → parse` antes de la primera publicación real (ADR-028). Confirmada.

### D-25 · MEJORA · rate limiter MCP en memoria por proceso; `McpServer` con 21 tools por petición
- `mcp-server/src/rate-limit.ts:28`, `transports/http.ts:88-100` (cuerpo parseado dos veces).

### D-26 · BAJA · loader filtra spoilers menores y duplica `resolveLocalizedText`
- `loader/load.ts:329, 333` (`inventory` y `hidingSpot.contains` viajan al cliente),
  `:245-252` vs `shared/src/hints/localized-text.ts:34-59`. Proyectar `hasHidingSpot`/`inventoryCount`.
  Confirmada.

### D-27 · BAJA · hardening · `readFlatRecord` copia claves arbitrarias del `Y.Map`
- `editor/src/room-doc/doc-model.ts:107-113`. Zod 4.6.5 elimina `__proto__` propio, pero saltar
  `__proto__`/`constructor`/`prototype` en `readPlain` es barato. Plausible.

### D-28 · menores
- `tools/index.ts:55-56`: tool de ejemplo `get_featured_room` (0.10) en el toolset de producción.
- `game-runtime/scripts/build-pack.ts:126` (`as PackConfig` sin validar), `:311` condición imposible;
  `pack/svg.ts:205-230` rasteriza cada SVG 3 veces y `readKindFrames` secuencial; `pack/atlas.ts:87` O(n²).
- `shared/src/index.ts:4-10` reexporta `session`/`validator`/`templates` desde la raíz (sin
  consumidor hoy; retirar para evitar arrastres al bundle).
- `validate.ts:95-101`: aviso de truncamiento sin mencionar `clue_order`. Spec 05 §2.2 `repeatable`
  vs esquema `once`.

---

## 7. Área E — kit, worker, Prisma/migraciones, env, infra, scripts, CI

### E-1 · ALTA · ops · `restore-postgres.sh --direct` restaura sobre `DATABASE_URL`
- `scripts/restore-postgres.sh:61-64` (`pg_restore --clean --if-exists … -d "$DATABASE_URL"`), cabecera
  `:10-11` y `docs/reference/backups-postgres.md` prometen que "nunca toca la base activa a menos que
  se pida con `--target`"; en `--direct` `TARGET` se ignora. El cron de ejemplo exporta `DATABASE_URL`
  de producción.
- Corrección: `--direct` exige `--target` explícito ≠ `DATABASE_URL` o flag `--i-know-this-overwrites`
  + confirmación; imprimir destino; `pg_dump` de seguridad previo. Confirmada.

### E-2 · ALTA · seguridad · credenciales en la línea de comandos y `.env` ejecutado como shell
- `scripts/backup-postgres.sh:83, 59` (`pg_dump "$DATABASE_URL"`, `set -a; source …/.env`),
  `restore-postgres.sh:64`. La URI con contraseña queda en `ps`/`/proc` durante el volcado; un `.env`
  manipulado ejecuta código como el cron.
- Corrección: `PGHOST/PGUSER/PGPASSWORD` o `~/.pgpass`/`PGSERVICE`; parsear con `grep -E
  '^DATABASE_URL='`; cifrar dumps (`age`/`gpg`) antes de subirlos (contienen PII). Confirmada.

### E-3 · ALTA · RGPD · purgas HMAC con `APP_SECRET` crudo y distintas de los helpers testeados
- `session-ip-ua-purge-prisma-store.ts:33, 38`, `terms-acceptance-ip-ua-purge-prisma-store.ts:29, 34`,
  `access-key-email-purge-prisma-store.ts:32`: `hmac(col, ${secret}, 'sha256')` con `APP_SECRET` sin
  derivar ni dominio. `ip-ua-purge.ts:49-62` y `access-key-email-purge.ts:278-293` definen
  `hashPurgedValue`/`hashPurgedEmail` con clave derivada y dominio, **sin consumidores fuera de tests**.
- Impacto: IP/UA/email correlacionables entre tablas y filas; quien tenga `APP_SECRET` (que además
  firma descargas y confirmaciones) recorre el espacio IPv4 en segundos → es seudonimización, no
  anonimización; `APP_SECRET` viaja como parámetro SQL cada hora (`log_min_duration_statement` puede
  registrarlo).
- Corrección: derivar la clave por dominio en Node y pasar **esa** al SQL (o hashear en Node por
  lotes); si el objetivo es anonimizar, `NULL`/constante + contador o sal por fila; unificar SQL y
  helpers (o borrar los helpers). Confirmada.

### E-4 / A-19 / C-5 / F-41 · ALTA · incompleto/seguridad · entorno sin validar; secretos de dev por `NODE_ENV`
- `packages/web/src/env.ts:19-27` ("Aún NO se importa desde el runtime real"), `packages/env/src/server.ts:10`
  (`NODE_ENV` default `development`), `worker/main.ts` y `colyseus-server/main.ts` sin `parseEnv`,
  scripts `start` con `tsx src/main.ts` sin `NODE_ENV`.
- Siete puntos hacen `configured || (NODE_ENV === "production" ? null : DEV_*_SECRET)`:
  `join-token.ts:26,40`, `publish-confirmation.ts:62`, `access-key-cards.ts:155`,
  `confirmation-token.ts:31`, `ip-ua-purge.ts:45`, `access-key-email-purge.ts:46`, `mail/transport.ts:193`;
  además `colyseus-server/src/playtest/config.ts:12,30`, `events/runtime.ts:36`
  (`FIXTURE_EVENT_RUNTIME` sin persistencia), `web/src/server/playtest-launcher.ts:742-746`.
- Impacto: un despliegue/staging sin `NODE_ENV=production` arranca **sin error** firmando
  `joinToken`/`spectatorToken`/playtest/publicación/descargas con secretos públicos del repo;
  `jsonTransport` "envía" emails a la nada; `seed.ts:160` sembraría 50 salas falsas. Sin
  `REDIS_URL`/`QUEUES_ENABLED` (E-11) todo degrada en silencio.
- Corrección: usar el secreto de dev solo con `NODE_ENV ∈ {development, test}` (o
  `ALLOW_DEV_SECRETS=1`) y `null` en cualquier otro caso; `parseEnv` en `instrumentation.ts`,
  `worker/main.ts`, `colyseus/main.ts` con `superRefine`: en producción obligatorios `REDIS_URL`,
  `JOIN_TOKEN_SECRET`, `PLAYTEST_SECRET`, `PUBLISH_CONFIRM_SECRET`, `APP_SECRET`, `BETTER_AUTH_*`,
  `EMAIL_*`, `STORAGE_*`, `APP_URL`; `NODE_ENV=production` en los `start`; declarar las variables en el
  job `verify`; loguear al arrancar qué modo está activo. Confirmada.

### E-5 · ver A-5.

### E-6 · MEDIA · `analyticsEvent` sin partición DEFAULT y solo un mes de antelación
- `migrations/0008_pricing_settings_progress/migration.sql:47-52`, `analytics/partitions.ts:10-12, 19`
  (`ANALYTICS_PARTITIONS_AHEAD = 1`), `worker/src/analytics-partitions.ts:99-103, 77` (`attempts: 3`).
- Impacto: worker caído el día 1 (o DDL fallando 3 veces por `lock_timeout`) → al mes siguiente cada
  `INSERT` falla ("no partition of relation") y los jobs de analítica se pierden.
- Corrección: `monthsAhead` 2–3; partición DEFAULT como red (alerta si tiene filas); más `attempts`;
  señal en `/api/health`/Sentry si falta la del mes siguiente. Plausible.

### E-7 · MEDIA · rendimiento · índices que faltan
- Purgas horarias: `session(createdAt)` con filtro `NOT LIKE 'purged:%'`, `termsAcceptance(acceptedAt)`,
  `accessKey(eventId) WHERE email IS NOT NULL AND email NOT LIKE 'purged:%'` (el CTE agrega **toda**
  `gameSession`).
- FKs consultadas sin índice: `progressEvent.playerId` (B-13), `progressEvent.accessKeyCode`,
  `accessKey.regeneratedFrom` (B-14), `purchase.eventId/roomVersionId/resultingRoomId`,
  `event.roomVersionId`, `eventRecording.sessionId`, `contentReport.roomId/roomVersionId/reviewId/
  reporterId`, `moderationAppeal.creatorId/roomId/strikeId/contentReportId`,
  `moderationStrike.contentReportId`, `roomUpdate.authorId`, `audioAsset.organizationId/reviewedBy`,
  `analyticsEvent.roomVersionId/playerId` (añadir `@@index([roomVersionId, createdAt])`).
- Corrección: índices parciales para purgas; `CREATE INDEX CONCURRENTLY` en migración manual. Confirmada.

### E-8 · MEDIA · seguridad · códigos canjeables en Redis 48 h como payload del job de PDF
- `access-key-cards.ts:110-118` (`codes: string[]`, hasta 5 000), `access-key-cards-queue.ts:25-26,
  34-37` (`removeOnComplete/Fail: {age: 48 h}`), `worker/src/access-key-cards.ts:60`; `find()`
  devuelve `job.data` entera al `GET /api/exports/:jobId`. El resto de colas transporta solo ids.
- Corrección: encolar `{eventId, organizerId, locale, filter}` y releer; `removeOnComplete`
  inmediato; resultado sin códigos. Confirmada.

### E-9 · MEDIA · worker sin health, apagado sin timeout, cableado duplicado ×9
- `worker/src/main.ts:70-189, 191-223`; `kit/src/health/index.ts:58-78` (`createWorkerHealthHandler`
  solo en tests; `alertas-uptime-kuma.md:22-23` lo deja "fuera de alcance"). `shutdown` encadena 18
  `await` sin límite ni `process.exit`; 9 `createQueueRedis()` con bloques casi idénticos.
- Corrección: `/healthz` en `WORKER_HEALTH_PORT` con `workersRunning`/`redis`; `Promise.race` + timeout
  30 s + `process.exit`; helper `createScheduledWorker({name, schedulerId, every|pattern, process})`.
  Confirmada.

### E-10 · MEDIA · PII en logs · redacción de un solo nivel y lista corta
- `kit/src/logger/index.ts:21-24` (`paths: [k, *.k]` no cubre `a.b.email`), `logger/shared.ts:15`
  (`SENSITIVE_KEYS = ["email","to","password","token","secret"]`), `shared.ts:39-53` (`writeToConsole`
  sin `scrub`; `scrub` sin consumidores), `logger/client.ts`. Faltan `authorization`, `cookie`,
  `accessToken`, `refreshToken`, `idToken`, `apiKey`, `code` (los `failed` handlers loguean `job.data`),
  `ipAddress`, `userAgent`.
- Corrección: `paths` con `*.*.k`, `*[*].k` o `formatters.log` con `scrub` recursivo; usar `scrub` en
  `writeToConsole`; ampliar la lista. Confirmada.

### E-11 · MEDIA · sin `REDIS_URL`/`QUEUES_ENABLED` en producción todo degrada en silencio
- `env/src/server.ts:28-31`, `kit/src/queue/define.ts:111-116, 129-140` (`enqueue` → `null`),
  `rate-limit/index.ts:40-48` (solo `warn`). El webhook de Stripe encola la confirmación tras
  responder 200: sin outbox, un Redis caído en ese instante pierde el email legalmente relevante.
- Corrección: refinamiento de esquema (E-4); tabla outbox en Postgres (`emailOutbox` con `sentAt`)
  para confirmaciones de compra; `logger.error` + Sentry cuando `enqueue` devuelve `null` en producción.
  Confirmada (diseño).

### E-12 · MEDIA · `redisHealth()` sin timeout
- `kit/src/health/index.ts:81-89` vs `queue/health.ts:8-21` (`redisResponds` sí lo tiene);
  `app/api/health/route.ts:17` es lo que sondea Uptime Kuma. Corrección: reutilizar `redisResponds(redis, 2000)`.
  Confirmada.

### E-13 · MEDIA · compose de dev en `0.0.0.0`, credenciales por defecto, imágenes `latest`
- `infra/docker-compose.dev.yml:14-15, 39-40, 52-53, 67-69, 104-118, 129-130`; `livekit.yaml:21`
  (`devkey: secret`); `coturn/turnserver.conf:6`. No hay compose de producción (specs/24 §5 "todo en
  1 VPS"): este fichero es el punto de partida obvio.
- Corrección: `127.0.0.1:` en todos los `ports`; pinear tags; `requirepass`; README explícito. Confirmada.

### E-14 · MEDIA · tests de integración nunca corren en CI
- `.github/workflows/ci.yml:14-24` (`verify` sin Postgres/Redis); todos los `*.integration.test.ts` y
  `kit/test/integration.test.ts` se saltan. Son justo los stores de purga (PII) y el DDL de particiones.
- Corrección: `services: postgres + redis`, `DATABASE_URL`, `prisma migrate deploy`, ejecutar los
  `*.integration.test.ts` en `verify`. Confirmada.

### E-15 · MEDIA · supply chain · workflows sin `permissions` mínimos ni pin por SHA; sin Dependabot
- `ci.yml` (sin `permissions:`; acciones por tag mayor salvo `set-swap-space`); `.github/` sin
  `dependabot.yml`. `e2e-nightly.yml` sí declara permisos. Se usa `pull_request` (bien).
- Corrección: `permissions: {contents: read}`; pin por SHA; `dependabot.yml` (`github-actions`,
  `npm`); `pnpm audit --prod` o CodeQL en CI. Confirmada.

### E-16 · MEDIA · RGPD · retención: emails de eventos nunca jugados y `eventRecording` sin job
- `access-key-email-purge.ts:243-253`, `access-key-email-purge-prisma-store.ts:26-30`
  (`HAVING bool_and(status IN ('ended','aborted'))`): un evento sin `gameSession` o con una `pending`
  abandonada conserva `accessKey.email` (posiblemente de menores) indefinidamente. `eventRecording`
  (`retentionUntil`) no se referencia desde ningún `.ts` (specs/18 dice 90 días).
- Corrección: cutoff alternativo por `event.createdAt` + N meses o `accessKey.expiresAt`; job para
  `eventRecording` (o retirar el modelo); alerta si `readEmailPurgeSecret()` es `null` en producción
  (hoy `warn`, `main.ts:98-100`). Confirmada.

### E-17 · BAJA · código muerto en kit
- `redis/lock.ts` (`withRedisLock`: sin TTL extendible y fail-open `:37-42`; sin consumidor),
  `storage/validation.ts` (`isValidUploadKey`, `sniffImageMime`, `UPLOAD_MAX_BYTES`), `storage/index.ts:92-99`
  (`getUploadUrl` PUT presignado sin límite de tamaño posible; sin consumidor), `logger/shared.ts:19-36`
  (`scrub`), helpers de hash (E-3). Usar (A-12, purgas) o borrar; si `getUploadUrl` se usa, POST policy
  con `content-length-range`. Confirmada.

### E-18 · BAJA · esquema Prisma no refleja índices/CHECKs manuales; migraciones mixtas
- `0007_purchases:29` (`uxPurchaseStripePi` parcial), `0004_credits:13-14`, `0006_events:62-63`,
  `0005_rooms:242`, triggers `trg*UpdatedAt` vs `schema.prisma` (sin ellos) y tres migraciones
  generadas por `prisma migrate dev`. `user-data-rights-prisma-store.ts:50` y la dedupe de Stripe
  dependen de unicidades solo en SQL; `migrate dev` podría proponer `DROP INDEX`.
- Corrección: comentarios `///` en el esquema; política "solo `migrate diff` + edición manual";
  test de integración que compruebe la existencia de esos índices. Plausible.

### E-19 · BAJA · `APP_URL` con default `http://localhost:3000` en el worker
- `worker/src/main.ts:131, 151` → enlaces de emails reales a localhost si falta la variable. Ver E-4.

### E-20 · BAJA · emails at-least-once sin marcador previo al envío
- `invitations.ts:232-238` (`send` y después `recordSent`), `purchase-confirmation.ts:92-99` (sin
  marcador); `X-Entity-Ref-ID` con `Date.now()` no agrupa. Corrección: ref estable por `(code, kind)`;
  `confirmationSentAt` en `purchase`/`event`. Plausible.

### E-21 · BAJA · menores
- `restore-postgres.sh:84-85`: `--verify-table` interpolado en SQL sin validar (`^[A-Za-z_][A-Za-z0-9_]*$`).
- `backup-postgres.sh:99`: rotación parseando `ls -1t`.
- `kit/src/rate-limit/redis-store.ts:29-31`: `EXPIRE` fuera del `MULTI` (clave sin TTL si cae entre
  `INCR` y `EXPIRE`); Lua `INCR`+`EXPIRE NX`.
- `kit/src/rate-limit/http.ts:29-37`: `cf-connecting-ip`/`x-real-ip` confiados incondicionalmente
  (supuesto documentado); lista de proxies de confianza configurable.
- `env/src/helpers.ts:8-12`: `bool()` solo acepta `"true"`; `transport.ts:216` acepta `"1"`.
- `shared/src/db/index.ts:11-13`: sin `$connect` de arranque (el primer request paga la conexión).

### E-22 · BAJA · fail-open del rate limit (discrepancia parcial con `seguridad.md`)
- Razonable para el catálogo, pero `redeem` es el objetivo de fuerza bruta: un DoS a Redis desactiva
  la protección. Propuesta: `RedisSlidingWindowStore` cae a `MemorySlidingWindowStore` por proceso en
  vez de a `ok: true`. Plausible.

### E-23 · MEJORA
- `worker/src/worker.ts:62-70`: un `INSERT` por evento de analítica (concurrencia 20); agrupar con
  `createMany` por lotes.
- `roomVersion.package` con GIN `jsonb_path_ops` sobre todo el paquete: si solo se consulta
  `meta.languages`, indexar `(package->'meta')`.
- `kit/src/queue/define.ts:24-29`: `removeOnFail: 5000` conserva payloads con `playerId`/`sessionId`.
- Concurrencias/`everyMs`/cron sin variable de entorno: `workerConfig` centralizado.
- `20260923110132_remove_waitlist`: `DROP TABLE` con emails sin nota en el registro de decisiones.

---

## 8. Área F — frontend (Next.js App Router, componentes, stores, Phaser, editor UI)

### F-1 · ver A-1.

### F-2 · ALTA · mala práctica · sin `error.tsx`, `global-error.tsx`, `not-found.tsx` ni `loading.tsx`
- `packages/web/src/app/**` (búsqueda vacía). `RoomScene` lanza en constructor (`room-scene.ts:233-237,
  432`) e instanciada en `useEffect` (`game-session-canvas.tsx:57`, `room-editor-canvas.tsx:49`,
  `room-playtest-canvas.tsx:62`); `useConsent` lanza (`consent-provider.tsx:32`); `layout.tsx:44` llama
  a `notFound()` sin página propia.
- Corrección: `app/[locale]/error.tsx` + `global-error.tsx` + `not-found.tsx` traducidos;
  `ErrorBoundary` alrededor de `GameSessionCanvas`, `MediaOverlay`, `RoomEditorCanvas`, `RulesGraph`;
  `loading.tsx` en `(public)/rooms`. Confirmada.

### F-3 · ALTA · privacidad · LiveKit publica mic y cámara automáticamente al conectar
- `components/game/media-overlay.tsx:60-66`:
  ```tsx
  <LiveKitRoom key={attempt} token={payload.token!} serverUrl={payload.url!} connect
    audio={isPlayer} video={payload.canPublishVideo} …>
  ```
  `audio`/`video` publican sin gesto del usuario en cuanto llega `media_token`.
- Corrección: `audio={false} video={false}` y activar desde `MediaTiles` (`setMicrophoneEnabled`).
  Confirmada.

### F-4 · ALTA · rendimiento · el HUD completo se re-renderiza en cada patch de Colyseus (~20 Hz)
- `game-session-shell.tsx:164` (`useSyncExternalStore(client.subscribe, client.getSnapshot, …)`),
  `game-runtime/src/session/network.ts:49-52` (`toGameSnapshot` reconstruye players/objects/puzzles/
  inventories/chat en cada `onState`); `spectator-game.tsx:148` igual. Shell de 1 050 líneas
  (HUD, jugadores, inventario, chat, panel de puzzle, `renderItemIcon` con `<img>`).
- Corrección: selectores por slice con comparación estructural (o store Zustand por slices
  actualizado solo si cambia), `toGameSnapshot` incremental por colección, `React.memo` en
  `ChatWindow`, paneles y lista de jugadores. Confirmada.

### F-5 · ALTA · legibilidad · `GameSessionShell` (1 053 líneas) y `RoomPlaytestShell` (920) duplicados
- 17 `useState`, 7 `useRef`, 8 `useEffect`, 15 `useCallback`; `RoomPlaytestShell` reimplementa la
  misma máquina de estados contra `RoomSession` local aunque existe `createLocalGameClient`
  (`session/local.ts`).
- Corrección: hooks `useSceneSync`, `useServerEvents`, `usePanelState`, `useHudHotkeys` y
  subcomponentes `HudHeader`, `ObjectsBar`, `PlayersAside`, `PanelHost`, `ContextMenu`, `ItemPicker`;
  `RoomPlaytestShell` monta `GameSessionShell` con `createLocalGameClient`. Confirmada.

### F-6 · ALTA · shadcn (ADR-019) · inspector, grafo de reglas y panel de validación con controles nativos
- `packages/editor/src/inspector/schema-form-view.tsx:105, 138, 198 (checkbox), 208, 264, 278, 295, 302,
  339, 381, 412, 489, 528`; `inspector.tsx:152, 176, 300, 310, 428, 475, 501, 526`;
  `rules-graph/rules-graph.tsx:214, 239, 293, 356, 821, 824, 835`; `validation/validation-panel.tsx:71`.
  Se montan en `/editor/[roomId]` (`room-editor-inspector.tsx:111`, `room-editor-shell.tsx:268`).
- Corrección: `packages/web` inyecta renderers shadcn (`Input`, `Select`, `Checkbox`, `Textarea`,
  `Button`) vía `SchemaFormContext.renderers`/`fieldKinds` (ya existe el punto de extensión);
  `RulesGraph`/`ValidationPanel` aceptan un slot `components`; o mover esos componentes a `web`.
  Confirmada.

### F-7 · ALTA · shadcn · radios nativos en reseñas y onboarding
- `components/catalog/review-form.tsx:63-71`, `onboarding/onboarding-wizard.tsx:106-112, 120-126`.
  Corrección: `pnpm --filter @escaperoom/web exec shadcn add radio-group` y `RadioGroup`/`RadioGroupItem`.
  Confirmada.

### F-8 · ALTA · bug · `CatalogFilters`: navegación extra al montar y primera tecla ignorada
- `components/catalog/catalog-filters.tsx:97-116`: el primer efecto programa `navigate` al montar
  (`router.push` a la misma URL → refetch RSC en cada carga del catálogo); el segundo pone
  `skipNextQNavigate = true` y `setQ` con el mismo valor (no re-renderiza), así que el flag queda en
  `true` y **la primera pulsación del usuario en el buscador se ignora**. Deps incompletas (`values`,
  `navigate`) sin lint que lo detecte (F-24).
- Corrección: comparar `q` con `values.q` antes del debounce, sincronizar sin flags (o
  `useDeferredValue` + `router.replace`); test de cliente. Confirmada por lectura.

### F-9 · ALTA · i18n · catálogos incompletos (medido)
- Contra `es.json` (1 151 claves): `en` faltan 25 (**Checkout**, **Payouts**); `de`/`fr`/`nl`/`pt`
  faltan 98 cada uno (**Landing**, **Onboarding**, **Auth**, **Checkout**, **Payouts**,
  `RoomEditor.toolHints.*`); `pt` tiene 160 valores idénticos al español. `deepMergeMessages` rellena
  con `es`, así que `i18n.test.ts` no lo detecta. ICU distinto en `EditorI18n.removeWarning`
  (`de/fr/nl`) y `EventPanel.footer.resent` (`de/fr/nl/pt`).
- Impacto: landing, login, onboarding, checkout y cobros salen en español para el resto de locales.
- Corrección: completar (al menos `en`); umbral de "claves heredadas del fallback" por locale en el
  test. Confirmada.

### F-10 · ALTA · i18n · strings en castellano fuera de next-intl
- `components/game/lobby-hud.tsx:8-14, 41-74`; `media-overlay.tsx:9-16, 78, 84`;
  `media-tiles.tsx:43-117` (se montan en partida real, `network-game.tsx:178`); `lobby-shell.tsx:10`;
  `world-preview-shell.tsx:14, 55-142`; `room-playtest-shell.tsx:45`; `room-editor/editor-tool-hint.tsx:92`;
  `game-runtime/src/phaser/room-scene.ts:634, 922-935, 1014` (textos in-canvas).
- Corrección: `useTranslations("Media")`; `labels` en `RoomSceneOptions` (como `RulesGraph`). Confirmada.

### F-11 · ALTA · rendimiento · fixture del Rey Aldric leído, parseado y validado en cada petición
- `(play)/play/page.tsx:35`, `(creator)/events/[id]/sessions/[sessionId]/observe/page.tsx:28`,
  `room-playtest/page.tsx:22`, `room-preview/page.tsx:22`, `editor/[roomId]/page.tsx:33`, `dev/*`:
  `readReyAldricRoomPackageJson` (`readFileSync` + `JSON.parse` + Zod) y `resolveRoomPreviewPack`
  (`room-preview-fixture.ts:16-18`, `room-preview-pack.ts:42-91`) sin `cache()`.
- Corrección: memo a nivel de módulo por `(tileset, locale)` o precomputar el `RuntimeModel` por
  locale. Confirmada.

### F-12 · MEDIA · observabilidad · sin Sentry en cliente
- Existen `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`; **no**
  `instrumentation-client.ts`. Errores de Phaser/LiveKit/colyseus/React no llegan. Corrección:
  `src/instrumentation-client.ts` con `NEXT_PUBLIC_SENTRY_DSN` + `onRouterTransitionStart`; origen de
  Sentry en `connect-src`. Confirmada.

### F-13 · MEDIA · seguridad · issuer OAuth desde `x-forwarded-host`/`host`
- `(play)/oauth/consent/page.tsx:23-27, 51` (`getMcpOAuthProvider({url: requestOrigin(headers)})`);
  `server/mcp-oauth.ts:34` sí usa `BETTER_AUTH_URL || NEXT_PUBLIC_APP_URL`. Corrección: URL
  configurada siempre; `host` solo en desarrollo (ver también A-15, E-4). Plausible.

### F-14 · MEDIA · SEO/seguridad · páginas privadas o de desarrollo indexables y sin auth en servidor
- `(creator)/editor/[roomId]/page.tsx` sin `robots` y sin sesión (un anónimo ve el editor montándose
  y reintentando); `(creator)/room-preview`, `room-playtest`, `world-preview`, `(play)/lobby`
  indexables (robots.txt solo excluye `/*/dev/`), sin auth, `lobby` expone `COLYSEUS_URL`
  (`lobby-hud.tsx:74`); `(auth)/login`, `signup` sin `generateMetadata` ni `setRequestLocale`.
- Corrección: `robots: {index: false}`; en `editor/[roomId]` resolver actor y `notFound()`/login;
  mover previews a `dev/`. Confirmada.

### F-15 · ver B-20.

### F-16 · MEDIA · bundle · React Flow y CSS importados estáticamente desde el barrel de `@escaperoom/editor`
- `room-editor/room-editor-shell.tsx:3, 11` (`import "@xyflow/react/dist/style.css"`, `RulesGraph`);
  solo `RoomEditorCanvas` va con `next/dynamic`. Corrección: `dynamic(() => import("@escaperoom/
  editor/rules-graph"))` y subpath `./rules-graph` en `packages/editor/package.json`. Confirmada.

### F-17 · MEDIA · accesibilidad/shadcn · overlays sin `role="dialog"` ni foco
- `game-session-shell.tsx:947-1046, 849-928, 563-591`: inventario, paneles, menú contextual y picker
  son `<div className="absolute inset-0">` sin `aria-modal`, sin foco ni scroll lock; ESC por listener
  global. Solo `ResultsScreen` usa `Dialog`. Corrección: `Dialog` (modal) para paneles/inventario,
  `DropdownMenu`/`Popover` para menú y picker. Confirmada.

### F-18 · MEDIA · `OnboardingWizard`: enlaces sin locale, `<a>` con `<button>` dentro, `aria-pressed` en `div`
- `onboarding-wizard.tsx:147-155, 166-173, 197-204, 207-209, 90-95`. Corrección: `Link` de
  `@/i18n/navigation`; `<Button asChild><Link/></Button>`. Confirmada.

### F-19 · MEDIA · código muerto con bug conocido · `iso-room-scene.ts` + `game-store.ts`
- Nadie importa `IsoRoomScene`; `useGameStore` solo desde ahí y su test. Tiene el bug que
  `lobby-scene.ts:89-101` documenta como corregido (desuscribe solo en `SHUTDOWN`; tweens sin
  `killTweensOf`). Corrección: borrar ambos y su test. Confirmada.

### F-20 · MEDIA · rendimiento · todo `[locale]` dinámico por el nonce, sin caché de datos ni streaming
- `app/[locale]/layout.tsx:41` (`await connection()`), `:20` (`generateStaticParams` sin efecto).
  Decisión documentada (ADR-027) pero el coste no está mitigado en la página SSR (solo `GET /api/rooms`
  y la consulta del catálogo en Redis). Corrección: `unstable_cache`/`"use cache"` con tag por
  publicación; `loading.tsx` + `Suspense` en `rooms/page.tsx`; valorar hash en vez de nonce para
  `(public)`. Confirmada.

### F-21 · MEDIA · rendimiento · Phaser recrea toda la sala en cada cambio del doc Yjs
- `game-runtime/src/phaser/room-scene.ts:454-479, 1344-1358`: `setModel` (llamado por cada tecla del
  inspector o pincelada desde `room-editor-canvas.tsx:69-71`) hace `clearRoom()` + `buildRoom()`
  (`add.image` por tile, sprites, glows, luces con tweens `repeat:-1`); `drawGround` crea un `Image` por
  celda. Con 20×20×3 capas > 1 000 objetos por edición.
- Corrección: diff del modelo (repintar solo la capa/objeto cambiado) o debounce/RAF; `Tilemap`/`Blitter`
  para el suelo. Confirmada (coste), plausible (magnitud). Relacionado con D-17.

### F-22 · MEDIA · rendimiento · allocaciones por frame y `Graphics` por celda
- `room-scene.ts:1091-1138` (`drawReactive`: un `Graphics` + tween infinito por celda de canal y por
  antorcha; se reconstruye entero en cada `setObjectState` `:771-774`); `avatar.ts:82-84, 297-303`
  devuelven `{...this.cell}` por frame; `syncRemoteAvatars` crea `Map`s por cada `setPlayers` (~20 Hz,
  F-4). Corrección: un `Graphics` por capa; reutilizar `{x,y}`; throttle de `setPlayers` si el
  snapshot no cambió. Confirmada.

### F-23 · MEDIA · `walkTo` envía todos los `move` intermedios en un bucle síncrono
- `game-session-shell.tsx:433-441`: el servidor limita `move` a 10/s → el propio cliente provoca
  `RATE_LIMITED` y el "snap back". Corrección: encolar pasos a la cadencia de `AVATAR_MOVE_EMIT_MS` o
  un `move` con destino e interpolación en servidor. Plausible.

### F-24 · MEDIA · lint · sin `eslint-plugin-react-hooks`, `react`, `jsx-a11y` ni `@next/eslint-plugin-next`
- `eslint.config.mjs`, `packages/config/eslint/base.mjs`. Bugs como F-8 y deps incompletas
  (`catalog-filters.tsx:109, 116`, `room-editor-shell.tsx:148`) pasan. Corrección: añadir los tres al
  preset de `packages/web`. Confirmada.

### F-25 · MEDIA · incompleto · placeholders "próximamente" vivos en el editor
- `room-editor/room-editor-workspace.tsx:150-171, 317-319`, `messages/es.json:485` (`comingSoon`,
  `selection.inspectorSoon`): fallback con botones `disabled` cuando no se pasan `headerActions`/
  `inspector`; en producción sí se pasan. Corrección: hacerlos obligatorios y borrar el fallback
  (y su test). Confirmada.

### F-26 · MEDIA · incompleto · namespace `Home` muerto en `es.json` exigido por `i18n.test.ts:39-41`
- Claves de la landing anterior. Corrección: borrar namespace y actualizar el test. Confirmada.

### F-27 · MEDIA · UX · el jugador ve ids técnicos (`armario`, `p-llave-cuadro`)
- `game-session-shell.tsx:690, 855, 895, 479, 489` (`object.id`, `menu.object {object: id}`,
  `chooseItem {object: pickerFor}`, `log.useItem`). Corrección: `name` localizado en `RuntimeObject`
  (derivarlo del diálogo asociado si el objeto no tiene `LocalizedText`). Confirmada (id mostrado).

### F-28 · MEDIA · `checkout/confirmation` sin validar `searchParams` ni consultar el estado real
- `(play)/checkout/confirmation/page.tsx:2, 20-33, 68-72`: `next/link` en vez de `@/i18n/navigation`;
  `roomId`/`eventId` sin validar; `?status=success` con cualquier `type` pinta "compra completada".
  Corrección: regex de `play/page.tsx:37`, `Link` i18n, leer `GET /api/purchases/:id`. Confirmada.

### F-29 · MEDIA · rendimiento · cascada de `await` en la ficha de sala y sin `Suspense`
- `(public)/rooms/[roomId]/page.tsx:60-80`: `loadRoom → listReviews → resolveActorFromHeaders →
  getViewerState → getSignedReadUrl` en serie (3 independientes); `rooms/page.tsx` sin streaming.
  Corrección: `Promise.all` + `Suspense` en reseñas. Confirmada.

### F-30 · MEDIA · `style-src 'unsafe-inline'` (deuda documentable; ver A-23).

### F-31 · BAJA · `creator-chat.tsx:242-247`: `<a href={item.link.url} target="_blank">` desde el stream de
  tools sin validar esquema. Aceptar solo `https?:` del mismo origen. Plausible.

### F-32 · BAJA · `event-dashboard.tsx:68-75, 131`: polling 5 s sin pausar con `document.hidden`;
  `URL.createObjectURL` nunca revocado. Confirmada.

### F-33 · BAJA · `lobby-canvas.tsx:79-85`, `lobby-store.ts:71-72`, `lobby-scene.ts:81-87`: objetos nuevos en
  cada `onStateChange` → re-render a 20 Hz; `subscribe` sin selector. Página de pruebas. Confirmada.

### F-34 · BAJA · `cn` importado de `"cn"` en ~15 ficheros y de `@/lib/utils` en otros. Unificar al alias.

### F-35 · BAJA · listener global de teclado re-registrado en cada cambio de estado
  (`game-session-shell.tsx:563-591`, `room-playtest-shell.tsx:234-259`). Leer desde refs.

### F-36 · BAJA · `use-game-connection.ts:76, 83`: `JSON.stringify(target)` (incluye `joinToken`) en cada
  render. `useMemo` en los callers.

### F-37 · BAJA · `room-detail.tsx:73-77`: portada con `alt=""`, sin `width/height`/`fetchPriority` (LCP).

### F-38 · BAJA · `media-tiles.tsx:115-120`, `lobby-hud.tsx:44`, `media-overlay.tsx:54`: emojis/puntos de
  color como único indicador de estado; texto `sr-only`.

### F-39 · BAJA · `app/sitemap.ts:26-46`: pagina hasta 5 000 salas × 6 locales en cada petición,
  `force-dynamic`. `unstable_cache` o `revalidate = 3600`.

### F-40 · BAJA · páginas legales "borrador técnico" solo en español, enlazadas en todos los locales y
  exigidas por el gate de reaceptación. Seguimiento explícito; ocultar DPA hasta revisión.

### F-42 · BAJA · `playtest-button.tsx:47, 61`: `window.open("about:blank")` conserva `opener`; pestaña en
  blanco sin feedback. `tab.opener = null` + mini HTML "Preparando…".

### F-43..F-47 · MEJORA
- `plates-panel.tsx:53-57`, `template-preview.tsx:154-158`: `setInterval(250)` con `Date.now()` local en
  vez de `snapshot.clock` del servidor.
- Precargar Phaser (~1 MB) y `livekit-client` (~400 KB) mientras se muestra el formulario de nombre.
- Tres formularios de login (`auth-form`, `onboarding-login`, `consent-login`) con el mismo `fetch` a
  mano: hook `useBetterAuthSignIn(callbackURL)`.
- `KNOWN_ERRORS` duplicados (`publish-confirm/page.tsx:23-39` vs `confirm-publish.tsx:8-24`,
  `event-dashboard.tsx:16-24` vs `spectator-game.tsx:14-21`, `redeem-form`, `confirm-attendance`,
  `playtest-button`): exportar códigos `as const` desde `@escaperoom/shared`.
- `room-scene.ts:245-253`: atlas recargados al remontar el `Phaser.Game` (retry, cambio de `key`).

---

## 9. Transversales

### 9.1 Duplicación que conviene atacar de una vez
- `UUID_RE` en ≥ 12 ficheros (`purchases.ts:126`, `events.ts:251`, `access-keys.ts:374`, `redeem.ts:49`,
  `room-license.ts:207`, `reviews-prisma-store.ts:317`, `catalog-listing.ts:540`, `event-panel.ts:854`,
  `access-key-cards.ts:215`, `room-publish.ts:202`, `room-draft.ts:131`, …).
- `isAdmin(userId)` reimplementado en 4 stores (`purchases-prisma-store.ts:542`,
  `events-prisma-store.ts:808`, `room-publish-prisma-store.ts:957`, `audio-assets-prisma-store.ts:605`).
- `ROOM_PLATFORM_FEE_RATE` y `LICENSE_PLATFORM_FEE_RATE` con `splitRoomAmount`/`splitLicenseAmount`
  idénticos; `toAmount()` en `stripe-gateway.ts:297` es un no-op.
- Adaptadores REST (A-22), plantillas (D-20), bloques del worker (E-9), formularios de login (F-45),
  `KNOWN_ERRORS` (F-46), `cn` (F-34).
- Propuesta: `@escaperoom/shared/services/common` (`UUID_RE`, `isUuid`, `requireUser`,
  `splitPlatformFee`), `AdminDirectory` Prisma único, `createRestAdapter(errorClass, statusMap)`.

### 9.2 IP del cliente
Tres criterios distintos: `clientIpFromHeaders` (última entrada / `cf-connecting-ip`, correcto),
`rest/mcp-oauth.ts:62-68` y `rest/legal-acceptance.ts:17-23` (primera entrada, falsificable). Un solo
helper.

### 9.3 Contrato de errores REST
Ver A-22. Fijar en specs/13 §1 y cubrir con un test de contrato.

### 9.4 Validación de entorno y modo producción
Ver E-4. Es el hallazgo que más otros hallazgos amplifica (C-5, A-19, E-11, E-19, F-13, F-41).

### 9.5 Dependencias (`pnpm audit`)
- Todo transitivo de devDependencies: `@better-auth/cli@1.4.21` → `better-auth@1.4.21` (crítico:
  replay de refresh token en oidcProvider; altos: account takeover por auto-link, `alg=none`, XSS
  por `javascript:` redirect, …) y `drizzle-orm@0.41.0` (SQLi en identificadores); `lodash@4.17.21`
  vía `@colyseus/core>@pm2/io>async` y `chevrotain`; `deepmerge-ts@7.1.5` vía `@prisma/config`.
- El runtime usa `better-auth@1.7.5` (no afectado). Acción: subir `@better-auth/cli` a una versión
  que dependa de `better-auth ≥ 1.6.22` (o `pnpm.overrides`), `pnpm audit --prod` en CI (E-15) y
  Dependabot. El `lodash` vía `@pm2/io` es de runtime en colyseus-server pero solo alcanzable por
  `_.template`/`_.unset` que ese camino no usa.

### 9.6 Documentación desactualizada respecto al código
- `docs/reference/seguridad.md` §1: webhook "aún no existe" (existe en `/api/stripe/webhook`);
  rate limit de Better Auth "en memoria" (sigue así: A-4 también).
- specs/13 §7 ruta del webhook; specs/11 vs specs/12 sobre el observador (C-13); specs/10 §1.1 y
  ADR-010 sobre el gate de confirmación (D-12); specs/05 §2.2 `repeatable` vs `once`; specs/18 §3.3
  purga de analítica ya hecha; comentarios "hasta 5.1" (B-27); `alertas-uptime-kuma.md` health del
  worker (E-9); `docs/notas/2026-09-23`: repo sigue **público** (recordatorio de volver a privado).

---

## 10. Plan de PRs sugerido (orden y agrupación)

Cada PR pequeña, con test de regresión, desde su propio worktree (CLAUDE.md). El orden respeta
dependencias y prioridad.

1. **Login y entorno (P0):** A-1 (magic link con transporte real), E-4 (parseEnv en web/worker/
   colyseus + `NODE_ENV` + secretos dev solo en dev/test + variables en CI), A-17, E-19.
2. **Pagos (P0):** B-1 + B-8 + B-11 (`purchase event_credits` pending con importe congelado, webhook
   compara `session.id` y `amount_total`, `checkoutRef` solo se libera con `expired`, escritura
   atómica), B-2 (`markPaid` no activa; `activate` genera sesiones), B-3 (idempotencyKey +
   `attachTransfer` estricto + comprobación previa), B-9 (email tras `settlePurchase`; Transfer a
   job), B-12, B-5 (reversal + parciales + `event_credits`), B-21, B-22, B-16.
3. **Colyseus auth y medios (P0):** C-4 (`lobby_test` solo dev; `onAuth` en `game` con token de
   compra — enlaza con B-4 `/api/rooms/:id/access` + `playSessionStartedAt`), C-3 (`allowVideo`
   mínimo con política y del evento; `name`/`role` del servidor), F-3 (no auto-publicar), C-8
   (`maxMessagesPerSecond`), C-17.
4. **Sesión de juego robusta (P1):** C-1 (dedupe por `playerId` + `jti`), C-2 (`allowReconnection`,
   reasignación de host, herencia de inventario), C-18, C-6, C-7, C-14, C-15.
5. **DoS del formato (P0):** D-1 (topes en esquemas + `playerCounts` + clamp), D-2 (`durationSec ≥ 1`
   + tope por tick), D-11 (profundidad de `delay`), D-9 (memo del oráculo), D-27.
6. **Endpoints abusables (P1):** A-2 (analytics collect: whitelist + secreto s2s + cuota), A-3
   (moderación: umbral antes de actuar), A-4/D-4 + A-13/A-14 + A-6 + A-15 (OAuth: IP correcta,
   limitador Redis, TTL corto, `.max()`, reuse detection, redirect_uri, purga), A-9, B-6, B-7, B-10,
   A-16, A-20/D-6.
7. **RGPD y datos (P1):** A-5/E-5 (borrado completo + revocación OAuth + test de integración), E-3
   (clave derivada por dominio; unificar con helpers), E-16, E-8 (job de PDF sin códigos), E-10
   (redacción de logs), E-20, B-19.
8. **Ops y scripts (P0/P1):** E-1, E-2, E-21 (scripts), E-13 (compose), E-14 (integración en CI),
   E-15 (permissions, pin, Dependabot, `pnpm audit --prod`), §9.5 (bump `@better-auth/cli`), E-9
   (health + shutdown + helper), E-12, E-6 (particiones), E-11 (outbox de confirmaciones).
9. **Índices y consultas (P2):** B-13, B-14, E-7, A-18, B-24, B-23, E-23.
10. **Rendimiento tiempo real y HUD (P2):** C-9, F-4 (+ F-22 throttle de `setPlayers`), F-23, F-35,
    F-36, C-19 (índices de `RoomSession`).
11. **Editor y Phaser (P2):** D-17 + F-21 (transacción por trazo, diff del modelo), F-16 (dynamic
    RulesGraph), F-22, D-3 + D-10 (checks del validador, `toRuntimeModel` en publish), D-7, D-8, D-13,
    D-14, D-23, D-24.
12. **Frontend estructural (P2/P3):** F-2 (error/not-found/loading + boundaries), F-11 (memo del
    fixture), F-29 + F-20 (Promise.all, Suspense, caché de datos), F-12 (Sentry cliente), F-14
    (noindex + auth en editor), F-8, F-18, F-28, B-20/F-15, F-19, F-25, F-26, F-24 (lint plugins;
    hacerlo pronto para que los demás PRs lo aprovechen).
13. **shadcn e i18n (P3, obligatorio por ADR-019):** F-6, F-7, F-17, F-9, F-10, F-27, F-38, F-40.
14. **Deuda transversal (P3):** §9.1 (common, AdminDirectory, `createRestAdapter`), A-22, D-20, D-21,
    D-22, D-25, D-26, D-28, E-17, E-18, C-20, C-21, F-34, F-43..F-47, A-8 + C-13 + D-12 + §9.6
    (decidir spec por spec: implementar o retirar de la spec).

## 11. Huecos de tests (resumen)

- **Sin cobertura y críticos:** `sendMagicLink` (A-1); `PATCH playersPlanned` tras `payment_failed` +
  reintento (B-1); evento pagado obtiene sesiones (B-2, el test actual afirma lo contrario); fallo de
  `attachTransfer`/reintento de Transfer (B-3); reembolsos con reversal y parciales (B-5); reutilización
  de `joinToken` (C-1); desconexión de host/jugador con inventario (C-2); `allowVideo:true` contra
  política `false` (C-3); `durationSec ≤ 0` (D-2); tamaños hostiles del `RoomPackage` (D-1, D-11);
  `DELETE /api/me` invalida grants OAuth y limpia PII (A-5/E-5); reuse de refresh rotado (A-6);
  `analytics-collect` con tipos restringidos y cuota (A-2); coste del chat entre conversaciones (B-6);
  `memory` con símbolos duplicados y `per_player` real (D-7, D-8); objetos fuera de rejilla tras
  encoger (D-3); handshake del editor sin lista de orígenes (C-10); update > `maxUpdateBytes` (C-12).
- **Infra:** los `*.integration.test.ts` (Prisma/Redis/MinIO) nunca corren en CI (E-14);
  `@escaperoom/env` sin tests; scripts `.sh` sin `shellcheck`; `purchase-confirmation-email` del
  worker y el cableado/apagado de `main.ts` sin test.
- **Frontend:** overlay LiveKit, `CatalogFilters` en cliente (F-8), formularios de canje/invitación/
  contacto/reseña en navegador, `OnboardingWizard`, `EventDashboard`, `SpectatorView`, teclado/ESC del
  HUD, accesibilidad (sin axe), móviles, locales ≠ `es` en e2e, `RoomScene`/`AvatarController`
  (Phaser sin headless); `purchase-flow.spec.ts` en `fixme`.
- **Property-based:** no hay `fast-check`. Candidatos: paridad del deslizante, `encodeRowRle ∘
  decodeRle = id`, "todo tablero de `pipes` generado es resoluble", `compareValidationReports(r, r)`
  vacío, idempotencia del motor.

## 12. Lo que está bien (para no romperlo)

- Autorización en la capa de servicios verificada ruta a ruta (propietario/organizador/autor/admin
  en cada llamada; 404 uniforme en organizaciones): **no se encontró ningún IDOR** en REST.
- Tokens HMAC propios correctos (alg fijo, `timingSafeEqual` con igualación de longitud, separación de
  dominio, `aud` distinta para observador); OAuth 2.1 con PKCE S256, tokens por hash, código de un
  solo uso con `take` atómico, RFC 8707; confirmación humana de publicación y consentimiento OAuth
  rechazan `Authorization` y exigen `Sec-Fetch-Site`.
- Webhook de Stripe: firma antes de todo, idempotencia por `event.id`, escrituras condicionales
  `pending → succeeded`; créditos con función SQL + `CHECK ≥ 0`; canje bajo `FOR UPDATE` con cubo de
  fallos; publicación con lock, semver monotónico y token ligado a `packageHash`.
- Las soluciones nunca viajan al cliente (proyecciones `to*PublicView`, `toRuntimeModel`, detector
  de fugas en el E2E); handlers de Colyseus con Zod y rate limit por tipo y por puzzle; playtest con
  paquete congelado; `ProgressRecorder` que no bloquea el tick.
- CSP con nonce + `strict-dynamic`, sin `unsafe-eval` en producción, cabeceras fijas testeadas; el
  único `dangerouslySetInnerHTML` (JSON-LD) escapa `<`.
- Mail con escape HTML, cabeceras aplanadas, colas sin PII (releen Postgres); particiones con
  advisory lock y whitelist de nombres; storage privado con URLs firmadas cortas.
- Editor: ida y vuelta RoomPackage ⇄ Yjs exacta, convergencia concurrente probada, validador
  incremental con dry-run y caché; Phaser desacoplado de React con limpieza en `useEffect`.
- 1 700 tests unitarios en verde, typecheck y lint limpios, DB por worktree.
