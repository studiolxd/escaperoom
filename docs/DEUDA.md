# Deuda técnica

Tareas pendientes que no bloquean pero hay que resolver.

- [x] **Retirar `world-preview` o dejarlo solo para desarrollo.** Ruta
      `packages/web/src/app/[locale]/(creator)/world-preview/`. Resuelto:
      restringida con `isDevFallbackAllowed()` (mismo criterio que `/play`
      sin `?session`) — `notFound()` en producción, sigue disponible en
      desarrollo para validar el runtime a mano.
- [x] **`room-preview` solo accesible desde el editor.** Ruta
      `packages/web/src/app/[locale]/(creator)/room-preview/`. Resuelto con
      el mismo criterio que `world-preview` (`isDevFallbackAllowed()`) en vez
      de un token firmado/comprobación de autoría: la ruta no toma `roomId`
      ni previsualiza el borrador real de una sala, siempre renderiza la
      fixture fija del Rey Aldric — el editor real usa "Jugar"
      (`/api/rooms/:roomId/playtest`) para previsualizar la sala concreta, no
      esta ruta. Sin contenido de autor real que proteger, el token firmado
      propuesto en la redacción original de esta entrada no aportaba nada
      sobre `isDevFallbackAllowed()`.
- [x] **Mínimo y máximo de jugadores por sala, coherentes con sus pruebas.**
      Resuelto (PR de "mínimo y máximo de jugadores"):
      - **Configuración:** el editor tiene un botón "Jugadores" en la cabecera
        (`RoomPlayersDialog`) que abre un diálogo shadcn (`Dialog` + `Input`)
        para fijar `meta.players.min/max` (1–8, `MAX_PLAYERS_PER_ROOM_CEILING`),
        con validación de rango y de `min ≤ max` antes de escribir
        (`setRoomPlayers`, `packages/editor/src/room-doc/commands.ts`).
      - **Filtro del catálogo:** dos selectores "de X a Y" (1–8) en vez del
        único "N jugadores" (1–6). `CatalogListFilter` pasa a
        `playersMin`/`playersMax` con semántica de solape de rangos; SQL
        (`catalog-listing.ts`), parseo (`catalog.ts`) y caché
        (`CATALOG_CACHE_VERSION` a `v3`) actualizados. Compatibilidad con
        `?players=N` (equivale a `minPlayers=N&maxPlayers=N`) en REST, tRPC y
        la página del catálogo.
      - **Aviso al colocar una prueba:** `cooperativeRequirement` generaliza
        el requisito de una mecánica cooperativa a un número N de jugadores
        (antes solo el mensaje); `checkCooperativeBridges` (antes
        `checkSoloBridges`, limitado a 1 jugador) avisa para cualquier tamaño
        de grupo que la sala admite por debajo de N. El validador en vivo del
        editor (debounce de `RoomValidator`) ya recalcula esto en cada cambio
        del doc, así que el aviso aparece al colocar la prueba sin cableado
        adicional en el inspector.
      - **Aviso al revés:** por el mismo motivo, bajar `players.min`/`max` por
        debajo de lo que exige una prueba ya colocada dispara el mismo aviso
        generalizado en la siguiente pasada del validador (sin lógica nueva:
        `checkCooperativeBridges` ya recibe todo `playerCounts` derivado del
        rango vigente, no solo `1`).
      Tests: `packages/shared/test/solo-mode.test.ts` (N genérico),
      `packages/shared/test/catalog-filters.test.ts` (rango + compatibilidad),
      `packages/editor/test/room-doc-players.test.ts` (aviso al revés) y
      `packages/web/test/components/room-players-dialog.test.tsx` (UI).
- [ ] **Lobby como pantalla propia: diseño en el editor, introducción (texto/vídeo) y
      3-2-1.** Encargo `lobby-c13` (decisiones del usuario 2026-09-26): esta PR entrega
      solo la parte de C-13 (`set_ready`, `kick`, `player_left`, mínimo/"Empezar
      igualmente", analítica mínima por `onMilestone`) y C-20 (logging estructurado en
      `colyseus-server`), reutilizando el panel de lobby actual (overlay sobre el mapa,
      `lobby-panel.tsx`). Queda pendiente, para un encargo aparte por su tamaño:
      - El lobby como **sala diseñable en el editor** (tipo especial `lobby`: tamaño,
        suelo/muros, decoración, sin pruebas/puertas/ítems — validador + MCP + specs/10) y
        el lobby por defecto autogenerado para salas sin uno.
      - **Introducción** por sala (`meta.intro`, texto multiidioma **o vídeo** con
        subtítulos WebVTT, subida a SeaweedFS/R2 con límite de 200 MB y sniff de magic
        bytes, sin moderación previa) configurable en el editor ("Lobby e introducción").
      - **3-2-1** (3 s, sin botón de saltar) tras la introducción, y que el reloj de la
        partida arranque cuando el PRIMER jugador entra de verdad en el mapa (no al pulsar
        "Empezar") — `startedAt`/`endsAt` del servidor.
      - Que el **playtest** (editor y en red) pase por el lobby con un solo jugador
        (elegir personaje, Listo, Empezar) igual que la partida real.
      - Permitir entrar **tarde** a una partida ya empezada fuera de eventos (hoy solo
        funciona en eventos).
      - Dejar el disparo del inicio del lobby fácil de invocar desde fuera de la room
        (para el encargo siguiente, "Todos los grupos comienzan juntos").
