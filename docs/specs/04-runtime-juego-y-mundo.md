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
  objetos que quedan por delante de un avatar se desvanecen (alpha) automáticamente. Implementación
  v1 (dado el guarda de "sin elevaciones"): un muro es "de frente" (más cerca de la cámara; su cara
  hacia la sala nunca la ve la cámara) cuando la celda vecina hacia el interior (`tx-1` o `ty-1`)
  está libre de muro — es la última barrera antes del interior transitable —, así que se pinta con
  alpha reducido de forma fija (no depende de dónde esté el avatar), dejando ver el interior y lo
  que cuelga de ella (puerta, reja, mirillas…). Un muro de refuerzo detrás del que lleva el hueco
  (p. ej. una fila de cierre extra) queda oculto tras el de frente y no hace falta desvanecerlo.
- **Arte:** puede producirse como **sprites isométricos pre-renderizados desde 3D** (3D para
  producir, 2D para jugar); si se usa IA para generar arte, revisar titularidad/licencias
  (`specs/18`).

## 2. Avatares y movimiento

- **8 personajes medievales seleccionables** (caballero/a, arquero/a, mago/a, campesino/a; el
  primero entregado es `caballero-m`, `26-pack-grafico-v1.md` §4.4), no un sprite tintable: cada
  jugador elige uno y **dos jugadores de la misma sesión no pueden tener el mismo personaje**
  (`specs/11` §3, `specs/19` §1). El servidor valida el personaje contra `manifest.avatars` y los
  ya ocupados; el color del jugador (tint) sigue existiendo, pero ahora pinta un **anillo bajo los
  pies** para distinguir jugadores, no el sprite del personaje.
- **Mientras falten personajes** (hoy solo `caballero-m`): al unirse sin elegir, el servidor asigna
  el primer personaje libre; si no queda ninguno libre, el jugador usa el **maniquí de reserva**
  (el sprite SVG tintado por color que existía antes de esta decisión), que no es único — varios
  jugadores pueden compartirlo, distinguibles por el anillo.
