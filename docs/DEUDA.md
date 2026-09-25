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
        d. Si `room.priceCents === 0` o el viewer ya tiene acceso: mantener
           "Jugar la sala".
        e. Reutilizar `checkout/confirmation` como destino tras el pago.
        f. **Jugar una sala comprada:** con acceso `playable`, el CTA "Jugar"
           crea la `GameRoom` con el `gameToken` del endpoint de acceso (hoy
           `/es/play` solo firma partidas de prueba `dev_test`); si la compra
           está "en curso", reconectar a esa partida; si está consumida, mostrar
           que ya se jugó (y, si aplica, ofrecer volver a comprar).
