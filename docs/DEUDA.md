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
