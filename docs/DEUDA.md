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
- [ ] **Mínimo y máximo de jugadores por sala, coherentes con sus pruebas.**
      - **Configuración:** la sala declara mínimo y máximo de jugadores
        (`meta.players { min, max }` ya existe en el formato, techo 8); comprobar
        que el editor permite fijar ambos de forma clara.
      - **Filtro del catálogo:** hoy es un único selector "N jugadores" (salas
        con `min ≤ N ≤ max`, opciones 1–6 aunque el techo es 8). Cambiarlo para
        filtrar por mínimo y máximo de jugadores y ajustar las opciones al techo
        real.
      - **Aviso al poner una prueba:** si una prueba necesita varios jugadores
        (p. ej. placas simultáneas con 2 o más placas, pista dividida entre
        varios puntos de vista) y la sala admite menos jugadores de los que
        exige esa prueba (marcada para 1 jugador y la prueba es de 2; prueba de
        3 o más y la sala baja de ese número), el editor debe avisar en el
        momento de colocarla, para que el creador añada un camino alternativo
        (objeto-puente u otra forma de resolverla). Hoy el validador solo cubre
        el caso de 1 jugador (`solo_bridge_missing`) y solo al validar.
      - **Aviso al revés:** si en la configuración de la sala se baja el mínimo
        (o el máximo) por debajo de lo que exigen las pruebas ya colocadas, el
        editor debe avisar indicando qué pruebas quedan sin camino para ese
        número de jugadores.
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
- [ ] **Retirar la ruta de partida de prueba `/[locale]/play`.** Debe desaparecer
      antes de pasar a producto. El flujo de **salas gratis jugables sin
      cuenta** que la sustituye como forma de jugar una sala sin compra ya
      existe (`GET /api/rooms/:roomId/free-access` + `/play/room/:roomId`,
      cerrado en la PR del CTA de la ficha de sala, 2026-09-25) — falta
      migrar lo que aún depende de `/[locale]/play`. Hoy ya responde 404 en
      producción salvo con `ALLOW_DEV_SECRETS` (PR #140: firma `gameToken`
      `dev_test`). Al retirarla, migrar lo que depende de ella: el e2e de
      partida (`packages/e2e/tests/game.reyaldric.spec.ts`, smoke de CI) y el
      de reconexión del bloque 4 deben usar el flujo de sala gratis (o un
      endpoint de pruebas equivalente limitado a test); quitar el tipo de
      token `dev_test` si ya no se usa; revisar enlaces internos y docs que la
      mencionen.
- [ ] **Formularios con server actions, React Hook Form y errores bajo cada
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
- [ ] **404 de URLs que no existen.** Una URL sin ninguna página que la capture (p. ej.
      `/es/una-ruta-que-no-existe`) no llega a `[locale]/not-found.tsx` ni a
      `(public)/not-found.tsx`: al no haber `app/not-found.tsx` ni `app/layout.tsx` raíz
      (el layout raíz efectivo es `[locale]/layout.tsx`), Next sirve su 404 por defecto,
      en inglés y sin estilos. Añadir una ruta comodín (`app/[locale]/(public)/[...rest]/
      page.tsx` que llame a `notFound()`) para que use el 404 con la shell pública, y
      cubrir también las rutas sin prefijo de idioma. Encontrado en la PR #153.
- [ ] **Tests de rate limit deterministas.** Los tests de rate limit de `packages/web`
      (`rate-limit.test.ts`, `room-license-api.test.ts`, `onboarding-api.test.ts`,
      `moderation-api.test.ts`, `audio-generation-api.test.ts`…) usan ventanas de tiempo
      reales con el limitador en memoria y fallan con `429` inesperados cuando la máquina
      va cargada (varios agentes a la vez, `turbo` lanzando lint+typecheck+test+build).
      Como `pnpm verify:pr` aborta en el primer fallo, el smoke E2E ni llega a correr: lo
      han sufrido casi todas las PRs de la auditoría (#146–#155). Hacerlos deterministas:
      reloj inyectable en el limitador (o `vi.useFakeTimers`), identificadores únicos por
      test (IP/usuario) y sin depender de la velocidad de la máquina.