- Animaciones por personaje: `idle` (8 frames), `andar` (4 direcciones × 8 frames), `interactuar`
  (4 frames) — 80 frames por personaje.
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
  name?: LocalizedText;            // nombre visible (auditoría F-27); sin él, el runtime lo
                                    // deriva del diálogo de inspección o cae a un genérico
                                    // traducido — nunca al `id` técnico
  states: Record<string, SpriteState>;  // "closed" → spriteA, "open" → spriteB + animación
  initialState: string;
  inventory?: string[];           // items que contiene (cajones, arcas)
  lockedBy?: string;              // puzzle que lo bloquea
  interactable: boolean;
  distribution?: 'first_click' | 'all_players' | 'assigned'; // al abrir un objeto con inventario
  hidingSpot?: { contains: string };  // escondite: objeto que oculta
  leadsTo?: string;               // puertas: habitación destino
  footprint?: { x: number; y: number }[]; // celdas adicionales que ocupa (huella de varias celdas)
}
```

- Los estados son **strings arbitrarios definidos por el creador** (`lit`, `broken`,
  `rotated_90`) con sprite/animación asociado. El runtime no impone vocabulario cerrado: solo
  sabe pintar el estado actual.
- Estados con animación de transición opcional (`animation: "slide_up"`).
- **Objetos con huella de varias celdas** (`specs/26` §2, p. ej. una mesa 1×3 o un sarcófago 1×2):
  `footprint` declara las celdas **adicionales** a `position` (el ancla). Colisionan todas; el
  depth-sort y el orden de dibujo siguen usando solo la celda del ancla.

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
- Al inspeccionar, se muestran diálogos/descripciones (`show_dialog`) y, cuando la pista es un
  conteo que no se lee al tamaño del sprite (dragones de un tapiz, torres de un cuadro, vasijas…),
  una imagen grande (`show_image`, `specs/26` §3.4/§6.1): abre un panel con la imagen de
  `entregas/objetos/inspeccion/` subida con el pack (`inspect/<nombre>.png`). Sin esta acción, el
  mínimo es un `show_dialog` descriptivo.
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

- **Duración de partida** (ticket duración-salas, sustituye a la redacción anterior de este
  apartado): límite general de tiempo declarado por la sala en `meta.timeLimitMinutes`
  (`specs/08-formato-roompackage.md` §2) — **opcional, sin tope máximo**. Tres estados:
  - **ausente** (sala publicada antes de este campo): retrocompatible con 60 min
    (`DEFAULT_ROOM_TIME_LIMIT_MINUTES`, el límite fijo que ya tenían todas las salas).
  - **`null`**: sin duración, marcado explícitamente por el creador — partida sin límite de
    tiempo.
  - **entero positivo**: el límite en minutos.

  El **servidor** es siempre quien lo aplica (`GameRoom.timeLimitSeconds()`, nunca el cliente); al
  agotarse dispara `end_game result=timeout` (§8.1 del protocolo). Un **evento** puede sobrescribir
  este valor para SUS sesiones (`specs/02-modelo-de-negocio.md` §7): más corto, más largo o sin
  límite, por encima del de la sala.
- **Cronómetro por reglas** (`start_timer`/`on_timer_end`): mecánica DISTINTA, propia de un puzzle
  o de una regla concreta de la sala (p. ej. una cuenta atrás de 30 s tras activar una palanca), no
  el límite general de la partida. Una sala puede tener cero, uno o varios de estos timers de
  reglas, independientes de `meta.timeLimitMinutes`.
- **Sin duración — reconexión y compra B2C**: sin límite de tiempo, ni el "en curso" de una compra
  B2C ni los tokens de reconexión pueden caducar por un plazo fijo pensado para partidas de máximo
  1 h — ver `specs/11-protocolo-multijugador.md` §8 (latido de la reclamación, TTL del `joinToken`)
  y `specs/13-api-rest.md` (compra B2C).
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

- 8 personajes seleccionables (uno entregado hoy, `caballero-m`) + el maniquí de reserva, con las
  animaciones descritas en §2. Anillo de color de jugador (no tintado del sprite) y sombra de
  contacto los dibuja el runtime, no el pack (`26-pack-grafico-v1.md` §4.4).

### Objetos de puzzle (sprites sueltos)

- Llave (bronce/plata/oro como tintados), candado, cáliz, yesquero, vela, antorcha, espejo,
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

## 10. Introducción: vídeo y subtítulos

La introducción de vídeo (`meta.intro = { type: "video", video, subtitles? }`, encargo
lobby-diseño) es un fichero del creador, no del pack gráfico. Límites y flujo:

**Formatos y límites** (`packages/shared/src/schemas/limits.ts`):

- Vídeo **MP4 (H.264) o WebM**, hasta **200 MB** (`MAX_INTRO_VIDEO_BYTES`). **Sin límite de
  duración y sin moderación previa** (decisión del usuario, igual que el audio en ADR-039): el
  control es posterior, por reportes.
- Subtítulos **WebVTT** opcionales, uno por idioma declarado de la sala, en UTF-8 y empezando por
  `WEBVTT`, hasta **512 KB** cada uno (`MAX_INTRO_SUBTITLES_BYTES`).
- El tipo real se comprueba por **magic bytes**, nunca por el MIME declarado: `ftyp` en el offset 4
  = mp4; cabecera EBML `1A 45 DF A3` = webm (y debe coincidir con el tipo declarado).

**Subida** (solo el autor de la sala; rutas en `specs/13` §4.1b, servicio `IntroMediaService`):

1. El editor pide `POST /api/rooms/:roomId/intro-media/video` con `{ filename, contentType,
   byteSize }` y recibe un **PUT presignado** (15 min) directo al bucket privado: 200 MB no pasan
   por el servidor web. (R2 no admite presigned POST con condiciones de tamaño; el PUT firma
   `content-type` y `content-length`, y el tamaño real se vuelve a comprobar después.)
2. El navegador sube el fichero con ese PUT y llama a `…/video/:assetId/complete`: el servidor hace
   **HEAD** (tamaño ≤ 200 MB) y **GET por rango** de los primeros bytes (sniff). Si no cuadra, borra
   el objeto y el asset. Si cuadra, el asset (`introMediaAsset`, `specs/14` §10.2) queda `ready` y
   se devuelve la referencia `media:<uuid>` que se guarda en el borrador.
3. Los subtítulos se suben en el cuerpo (`POST …/intro-media/subtitles?lang=xx`) y devuelven su
   propia `media:<uuid>`.
4. Desde el MCP, la meta-tool `upload` (`kind: "intro_video"`/`"intro_subtitles"`) hace lo mismo
   con el binario en base64, con el tope de transporte del MCP (10 MB) para el vídeo.

**Publicación** (`room-publish`): las referencias `media:` de `meta.intro` se empaquetan como los
audios `upload:` — bloquean la publicación (`ASSETS_NOT_PUBLISHABLE`) si el asset no existe, no es
del autor o su subida no se completó (`NOT_READY`); si no, se copian a una clave direccionada por
contenido (`assets/rooms/<roomId>/<sha256>.<mp4|webm|vtt>`) y el paquete congelado guarda
`r2://<clave>`. El vídeo se empaqueta **sin cargarlo en memoria**: SHA-256 en streaming y copia
dentro del bucket.

**Reproducción** (partida y playtest): la página resuelve `meta.intro` en el servidor con
`resolveIntroModel` + `introMediaUrlResolver` (`packages/web/src/server/intro-media-url.ts`) a
URLs firmadas de **6 h** (el jugador puede pasar mucho rato en la sala de espera antes de
«Empezar»). En una versión publicada solo se sirven claves `r2://assets/rooms/…`; en el playtest de
un borrador, además, los `media:<uuid>` listos subidos por el autor de esa sala. Un medio que no se
puede servir no rompe la partida: sin vídeo, directo al 3-2-1; sin una pista de subtítulos, el
vídeo sin ella.
