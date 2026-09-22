# 04 — Runtime de juego y mundo

Depende de `03-arquitectura-y-stack.md` y `08-formato-roompackage.md`. La gestión de
interacciones con el servidor está en `11-protocolo-multijugador.md`; la lógica de reglas en
`05-motor-de-reglas-y-estado.md`.

---

## 1. Modelo de mundo

- **Mapa isométrico por habitaciones.** Cada habitación (`SubRoom`) es un mapa propio con su
  grid, capas de tiles, decoración, spawn points e iluminación. Las puertas enlazan mapas.
- **Grid y proyección.** Las posiciones se guardan en celdas de grid (origen arriba-izquierda,
  `0,0`); el runtime las proyecta a coordenadas isométricas. Las entidades referencian celda
  `(x, y)` + capa de colisión.
- **Capas de tilemap** (`TileLayer[]`): suelo, paredes, decoración, objetos. Se serializan en
  RLE (`[cantidad, tileId, ...]`) para compacidad.
- **Depth-sort** por coordenada isométrica del sprite (`y` visual, no de la celda) para que los
  avatares pasen correctamente por delante/detrás de objetos.
- **Cámara y zoom** gestionados por Phaser; transiciones de sala con fade.
- **Cámara y oclusión (revisión 2026-09-22, ADR-001):** isométrico **fijo** (sin rotación de cámara)
  y **sin elevaciones/multinivel en v1** — rejilla plana con paredes en dos lados, para que la
  autoría (editor y MCP) sea tan simple como un top-down. **Política de oclusión:** las paredes y
  objetos que quedan por delante de un avatar se desvanecen (alpha) automáticamente.
- **Arte:** puede producirse como **sprites isométricos pre-renderizados desde 3D** (3D para
  producir, 2D para jugar); si se usa IA para generar arte, revisar titularidad/licencias
  (`specs/18`).

## 2. Avatares y movimiento

- Un sprite base por jugador con **tintado por color** (4 colores = 4 jugadores en v1) y
  animaciones mínimas: `idle` (2 frames), `andar` (4 direcciones × 4 frames), `interactuar` (1).
  Sin personalización en v1.
- El movimiento es **autoritativo en servidor**: el cliente pide, el servidor valida distancia
  máxima por tick (anti-teletransporte), el resto de clientes interpolan.
- El sistema deriva `enter_room` server-side al cruzar umbrales; el cliente no lo envía.

## 3. Sistema de objetos del mundo (`WorldObject`)

### 3.1 Definición y estados

```typescript
interface WorldObject {
  id: string;                     // "arca-trono" (IDs legibles)
  roomId: string;
  type: string;                   // puerta | cajon | estatua | placa | escondite | mecanismo | decorativo
  position: { x: number; y: number };
  sprite: string;
  states: Record<string, SpriteState>;  // "closed" → spriteA, "open" → spriteB + animación
  initialState: string;
  inventory?: string[];           // items que contiene (cajones, arcas)
  lockedBy?: string;              // puzzle que lo bloquea
  interactable: boolean;
  distribution?: 'first_click' | 'all_players' | 'assigned'; // al abrir un objeto con inventario
  hidingSpot?: { contains: string };  // escondite: objeto que oculta
  leadsTo?: string;               // puertas: habitación destino
}
```

- Los estados son **strings arbitrarios definidos por el creador** (`lit`, `broken`,
  `rotated_90`) con sprite/animación asociado. El runtime no impone vocabulario cerrado: solo
  sabe pintar el estado actual.
- Estados con animación de transición opcional (`animation: "slide_up"`).

### 3.2 Objetos con inventario interno

Cajones, arcas y cofres declaran `inventory: ["llave-bronce"]`. Al abrirse (regla o puzzle), el
contenido pasa a la "zona de descubrimiento". Comportamiento configurable con `distribution`:

- `first_click` — solo quien abre recoge.
- `all_players` — todos ven el contenido.
- `assigned` — asignación explícita.

### 3.3 Estáticos vs. animados

- **Estáticos (decoración pura):** alfombras, cuadros sin interacción. Se **bake-an** en la capa
  de decoración del tilemap y no son entidades.