- [ ] **Salas en 3D, además de 2D (muy largo plazo).** Permitir crear y jugar salas en
      3D, además de las 2D isométricas actuales, tanto en el creador (editor y MCP) como
      en el juego. Implica también una etiqueta **2D/3D** en cada sala y un **filtro
      2D/3D en el catálogo**. Antes de implementar: spec propia (motor de render 3D —
      Phaser 4 no trae 3D real, ADR-001 —, formato de la sala en el `RoomPackage`,
      assets y pipeline de `tools/assets-generator`, rendimiento en equipos modestos
      de colegios, paridad editor↔MCP y compatibilidad con las mecánicas y plantillas
      de puzzles existentes).
- [ ] **Extraer el motor de creación y de juego a un paquete compartido `@studiolxd` (muy
      largo plazo).** Sacar a un paquete propio de `@studiolxd` todo el motor de creación
      y de juego, para consumirlo desde aquí y desde una futura aplicación de la suite
      slxd:
      - **Aquí** se queda solo lo propio del SaaS (catálogo, compras y pagos, eventos y
        claves, organizaciones, reseñas, moderación, cuentas, páginas públicas y legales).
      - **En slxd**, un producto nuevo que consume el mismo paquete y permite crear escape
        rooms exportables a **SCORM** y con **xAPI** dentro de la suite.
      Antes de implementar: decidir qué entra en el paquete (candidatos: esquemas del
      `RoomPackage`, motor de reglas y sesión de `shared`, `game-runtime`, `editor` y
      plantillas de puzzles, validador, packs gráficos y, en parte, el toolset MCP y el
      protocolo de partida), cómo se publica y versiona (registro privado, semver, ADR-035),
      qué queda acoplado hoy a Prisma, Next o Colyseus y hay que abstraer, y cómo se
      empaqueta una partida para SCORM/xAPI (jugar sin servidor en red, con
      `createLocalGameClient`, y reportar progreso y resultado al LMS).
- [ ] **Usar los motores 2D/3D para otros géneros: RPG educativo (muy largo plazo).**
      Aprovechar el motor 2D actual (y el 3D, cuando exista) para crear, además de escape
      rooms, juegos tipo **RPG** como el onboarding de Studio LXD
      (`/Users/suvi/Dev/apps/onboarding`: Phaser + React, diálogos, paneles de
      información, pantallas interactivas y SCORM con `@studiolxd/scorm`): **NPC** con
      los que hablar, **diálogos** ramificados, **objetivos/misiones** y su seguimiento,
      progreso guardado y resultado reportable. Encaja con el paquete compartido
      `@studiolxd` (entrada de arriba): el motor sería común y cada producto (escape room,
      RPG) aportaría sus mecánicas. Antes de implementar: spec del modelo de juego
      genérico (qué es común — mapa, objetos, inventario, reglas, diálogos, sesión — y qué
      es propio de cada género), cómo se amplían el editor y el MCP, y si el catálogo y
      los eventos del SaaS admiten otros tipos de experiencia además de salas.
- [ ] **Decidir el dominio de producción.** Pendiente operativo, sin fecha. El Aviso
      Legal (`packages/web/src/content/legal/legal-notice.ts`) lleva un `[PENDIENTE]`
      con el dominio; al decidirlo, sustituirlo y revisar el resto de sitios que lo
      necesiten (`BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`, CSP, Plausible, emails, OAuth
      de Google y del MCP, Stripe).
- [ ] **Claves reales de analítica antes de desplegar en producción.** En
      desarrollo se activan Plausible y Google Analytics con valores de prueba
      (para ver el banner de consentimiento de cookies). Antes del primer
      despliegue en producción hay que poner los reales: dominio de Plausible
      registrado y el ID de medición de Google Analytics (`G-…`) de la
      propiedad real. El arranque en producción debe fallar si faltan o si
      siguen siendo los de desarrollo (mismo mecanismo que `requireInProduction`,
      PR #117); revisar también que los textos legales (`privacy.ts`,
      `cookies.ts`) describen la configuración real (dominio, retención de GA,
      transferencias internacionales de Google).
