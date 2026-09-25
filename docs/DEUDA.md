# Deuda técnica

Tareas pendientes que no bloquean pero hay que resolver.

- [ ] **Retirar `world-preview` o dejarlo solo para desarrollo.** Ruta
      `packages/web/src/app/[locale]/(creator)/world-preview/`. Decidir si se
      elimina o si se restringe a entorno de desarrollo (no accesible en
      producción).
- [ ] **`room-preview` solo accesible desde el editor.** Ruta
      `packages/web/src/app/[locale]/(creator)/room-preview/`. Que no se pueda
      abrir directamente por URL, solo lanzándola desde el editor.
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
- [ ] **Páginas de error con la shell pública y componentes shadcn.** Las
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
