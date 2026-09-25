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