- [x] **Retirar la ruta de partida de prueba `/[locale]/play`.** Retirada:
      `/es/play` da 404. El canje de eventos que compartía la página (`?session=`)
      vive ahora en `/play/session/[sessionId]`. `game.reyaldric.spec.ts`
      (mecánica de juego, dos jugadores) y `game.reconnect.spec.ts` (recargar/
      cerrar y reabrir la pestaña) migraron a `/dev/game-room` — la "vía de
      pruebas limitada a test" prevista aquí: firma un `gameToken`
      `kind: "dev_test"` fresco en cada carga, `isDevFallbackAllowed`-gated
      como `world-preview`/`room-preview`, nunca en un despliegue real sin
      `ALLOW_DEV_SECRETS`. El tipo `dev_test` se queda (lo sigue usando la
      suite de tests de `colyseus-server`); ya no lo firma ninguna página ni
      endpoint. F-33 (lobby de pruebas) se retiró en el mismo encargo.
- [x] **Formularios con server actions, React Hook Form y errores bajo cada
      campo.** Revisar todos los formularios para que usen **server actions** +
      **React Hook Form** (con el `Form`/`Field` de shadcn/ui y el resolver de
      Zod) y muestren los errores **debajo de su campo**, nunca con la
      validación nativa del navegador (quitar `required`, `type="email"`,
      `minLength`/`maxLength`/`pattern` como mecanismo de validación y usar
      `noValidate`).
      - **Estado actual:** React Hook Form no está instalado; no hay ninguna
        server action (`"use server"`); los formularios envían con `fetch` a
        rutas REST y usan validación nativa. Existe `components/ui/field.tsx`.
      - **Formularios (`<form>`):** `components/auth/auth-form.tsx`,
        `catalog/review-form.tsx`, `contact/contact-form.tsx`,
        `redeem/redeem-form.tsx`, `mcp-oauth/consent-login.tsx`,
        `onboarding/onboarding-login.tsx`, `editor/room-languages-editor.tsx`,
        `game-session/network-game.tsx` (nombre del jugador),
        `app/[locale]/(play)/oauth/consent/page.tsx`. Los inputs de chat
        (`chat/chat-panel.tsx`, `creator-chat/creator-chat.tsx`) y los filtros
        del catálogo (`catalog/catalog-filters.tsx`) no son formularios clásicos:
        decidir caso por caso (al menos, sin validación nativa).
      - **Otras mutaciones con `fetch` desde componentes** a revisar si encajan
        como server actions: `room-cover-upload`, `event-dashboard`,
        `spectator-game`, `confirm-attendance`, `accept-terms-button`,
        `moderation-queue`, `onboarding-wizard`, `payouts-panel`,
        `confirm-publish`, `playtest-button`.
      - **No perder al migrar:** las server actions deben llamar a los mismos
        servicios de `@escaperoom/shared` y conservar el **rate limiting**
        (`withRateLimit`), la comprobación de origen/CSRF, el contrato de
        errores (A-22) y los mensajes traducidos (next-intl, 6 idiomas). Las
        rutas REST **siguen existiendo** (las usan el MCP, la API pública de
        specs/13 y los tests): las server actions son la vía de la UI, no un
        sustituto de la API. Esquemas Zod compartidos entre cliente
        (RHF) y servidor.
      - **UI:** solo shadcn/ui (`pnpm --filter @escaperoom/web exec shadcn add
        form` si hace falta), errores accesibles (`aria-invalid`,
        `aria-describedby`) y foco al primer campo con error.
      - **Referencia: mirar cómo está hecho en `/Users/suvi/Dev/slxd`** (solo
        lectura) y seguir el mismo patrón:
        - React Hook Form + `zodResolver`:
          `apps/account/src/components/auth/SignInForm.tsx`, `SignUpForm.tsx`,
          `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`,
          `InvitationSignUpForm.tsx`, y formularios en diálogo
          `apps/account/src/components/admin/AdjustCreditsDialog.tsx`,
          `GrantAddonDialog.tsx`, `GrantPlanDialog.tsx`.
        - Server actions con tests: `apps/web/src/actions/contact.ts` y
          `newsletter.ts` (+ `*.test.ts`),
          `apps/lmsmcp/src/app/[locale]/mcp/login/actions.ts`, y el contacto de
          `apps/corporate`.
        - Nota de slxd (SPEC.md, 2026-08-24): `react-hook-form` debe ser
          *external* si va en una librería de componentes compartida, porque
          empaquetado duplica el contexto del formulario.
      Resuelto: `react-hook-form` + `@hookform/resolvers` instalados en
      `packages/web`; el `form` de shadcn del registro actual es un stub
      vacío (sustituido por el patrón `Field`/`Controller` de RHF, que ya
      documentaba `components/ui/field.tsx`), así que los formularios usan
      `Field`/`FieldLabel`/`FieldError` + `register`/`Controller`,
      `noValidate` y `aria-invalid`/`aria-describedby`. Contrato de error de
      las Server Actions (`server/actions/action-result.ts`): mismo
      `{ code, message, issues? }` que A-22, con `consumeActionRateLimit`
      (reconstruye IP/sesión desde `headers()` para reutilizar
      `RATE_LIMIT_POLICIES`/`consumeRateLimit` sin `Request`). Migrados a
      server actions que llaman a los mismos servicios de
      `@escaperoom/shared` (rutas REST intactas): `contact-form.tsx`
      (`sendContactMessage`, cuota `contact-write`), `redeem-form.tsx`
      (`redeemAccessKey`, cuota `redeem`), `catalog/review-form.tsx`
      (`upsertRoomReview`, cuota `review-write`; no toca
      `server/rest/room-reviews.ts`, migrado aparte al contrato A-22) y
      `events/new-event-form.tsx` (`createMinimalEvent`; sin cuota, igual que
      la ruta REST que sustituye). `auth-form.tsx`, `mcp-oauth/consent-login.tsx`
      y `onboarding/onboarding-login.tsx` (Google + enlace mágico de Better
      Auth, no un servicio propio) comparten el hook `useEmailSignIn` con
      RHF; Better Auth ya gestiona su propio rate limiting/CSRF.
      `editor/room-languages-editor.tsx` no tiene servidor al que llamar
      (opera sobre el doc Yjs local): solo `noValidate`/`aria-invalid`/
      `aria-describedby`, sin RHF. `app/[locale]/(play)/oauth/consent/page.tsx`
      no aplica: el `<form>` de la decisión son campos ocultos + botones que
      se envían de forma nativa a propósito (flujo de redirección OAuth); no
      hay entrada de usuario que validar. Pendiente:
      `game-session/network-game.tsx` (excluido, zona del bloque 10 en
      paralelo) y las "otras mutaciones con `fetch`" (`room-cover-upload`,
      `event-dashboard`, `spectator-game`, `confirm-attendance`,
      `accept-terms-button`, `moderation-queue`, `onboarding-wizard`,
      `payouts-panel`, `confirm-publish`, `playtest-button`): quedan fuera de
      esta PR por alcance, sin cambios de comportamiento que perder.
