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
- [ ] **CTA "Jugar" no distingue salas de pago sin acceso** (frontend,
      complemento de B-4 / ticket 5.1).
      - **Dónde:** `packages/web/src/components/catalog/room-detail.tsx:181-183`.
        El botón principal siempre dice `t("playCta")` ("Jugar la sala") y
        enlaza a `/redeem`, sin mirar `room.priceCents` ni el acceso del usuario.
      - **Estado del backend (tras la PR #140):** ya existen
        `GET /api/rooms/:roomId/access` (`{owned, playable, gameToken?}`, con la
        compra libre / en curso / consumida) y el gate de compra en Colyseus
        (`GameRoom` exige `gameToken`; la partida se consume al terminar). El
        checkout individual (`POST /api/purchases/room-checkout`, Stripe
        Checkout, webhook, `checkout/confirmation`) también existe, pero ningún
        componente del frontend lo invoca. Sin `STRIPE_SECRET_KEY` el servicio
        de pagos es `null` (responde 501).
      - **Lo que falta en el frontend:**
        a. Pasar a `RoomDetailView` el estado de acceso del viewer a la sala
           (análogo a `viewer: ReviewViewerState`), leído de
           `GET /api/rooms/:roomId/access`.
        b. Si `room.priceCents > 0` y el viewer no tiene acceso: CTA "Comprar"
           (nueva clave `RoomDetail.buyCta` en los 6 idiomas) que llame a
           `POST /api/purchases/room-checkout` y redirija a `checkoutUrl`
           (patrón fetch + redirect de `payouts-panel.tsx`).
        c. Si el viewer no ha iniciado sesión: el CTA de compra lleva primero a
           login/registro con retorno a la sala, sin lanzar el checkout.
        d. Si el viewer ya tiene acceso (compra `playable`): mantener "Jugar la
           sala" (ver f). **No** tratar `priceCents === 0` como acceso libre:
           hoy no existe atajo de Stripe para precio 0 o nulo
           (`purchases.ts:192-194` rechaza `saleIndividual: false` o
           `priceCents: null` con `SALE_INDIVIDUAL_DISABLED`).
        e. Reutilizar `checkout/confirmation` como destino tras el pago.
        f. **Jugar una sala comprada:** con acceso `playable`, el CTA "Jugar"
           crea la `GameRoom` con el `gameToken` del endpoint de acceso (hoy
           `/es/play` solo firma partidas de prueba `dev_test`); si la compra
           está "en curso", reconectar a esa partida; si está consumida, mostrar
           que ya se jugó (y, si aplica, ofrecer volver a comprar).
        g. **`/redeem` solo para eventos:** el canje de clave de evento
           (`/redeem`) queda reservado a quien llega con un enlace o invitación
           de evento; nunca como destino genérico o de reserva del CTA de la
           ficha. El único caso legítimo para enlazar `/redeem` desde la ficha es
           que la sala tenga un **evento activo vinculado al viewer**.
        h. **Sala solo para eventos** (`saleIndividual: false`, `saleEvents:
           true`) — **decidido (2026-09-25):** etiqueta "Solo para eventos" y
           botón "Organizar un evento con esta sala", que lleva al flujo de
           crear evento con el precio por jugador visible. Cualquier usuario con
           sesión puede organizar un evento con una sala con venta para eventos
           (`events.ts createEvent`: solo exige `saleEvents` o ser el autor), así
           que es un camino real también para particulares. Si una sala no
           tuviera ningún modo de venta, no se muestra botón. Corregir specs/02
           §3.1, que dice "elige una sala que ya posee", para que refleje el
           código (cualquier sala con `saleEvents`).
        i. **Salas gratis** (precio 0 con venta individual) — **decidido
           (2026-09-25): se juegan sin cuenta.** Botón "Jugar gratis" que abre la
           partida sin iniciar sesión (sin `purchase` ni Stripe: el servidor
           emite el `gameToken` de una partida gratuita), con cuotas por IP
           contra abuso; la cuenta es opcional al terminar para guardar el
           resultado, reseñar o entrar en el ranking. Hoy no existe atajo de
           Stripe para precio 0 (`purchases.ts:192-194`), así que hay que crear
           este flujo. Actualizar specs/02 §2.2 (salas gratis) y specs/13 (acceso).
        j. **Etiqueta "Gratis" engañosa:** `room-card.tsx:12` muestra "Gratis"
           si `!room.priceCents`, es decir también con precio `null` (sala sin
           venta individual) y con precio 0 que hoy no se puede jugar. Mostrar
           "Gratis" solo con precio 0 y `saleIndividual: true`; con precio
           `null`, la etiqueta "Solo para eventos" del punto h.
- [ ] **Permitir valoraciones en medios puntos.**
      - **Estado actual:** `review.rating` es `Int @db.SmallInt`
        (`packages/shared/prisma/schema.prisma:431`), con `CHECK` en la base
        `review_rating_check` (`rating >= 1 AND rating <= 5`). La valoración de
        `packages/web/src/components/catalog/review-form.tsx` es un `RadioGroup`
        (shadcn, desde la PR #144) de 5 estrellas enteras. `ReviewItem` en
        `room-detail.tsx` pinta con `"★".repeat(review.rating)`, asume enteros.
      - **Depende de:** los componentes `StarRating` (soporta decimales/medios) y
        `RatingSummary`, que hoy solo existen en la rama del worktree
        `juego-en-vivo` (`packages/web/src/components/catalog/star-rating.tsx`);
        hacer esta tarea después de integrarla.
      - **Cambio necesario:**
        a. **Esquema/BD:** admitir medios puntos. Recomendado: escala doblada
           (guardar 2–10 enteros y dividir entre 2 en la capa de servicio) para
           evitar problemas de precisión; alternativa `Decimal(2,1)`. Migración
           de Prisma y actualizar `review_rating_check` al nuevo rango.
        b. **Servicio** (`packages/shared/src/services/reviews.ts` y
           `reviews-prisma-store.ts`): validar que el rating sea uno de
           {1, 1.5, 2, …, 5} (o {2..10} con escala doblada), no solo un entero
           entre 1 y 5; revisar también el esquema Zod de la API de reseñas y
           la media del catálogo (`catalog-listing.ts`, `AVG(rating)`), que con
           escala doblada debe dividirse entre 2.
        c. **Selector de valoración** (`review-form.tsx`): sustituir las 5
           estrellas enteras por un control con medios puntos (p. ej. dos zonas
           clicables por estrella: mitad izquierda = medio punto, mitad derecha
           = punto entero), reutilizando `StarRating` para el estado visual y
           manteniendo la accesibilidad de teclado del `RadioGroup` (solo
           shadcn/ui, ADR-019).
        d. **Listado de reseñas** (`ReviewItem` en `room-detail.tsx`): pintar el
           rating individual con `StarRating` en vez de `"★".repeat`.
        e. **Traducciones:** `RoomDetail.stars` ("{rating} de 5 estrellas") y
           `Reviews.ratingLabel` siguen valiendo, pero revisar el `aria-label`
           del nuevo selector (p. ej. "3,5 de 5 estrellas") en los 6 idiomas.
      - **Datos existentes:** los ratings enteros ya guardados (1–5) siguen
        siendo válidos; con escala doblada, la migración los multiplica por 2.
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
- [ ] **Versión (semver) automática al publicar según el cambio del
      `RoomPackage`.** Hoy `nextSemver(existing, requested?)`
      (`packages/shared/src/services/room-publish.ts`) acepta un semver pedido
      por el autor o, si no se pide, sube el parche. Cambiarlo por una
      clasificación automática comparando el paquete candidato con el de la
      última `roomVersion` publicada:
      - **Primera publicación** → siempre `1.0.0`.
      - **MAJOR** → cambia el conjunto de `puzzles[]`: se añade o se elimina
        algún puzzle (comparando por `id`, no por posición; reordenar sin
        añadir ni quitar no es MAJOR salvo que se decida lo contrario).
      - **MINOR** → mismo conjunto de ids de `puzzles[]`, pero algún puzzle
        existente cambia cualquier campo (tipo/plantilla, solución, pistas,
        capa, posición…). Sin granularidad por campo: cualquier modificación
        de un puzzle con el mismo id es MINOR.
      - **PATCH** → nada cambia dentro de `puzzles[]`; solo `objects`, `map`,
        `items`, `dialogs`, `hints`, `meta.assetsManifest` u otros campos de
        presentación/assets.
      - **`rules[]` (decidido, entra en el diff):** comparar también `rules[]`
        entre la versión anterior y la candidata, por `id` de regla igual que
        `puzzles[]`.
        - Si una regla se añade, elimina o modifica y referencia (en su
          `trigger`, `conditions` o `actions`) un `puzzleId` que existe en ambas
          versiones → cuenta como cambio de ese puzzle → **MINOR** (mismo
          criterio grueso, sin sub-clasificar campos de la regla).
        - Si la regla cambiada no referencia ningún `puzzleId` (solo
          `objectId`/`itemId` sin relación con un puzzle) → no dispara MINOR por
          sí sola; es un cambio de presentación/mundo → **PATCH** si no hay
          ningún otro cambio en `puzzles[]`.
        - Se evalúa después de la comprobación de MAJOR (añadir/quitar puzzles)
          y se combina con el diff de `puzzles[]`: si ya hay MAJOR, no hace falta
          mirar `rules[]`.
      - **Sin ningún cambio:** decidir si se permite publicar (como PATCH) o se
        devuelve un error explícito "nada que publicar", y documentarlo.
      - **Dónde:** función pura `classifyRoomPackageChange(previous: RoomPackage
        | null, candidate: RoomPackage): 'major' | 'minor' | 'patch'` en un
        módulo nuevo `packages/shared/src/services/room-version-diff.ts` (o
        junto a `nextSemver`). `nextSemver` deja de aceptar el semver pedido por
        el autor y recibe el resultado de la clasificación: MAJOR/MINOR ponen a
        cero los componentes inferiores (2.3.4 + MAJOR → 3.0.0; + MINOR →
        2.4.0; + PATCH → 2.3.5). Quitar `semver` de `PublishInput` y de la
        validación de la entrada.
      - **Tests unitarios:** añadir/quitar puzzle → MAJOR; modificar puzzle
        existente → MINOR; cambios solo fuera de `puzzles[]` → PATCH; primera
        publicación → 1.0.0; sin cambios → lo que se decida; y modificar una
        regla que apunta a un puzzle existente sin tocar el objeto puzzle en sí
        → MINOR (no PATCH).
      - **Documentación:** `docs/specs/13-api-rest.md` (quitar `semver` del
        contrato de `POST /api/rooms/:roomId/publish` y documentar la política
        automática); `docs/specs/08-formato-roompackage.md` (cómo se calcula el
        semver de `roomVersion` a partir del contenido); ADR nuevo en
        `docs/reference/registro-de-decisiones.md` (por qué se quita el
        override manual, por qué "puzzle cambió sí/no" y no campo a campo, y cómo
        se tratan los cambios de `rules[]`). Revisar también el MCP (`publish`)
        y el editor si exponen el semver manual.
      - **Fuera de alcance:** no tocar `meta.packageFormat` (es la versión del
        formato del contrato, ortogonal a la del contenido); no hay UI de
        rankings ni notificaciones a compradores que actualizar. Si se toca la
        pantalla de confirmación de publicación, solo shadcn/ui (ADR-019).
- [ ] **Retirar la ruta de partida de prueba `/[locale]/play`.** Debe desaparecer
      antes de pasar a producto; en realidad se puede quitar en cuanto esté
      hecho el flujo de **salas gratis jugables sin cuenta** (punto i de la
      entrada "CTA 'Jugar'…"), que la sustituye como forma de jugar una sala sin
      compra. Hoy ya responde 404 en producción salvo con `ALLOW_DEV_SECRETS`
      (PR #140: firma `gameToken` `dev_test`). Al retirarla, migrar lo que
      depende de ella: el e2e de partida (`packages/e2e/tests/game.reyaldric.spec.ts`,
      smoke de CI) y el de reconexión del bloque 4 deben usar el flujo de sala
      gratis (o un endpoint de pruebas equivalente limitado a test); quitar el
      tipo de token `dev_test` si ya no se usa; revisar enlaces internos y docs
      que la mencionen.
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
- [ ] **Test inestable: muestreo de moderación.**
      `packages/shared/test/moderation-prisma.integration.test.ts` › "muestreo: la
      versión reciente entra una sola vez" falla de forma intermitente cuando
      la suite de `shared` corre en paralelo: `sampleRecentlyPublished({rate:1})`
      no filtra por las salas del propio test y recoge `roomVersion` creadas por
      otros ficheros de integración (y su limpieza choca por FK con esos otros
      tests). Pasa siempre en aislamiento. Aislarlo: que el test solo cuente sus
      propias salas (filtro por ids o por un autor/etiqueta propios) o que el
      muestreo acepte un filtro inyectable en tests. Lo han señalado varias PRs
      de la auditoría (#134, #135, #136, #141, #150).
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