- **Animados / entidades:** todo lo que cambia de estado o se inspecciona. Viven como entidades
  con estado sincronizado en Colyseus (solo estas viajan por la red).
- **Límite de rendimiento:** máximo ~200 entidades animadas por sala; el resto se bake-a. El
  editor advierte si el creador se pasa.
- Los **escondites** son entidades con `hidingSpot` y sprite de cobertura (la dificultad es
  puramente escenográfica: el sprite que tapa la llave).

### 3.4 Iluminación

- Iluminación por habitación (`lighting`): luces de antorcha ligadas a `objectId` (reactivas al
  estado del objeto) y luz ambiental (`color`, `intensity`).
- La iluminación puede ser **reactiva a puzzles**: p. ej. las antorchas de la escalera se
  encienden cuando `mesa-catas` pasa a estado `active` (feature del runtime, no del formato).
- **Caída suave obligatoria:** el foco de luz se difumina en su borde (degradado radial), nunca un
  círculo de borde neto. El halo del demo de 0.4 (`add.circle`) es un placeholder: se implementa de
  verdad aquí, con la iluminación por `SubRoom`.

## 4. Interacción del jugador con el mundo

- Objetos interactuables muestran brillo/pista al acercar el cursor.
- **Selección y menú contextual.** Al seleccionar un objeto (clic o Espacio cerca de él) no se
  resuelve nada de inmediato: se abre un **menú contextual** con las acciones disponibles para ese
  objeto. En v1 son `Inspeccionar` y `Usar objeto…`. El menú es **extensible por datos**: las
  acciones se derivan de las reglas que el creador declara para el objeto (`on_interact` →
  `Inspeccionar`, `on_use_item` → `Usar objeto…`); si el paquete no declara ninguna, se ofrece el
  set base. Así, añadir una regla amplía el menú sin tocar la UI.
- **Intención vs. resolución.** La escena Phaser **no** resuelve diálogos, estado ni paneles por su
  cuenta: emite la intención (`interact { objectId }` / `use-item { itemId, objectId }`) y quien
  la resuelve es la sesión de sala (`specs/05`), que devuelve diálogo, estado del mundo y panel
  asociado. Esto evita el doble diálogo y mantiene una única fuente de verdad.
- `Inspeccionar` dispara la evaluación de reglas `on_interact` del objeto y, si procede, el puzzle
  de mundo asociado (Phaser) o la apertura de un panel (React).
- `Usar objeto…` abre el inventario para **elegir** un item y emite `on_use_item` (specs/05 §3).
  El mismo evento se emite al **arrastrar** (drag&drop) un item del inventario sobre un objeto del
  mundo. Ejemplo canónico: el armario se abre por las tres vías (menú desde Espacio, menú desde
  clic y arrastre de la llave sobre el armario).
- Al inspeccionar, se muestran diálogos/descripciones (`show_dialog`).
- **El diálogo se cierra** al completarse la acción (usar un objeto con éxito, abrir un candado,
  resolver un puzzle) o con `Esc`; no se queda abierto bloqueando.
- **La intro bloquea el juego**: hasta cerrar el diálogo de intro no se puede mover al avatar ni
  interactuar.
- **Selección de objeto fiable**: la interacción apunta al objeto **interactuable más cercano a la
  celda del avatar** (no a coordenadas de pantalla); con varios candidatos, gana el más próximo y
  nunca "salta" a otro objeto. Si el jugador **hace clic en un objeto**, el avatar **camina hacia
  él** y, al llegar, se abre su menú/interacción. _(Pendiente: ticket 1.14)._
- El patrón "Phaser lanza un puzzle en React": el jugador hace clic en el arca candada (Phaser)
  → Phaser emite el evento → React monta `<CodeLockPuzzle code={...} onSolve={...} />` → al
  resolver, React notifica al estado de partida → Phaser abre la tapa con animación.

## 5. Fases de la partida

```
created ──> lobby ──> playing ──> ended
                │         │
                │         └── paused (pausa de organizador, máx 5 min acumulados)
                └── aborted (todos salen antes de empezar)
```