- [x] **Páginas de error con la shell pública y componentes shadcn.** Las
      páginas de error actuales (`app/[locale]/error.tsx` y
      `app/[locale]/not-found.tsx`, PR #120) cuelgan de `[locale]`, fuera del
      grupo `(public)`, así que se muestran **sin** la cabecera y el pie públicos
      (`PublicHeader`/`PublicFooter` de `app/[locale]/(public)/layout.tsx`).
      Crear una página de error (404 y error genérico) que use la shell pública
      —extraer la shell a un componente reutilizable si hace falta— y solo
      componentes shadcn/ui (p. ej. `Empty`, `Button`), con los textos en los
      6 idiomas. `global-error.tsx` (sustituye al documento entero cuando falla
      el layout raíz) no puede usar la shell con garantías: mantenerlo mínimo
      pero coherente visualmente. Revisar también los `notFound()` de rutas
      privadas (editor, creador) para que no enseñen la shell pública si no
      corresponde.
      Resuelto: `app/[locale]/(public)/error.tsx` y
      `app/[locale]/(public)/not-found.tsx` nuevos, en el mismo segmento que
      `(public)/layout.tsx` — Next envuelve `error.tsx`/`not-found.tsx` con el
      `layout.tsx` de su propio segmento (no lo sustituye, solo el de
      segmentos por debajo), así que heredan la cabecera/pie públicos sin
      necesidad de extraer un componente de shell aparte. Mismos componentes
      shadcn (`Empty`, `Button`) que los genéricos de `[locale]`, con textos
      propios (`PublicErrorPage`/`PublicNotFound`, 6 idiomas) para no acoplar
      ambas versiones. Los genéricos de `[locale]/error.tsx` y
      `[locale]/not-found.tsx` (sin shell) se mantienen como respaldo para el
      resto de grupos (creador, jugar, auth): ninguno tiene `notFound()`
      dentro de `(public)`, así que ya no enseñan la shell pública por error
      — verificado (`editor/[roomId]`, `dev/rules-graph`, `dev/validation`,
      `play`). `global-error.tsx` ya estaba mínimo y coherente (no tocado).
- [x] **Versión (semver) automática al publicar según el cambio del
      `RoomPackage`.** `nextSemver(existing, requested?)`
      (`packages/shared/src/services/room-publish.ts`) aceptaba un semver
      pedido por el autor o, si no se pedía, subía el parche sin mirar qué
      había cambiado en el `RoomPackage`.
      Resuelto (ADR-035, `docs/reference/registro-de-decisiones.md`):
      `classifyRoomPackageChange` (`packages/shared/src/services/room-version-diff.ts`)
      clasifica el cambio comparando el paquete candidato con el de la última
      `roomVersion` publicada — MAJOR si se añade/quita algún `puzzles[]` (por
      `id`); MINOR si algún puzzle existente cambia de contenido, o una regla
      de `rules[]` añadida/eliminada/modificada referencia (en su `trigger`,
      alguna `condition` o `action`, con recursión en `delay`) un `puzzleId`
      presente en ambas versiones; PATCH para cualquier otra diferencia; y
      `NOTHING_TO_PUBLISH` (409) si no hay ningún cambio de contenido —
      `checkPublishable` (vista previa del editor y de la confirmación humana
      del MCP) no lo bloquea, solo informa. `nextSemver` ya no acepta un
      semver pedido; se quitó `semver` de `PublishInput` y de la validación de
      `POST /api/rooms/:roomId/publish` (el MCP y el editor no lo exponían).
      Tests: `packages/shared/test/room-version-diff.test.ts` y actualizados
      `room-publish.test.ts`/`publish-confirmation.test.ts`/`room-publish-api.test.ts`.
      `docs/specs/13-api-rest.md` y `docs/specs/08-formato-roompackage.md`
      actualizados. PR #156.
- [x] **Test inestable: muestreo de moderación.**
      `packages/shared/test/moderation-prisma.integration.test.ts` › "muestreo: la
      versión reciente entra una sola vez" fallaba de forma intermitente cuando
      la suite de `shared` corría en paralelo: `sampleRecentlyPublished({rate:1})`
      no filtraba por las salas del propio test y recogía `roomVersion` creadas
      por otros ficheros de integración. Pasaba siempre en aislamiento. Lo
      habían señalado varias PRs de la auditoría (#134, #135, #136, #141, #150).
      Resuelto: `listUnsampledVersions`/`sampleRecentlyPublished`
      (`packages/shared/src/services/moderation.ts` y
      `moderation-prisma-store.ts`) aceptan ahora un `roomIds` opcional (sin
      él, comportamiento global igual que antes — no cambia producción); el
      test lo pasa para contar solo su propia sala. Verificado con 5 pasadas
      seguidas de toda la suite de `shared` en verde (90 ficheros, 950 tests)
      contra Postgres. PR #156.
- [ ] **Definir la generación de assets con Magnific en la plataforma.** Magnific va a
      usarse (decisión del usuario, 2026-09-25): los textos legales ya lo declaran como
      proveedor activo. Falta definir la funcionalidad: qué podrá generar o editar un
      creador desde el editor (imágenes de objetos, fondos, retratos…), con qué flujo
      (prompt, referencias, aprobación por paso como en `tools/assets-generator`), cómo
      se cobra (créditos, como el audio de ElevenLabs en specs/15), moderación del
      resultado (specs/17), titularidad y licencia de lo generado (specs/18 §2),
      integración con la API de Magnific (credenciales, cuotas, reintentos), almacenamiento
      en R2 y cómo entra en el `RoomPackage`/pack. Escribir la spec antes de implementar.
      Referencia del uso interno actual: `tools/assets-generator/CLAUDE.md` ("Normas de
      trabajo con Magnific").
- [ ] **Publicar en R2 los packs generados por `tools/assets-generator`.** Hoy la salida
      de la herramienta (`packs/<pack>/salida/`) se copia a mano a
      `packages/web/public/packs/<pack>/` y se empaqueta con `pnpm pack:build`; el
      `manifest.json` y los atlas no se versionan, así que ni CI ni producción los tienen
      (en un clon limpio se ven placeholders). Definir e implementar el camino a
      producción (specs/26 §9): build del pack → subida de atlas y manifiesto a
      Cloudflare R2 con ruta versionada por pack y versión, cabeceras de caché/CDN, que
      el runtime cargue el pack desde R2 (URL del manifiesto por pack/versión) en vez de
      `public/`, credenciales y quién lo ejecuta (script manual o paso de CI). Decidir
      también el almacenamiento definitivo de los binarios de la herramienta (`fuentes/`,
      `entregas/`, `referencias/`, hoy solo en local y con copia en `pipeline-assets`).
- [x] **No enviar al cliente de red el contenido oculto de los objetos (auditoría D-26).**
      Resuelto (#174). `PublicRuntimeModel`/`PublicRuntimeObject`
      (`game-runtime` `loader/types.ts`) proyectan el `RuntimeModel` completo
      sin `inventory` ni `hidingSpot.contains` (`hasHidingSpot`/`inventoryCount`
      en su lugar, sin decir qué hay) — `hasHidingSpot`/`inventoryCount` son
      **obligatorios**, a diferencia de los campos que sustituyen, justo para
      que el compilador impida pasar un `RuntimeModel` completo donde se
      espera uno público (`toPublicRuntimeModel`, `load.ts`). `buildGameModel`
      (`web/src/lib/game-model.ts`, todos sus llamantes son partida en red:
      salas gratis/compradas, `playtest/[token]`, sesión de evento y
      observador) siempre devuelve la proyección pública; el modo
      local/playtest (`world/distribution.ts`, `world/inspection.ts`,
      `phaser/room-scene.ts` con `intentOnly: false`) y el inspector del
      editor siguen con `toRuntimeModel` a secas. La escena en red ya
      resolvía la interacción en modo `intentOnly` (nunca leía
      `object.inventory`); con el tipo público ya ni lo tiene disponible.
      Test que falla si se cuela `inventory`/`hidingSpot` en la proyección
      pública del Rey Aldric (`game-runtime` `test/loader.test.ts`).
- [x] **Mutaciones con `fetch` que quedaron fuera de la migración a server actions (#162).**
      Resuelto. De las diez pantallas, seis migraron a server action (mismo patrón que
      la #162, `server/actions/action-result.ts`: mismos servicios de
      `@escaperoom/shared`, misma cuota de `RATE_LIMIT_POLICIES` donde la ruta REST la
      tenía, mismo contrato de error): `confirm-attendance` (`confirmAttendance`),
      `accept-terms-button` (`acceptTerms`), `confirm-publish` (`confirmPublish`, repite
      los guardas 4.5/4.7 — rechazo de `Authorization` y `Sec-Fetch-Site: same-origin`,
      el chequeo Origin/Host de las Server Actions no basta por sí solo),
      `onboarding-wizard` paso 2 (`createOnboardingRoomAction`), `playtest-button`
      (`createPlaytest`) y las pestañas de reportes/apelaciones de
      `moderation-queue` (`resolveModerationReport`, `resolveModerationAppeal` — sin
      cuota, como las rutas REST: `ModerationService` ya exige `isModerator|isAdmin`
      en el propio servicio). La pestaña de audio de `moderation-queue`
      (`PATCH /api/admin/audio/:id`) se deja explícitamente sin migrar: otro agente
      va a retirar la moderación previa de audio (la pestaña y las rutas
      `/api/admin/audio*`), así que invertir ahí sería trabajo tirado. `event-dashboard`
      migró solo su mutación simple
      (`resendPendingInvitations`, cuota `invitation-resend-pending`); ninguna tenía
      campos de entrada que validar, así que ninguna necesitó React Hook Form (los
      botones no tienen formulario; la plantilla del wizard ya viene acotada por el
      `RadioGroup`). Se extrajeron `createOnboardingRoom`
      (`server/rest/onboarding.ts`) y `runPlaytestCreation`
      (`server/rest/room-playtest.ts`) para que el adaptador REST y la action
      compartan la misma orquestación sin duplicarla. Las rutas REST equivalentes se
      mantienen (las siguen usando el enlace del email, el MCP y los tests).

      Se quedan en `fetch`/REST, explicado en cada caso:
      - `room-cover-upload`: el límite por defecto de Server Actions en Next (1 MB) es
        menor que `UPLOAD_MAX_BYTES` (5 MB) y no hay `serverActions.bodySizeLimit`
        configurado — una action rompería subidas válidas hoy.
      - `event-dashboard` (resto): la carga del panel es *polling* (`GET` cada 5 s) y
        la exportación de PDF alterna entre una descarga síncrona (`blob`, no
        serializable desde una action) y un job encolado que también se sondea por
        *polling* — ambos casos son de los explícitamente excluidos (streaming/polling).
      - `spectator-game`: depende de la conexión en tiempo real a Colyseus (pide un
        token de observador y entra en la room), no es una mutación de dominio.
      - `payouts-panel`: ambos botones son redirecciones a Stripe Connect
        (`window.location.href` a una URL de onboarding/dashboard Express).
- [x] **F-5: partir `GameSessionShell` y `RoomPlaytestShell` (auditoría 2026-09-24, ALTA).**
      Resuelto: `RoomPlaytestShell` monta `GameSessionShell` (`createLocalGameClient`,
      `packages/game-runtime/src/session/local.ts`, ahora expone `session` de solo lectura
      para el checklist del Rey Aldric) — una sola máquina de estados para partida y
      playtest. `GameSessionShell` se partió en hooks (`useSceneSync`, `useHudHotkeys`,
      `useGameHud`) y subcomponentes (`HudHeader`, `ObjectsBar`, `PlayersAside`/`HudLogCorner`,
      `ContextMenuPopover`, `ItemPickerPopover`, `PanelHost`, `InventoryDialog`, `LobbyPanel`,
      `DialogButton`/`ImageDialog`) bajo `components/game-session/{hooks,components}/`. Lo
      propio del playtest (sin lobby, checklist de la ruta crítica, botón de reinicio,
      registro de depuración) entra por `variant="playtest"` y los slots
      `objectsBarHeader`/`objectsBarFooter`; `room-playtest-canvas.tsx` se retiró (el
      playtest reutiliza `GameSessionCanvas`, ahora con `emitAvatarMoves` en vez del modo
      `localPlayerId` desacoplado). Detalle completo y diferencias de comportamiento
      detectadas en la PR.
- [x] **E-23 (resto): configuración del worker centralizada.** Resuelto: `workerConfig`
      común (`packages/worker/src/config.ts`) lee de variables de entorno `WORKER_*`
      la concurrencia, `everyMs` o cron de cada factoría, con los mismos valores por
      defecto que tenía cada una fija en código; valida con Zod (enteros positivos,
      cron válido) y falla al arrancar con un mensaje claro si alguna es inválida.
      `main.ts` lo construye una vez y lo pasa a las 13 factorías. Documentado en
      `packages/worker/.env.example` y `docs/specs/24-operaciones-y-escalabilidad.md`
      §6.1 (tabla con recomendación de ajuste en producción).
- [x] **F-33: lobby de pruebas a 20 Hz.** Retirada junto con `/[locale]/play`:
      `lobby-canvas.tsx`/`lobby-store.ts`/`lobby-scene.ts`/`lobby-hud.tsx`/`lobby-shell.tsx`
      (web) y la room `lobby_test` (`colyseus-server`) ya no existen. Nada de producción
      dependía de ella; `ChatMessageState`/`RoomChat`/media, que compartía con la
      `GameRoom` real, se quedan (los tests de integración de chat/media pasan a una
      room de test mínima propia, `colyseus-server/test/helpers/chat-media-test-room.ts`).
- [x] **Tests de rate limit de `web` aún intermitentes bajo `pnpm verify:pr` (429).**
      Resuelto: `scripts/verify-pr.sh` añade un sufijo por EJECUCIÓN (PID + epoch) al
      `REDIS_PREFIX` del worktree antes de exportarlo, así que cada tirada de
      `pnpm verify:pr` empieza con un namespace de Redis limpio propio. Documentado en
      `docs/reference/verify-pr.md`. Verificado con dos `pnpm verify:pr --all` seguidas.
- [x] **Nightly E2E en rojo desde que existe (issue #115).** Resuelto, cinco causas
      (ejecución del 2026-09-26), junto con la retirada de `/[locale]/play`:
      1. **429 al iniciar sesión** (rate limit propio de Better Auth del enlace mágico
         bajo `NODE_ENV=production`): `auth.ts` lo desactiva con `isDevFallbackAllowed`
         (nunca en un despliegue real sin `ALLOW_DEV_SECRETS`).
      2. **`editor-publish`** (regalar copia editable) actualizado a la respuesta
         genérica de B-10 (202, nunca revela si el email existe); la sala forkeada se
         busca por Postgres directo (`support/db.ts`).
      3. **`game.reyaldric`** (pasos 7–11): el tablero de memoria usa `role="listbox"`,
         ya corregido en `support/game.ts`.
      4. **Prueba de carga** (`ten-sessions.ts`): firma un `gameToken` `kind: "dev_test"`
         para la `GameRoom` sin Postgres detrás; `set -o pipefail` en el workflow para
         que el `| tee` no oculte el código de salida.
      5. `relation "roomVersion" does not exist` al arrancar: paso explícito de
         migrar+sembrar antes de que Playwright arranque los servidores (mismo fix en
         `e2e-smoke` de `ci.yml`).
      Issue #115 cerrado.
- [x] **404 de URLs que no existen.** Resuelto (auditoría 2026-09-24, B-27):
      `app/[locale]/(public)/[...rest]/page.tsx` (comodín, llama a `notFound()`) captura
      cualquier URL con locale válido que ninguna otra ruta capturó, y sale con la shell
      pública (`(public)/not-found.tsx`). Las URLs sin prefijo de idioma que `proxy.ts` no
      redirige (su matcher trata un segmento con punto como asset estático, p. ej.
      `/v1.2-notas`) las cubre `app/global-not-found.tsx` (`experimental.globalNotFound`
      en `next.config.ts`): al no haber `app/layout.tsx` raíz (el root efectivo es
      `[locale]/layout.tsx`, un segmento dinámico), es la vía que documenta Next para ese
      caso — bypassa todo el árbol de layouts, con su propio `<html>/<body>` y copia fija
      en español (sin next-intl, no hay locale que resolver). Encontrado en la PR #153.
- [x] **Tests de rate limit deterministas.** Causa real (reproducida en verde/rojo alternando
      `pnpm verify:pr` varias veces seguidas, no la CPU): `scripts/verify-pr.sh` exportaba
      `REDIS_PREFIX=escaperoom` — el genérico, sin el sufijo por worktree — para TODA la
      tubería de `turbo`, incluido `packages/web:test`. Eso hacía que los tests de rate-limit
      de `web` (`rate-limit.test.ts`, `room-license-api.test.ts`, `onboarding-api.test.ts`,
      `moderation-api.test.ts`, `audio-generation-api.test.ts`), pensados para correr
      aislados con el store EN MEMORIA por proceso (ver "`REDIS_PREFIX` por worktree" de
      `docs/reference/verify-pr.md`), hablaran en realidad con el Redis real y PERSISTENTE de
      `infra/docker-compose.dev.yml`: las claves de cuota (`escaperoom:rls:*`, confirmado con
      `redis-cli KEYS`) sobrevivían de una tirada de `pnpm verify:pr` a la siguiente — y entre
      worktrees distintos, si ninguno tenía `REDIS_PREFIX` ya puesto en su shell — así que el
      429/403 dependía de qué había quedado sin expirar de la ejecución anterior, no de qué
      test corría. Arreglado: `scripts/verify-pr.sh` ahora lee el `REDIS_PREFIX` propio del
      worktree de `packages/shared/.env` (el que ya deja `pnpm dev:env`) antes de caer al
      genérico. Verificado con `pnpm verify:pr --all --no-e2e` en verde 3 veces seguidas tras
      limpiar las claves contaminadas por el diagnóstico.
      De paso, dos mejoras menores de determinismo que sí eran reales (aunque no la causa del
      429): `packages/kit/test/rate-limit.test.ts` tenía una espera real
      (`setTimeout(…, 1100)`), sustituida por un reloj inyectado — `MemoryRateLimitStore`
      ahora acepta un `Clock` opcional, como ya tenía `MemorySlidingWindowStore`; y se añadió
      `__resetInMemoryRateLimitersForTests()` (`packages/kit/src/rate-limit/index.ts`),
      llamado al principio de cada fichero de test que ejercita una ruta real limitada, como
      defensa adicional para que ningún test dependa del estado que deje otro. También E-22
      (auditoría): `RedisSlidingWindowStore` ya no falla abierto si Redis cae, cae a un
      `MemorySlidingWindowStore` por proceso (`docs/reference/seguridad.md` §1).
- [ ] **API pública para terceros (auditoría 2026-09-24, A-8).** `specs/13` describe una superficie
      REST también pensada para integradores externos (Bearer/API key, `Idempotency-Key`,
      `/api/me/purchases`, `/api/me/rooms`, alta de organización y miembros por REST, CRUD de salas
      por REST, grupos de sesión por REST, grabaciones, progreso de sesión por REST) que hoy no
      consume nadie: la UI usa tRPC y el creador el MCP (ADR-022). Decidido (2026-09-26): no se
      implementa hasta tener una versión chequeada del proyecto; se diseñará con el primer
      integrador real, probablemente un LMS vía LTI (también agencias de eventos o revendedores).
      Piezas que faltan cuando se retome:
      - Emisión y revocación de API keys por organización (hoy no hay ningún modelo de API key).
      - Cuotas por cliente (rate limiting propio, distinto del de sesión de usuario).
      - Idempotencia real vía cabecera `Idempotency-Key` (persistir la respuesta 24 h).
      - Documentación pública del contrato (OpenAPI o similar) y un compromiso de estabilidad
        (`specs/13` "el contrato evoluciona de forma aditiva" ya lo anticipa).
      - Las rutas en sí, marcadas "API pública — futura" en `specs/13`.
- [x] **Sala duplicada en el catálogo justo tras publicar (visto en el nightly, 2026-09-26;
      causa encontrada y arreglada 2026-09-26).** `catalogSelect()` (`DISTINCT ON`) nunca
      pudo devolver dos filas por sala, y `CatalogResults` solo mapea `rooms` una vez —
      confirmado con Redis en vivo (`redis-cli MONITOR` mientras se reproducía a mano) que
      la causa real era el CACHE del catálogo (`createCachedPublishedRoomListing`, Redis,
      TTL 60 s, ADR-027): la clave no cambiaba al publicar, así que una consulta LENTA que
      había empezado ANTES de publicar podía escribir (fire-and-forget) su foto vieja
      DESPUÉS de que otra petición más rápida ya hubiera cacheado la correcta, dejando el
      catálogo desactualizado (sala ausente o, según el orden exacto de esa escritura tardía
      frente a otras lecturas en vuelo, duplicada) hasta que expirase el TTL. Reproducido en
      local con inserciones directas en Postgres + peticiones concurrentes a `/rooms`
      mientras se observaba el tráfico real de Redis. Arreglo: `createCachedPublishedRoomListing`
      incluye ahora una GENERACIÓN en cada clave de cache
      (`packages/shared/src/services/catalog-listing.ts`), y `getRoomPublishService().publish`
      (`packages/web/src/server/services.ts`) la cambia (`invalidatePublishedRoomListingCache`)
      justo tras publicar: cualquier escritura tardía de una consulta anterior cae en una
      clave ya abandonada, y toda petición posterior a la publicación es un miss que relee
      Postgres. Tests de regresión en `packages/shared/test/catalog-listing-cache.test.ts`.
      Quitado el `.first()` de `editor-publish.spec.ts` (ya no hace falta).