- `created → lobby`: al crear la sesión (comprador u organizador).
- `lobby → playing`: cuando el host pulsa "Comenzar" (o auto-arranque tras X min configurado).
- El estado de fase vive en `GameState.phase` y se sincroniza como cualquier otro campo.
- El detalle de mensajes y permisos está en `specs/11-protocolo-multijugador.md`.

## 6. Cronómetro, pistas y fin de juego

- **Cronómetro** opcional definido por la sala (`timeLimitSec`; el Rey Aldric usa 3600 s). Se
  inicia en `on_game_start` con un `start_timer` y termina con `end_game result=timeout`.
- **Pistas limitadas**: sistema de tiers con coste, definido en la sala (`hints`), consumido por
  `hint_request`. Cada pista usada reduce la puntuación final.
- **Condición de victoria**: la define el creador con reglas (p. ej. `on_puzzle_solved` del
  candado final + `object_state_is altar=flowing` → `end_game result=victory`).
- **Pantalla de resultados**: tiempo, puntuación, logros y acceso a reseña.

## 7. Audio

- **Música ambiental por habitación**, efectos de interacción y voces del narrador.
- Tres fuentes para el creador: biblioteca incluida, subida propia y generación IA (ElevenLabs).
  Detalle en `specs/15-audio-y-creditos-ia.md`.
- Cabecera dinámica producida por Spotify (crossfade) es un objetivo de v2; en v1, música
  ambiental por sala con fade.

## 8. Alcance gráfico mínimo v1 (sala de prueba)

Solo lo imprescindible para construir y demear el Rey Aldric; ampliación diferida a v2. Todo
encargable como un único pack. El **brief y contrato de entrega** completo está en
`26-pack-grafico-v1.md`.

### Tileset (1 pack: medieval)

- Suelo: 4–6 baldosas (piedra, loseta, alfombra roja).
- Paredes: 4 variantes + 2 con decoración (antorcha, tapiz).
- Transiciones: puerta de madera (cerrada/abierta), arco, escalera.
- Decoración bake-able: columna, estandarte, cuadro (2), alfombra, barril, cajas, sarcófago,
  altar, mural.

### Avatares

- 1 sprite base con tintado por color (4 colores) + animaciones mínimas descritas en §2.

### Objetos de puzzle (sprites sueltos)

- Llave (bronce/plata/oro como tintados), candado, cáliz, mechero, vela, antorcha, espejo,
  palanca, placa de presión, copa ×6, azulejo de mural, pieza de tubería ×4 tipos, relicario.

### Efectos

- Partícula única reutilizable (brillo dorado) para reveals, aciertos y magia.
- Transición de fade entre salas.

### UI

- HUD mínimo: cronómetro, contador de pistas, **botón/tecla de inventario** (`I`).
- **Panel de inventario** (se abre con `I` o su botón del HUD, **no** desde el guion de test):
  - grid de slots con el **icono real** de cada item (con fallback a inicial/texto si falta el
    icono del pack); el inventario **cerrado** también muestra los iconos en el HUD.
  - **Combinar**: arrastrar un item **sobre otro** del inventario (o seleccionar dos → botón
    "Combinar" como alternativa accesible). No hay "zona de combinar" aparte.
  - El **nombre** de un item se puede pulsar (seleccionar) y hacer clic en el mundo no debe
    colarse por debajo del panel abierto.
- Avatares en chat/voz: círculo con color + inicial.
- **Todos los controles usan los `Button` de shadcn/ui** (ADR-019), con contraste suficiente en
  reposo — no solo en `:hover`.

**Total estimado: ~35 tiles + ~20 sprites + 1 atlas de avatar.** Se encarga en Fase 1 (ver
`plan/fase-1-runtime.md`) y dura todo el MVP. **Producción admitida (ADR-001):** sprites isométricos
**pre-renderizados desde 3D** (3D para producir, 2D para jugar), que da acabado 3D sin runtime 3D.

## 9. Dependencias

- `specs/05-motor-de-reglas-y-estado.md` — cómo las interacciones mutan el estado.
- `specs/08-formato-roompackage.md` — de dónde sale cada definición del mundo.
- `specs/11-protocolo-multijugador.md` — mensajes `interact`, `move`, broadcasts de estado.
