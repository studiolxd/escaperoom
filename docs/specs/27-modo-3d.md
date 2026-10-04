# 27 — Modo 3D

Depende de `04-runtime-juego-y-mundo.md`, `08-formato-roompackage.md`,
`09-editor-de-salas.md`, `10-mcp-del-creador.md`, `11-protocolo-multijugador.md` y
`26-pack-grafico-v1.md`. Decisión: ADR-045 (revisa ADR-001). Plan de trabajo y encargos:
`docs/plan/fase-7-modo-3d.md`.

Una sala es **2D** (isométrica, como hasta ahora) o **3D** (tercera persona). Se elige al
crearla y no se puede cambiar. Las dos comparten reglas, puzles, inventario, diálogos, pistas,
cronómetro, sesión de partida, voz y chat. Solo cambia **el mundo**: cómo se describe, cómo se
pinta, cómo se mueve el avatar y cómo se edita.

---

## 1. Decisiones de producto (cerradas, 2026-10-04)

| Tema | Decisión |
|---|---|
| Cámara | Tercera persona. Órbita libre alrededor del avatar, con colisión contra muros. |
| Dimensión | `meta.dimension: "2d" \| "3d"`, fija al crear la sala. Ausente = `"2d"`. |
| Compartido con 2D | Reglas, puzles (paneles React), ítems, diálogos, pistas, sesión, protocolo salvo el movimiento. |
| Arquitectura | Kit modular del pack, con imán de 1 m y giros de 90° (desactivable). Objetos en posición libre. |
| Desniveles | Transitables: escalones, rampas, escaleras, tarimas y varios pisos dentro de una habitación. |
| Habitaciones | Escenas separadas. Cruzar una puerta abierta hace un fundido y aparece en la otra (como en 2D). |
| Techo | Sin techo en v1. Fondo oscuro con niebla. |
| Movimiento | Clic para caminar, WASD, y joystick en táctil. |
| Interacción | Clic en un objeto (camina hasta él y abre el menú), tecla Espacio o botón táctil sobre el objeto cercano, y arrastrar un ítem del inventario sobre un objeto. Igual que en 2D más la proximidad. |
| Validación | Navmesh de recast-navigation, generada igual en cliente y servidor. El servidor valida posición y velocidad. |
| Motor | Three.js, en `@escaperoom/game-runtime/three`. |
| Editor | Editor 3D completo (colocar, mover, girar con gizmos), sincronizado con Yjs. |
| MCP | Paridad con el editor desde el primer día (ADR-010). |
| Modelos de creadores | Suben GLB propios. Disponibles al instante, con validación técnica automática y moderación por reportes (como ADR-039). |
| Estados de un modelo | Un modelo por estado y, opcionalmente, un clip de transición. |
| Estilo | El del pack (`castillo-toon`): se reutilizan los modelos de Blender y se regenera lo que falte con el mismo pipeline. |
| Dispositivos | Escritorio y táctil (tablet y móvil). |
| Avatares | `caballero-m` y un maniquí tintado de reserva. Los otros 7 personajes son un encargo de assets aparte. |
| Sala de espera | También en 3D (una habitación `kind: "lobby"`). |
| Assets | Se generan a medida que se necesitan, no todo el pack por adelantado. Un modelo que aún no existe se ve como una caja. |
| Observador | El organizador u observador elige entre cámara libre y seguir a un jugador. |
| Binarios del pack | Los GLB se quedan en local, sin versionar. El catálogo de modelos sí se versiona. Sin GLB, el runtime pinta cajas. |
| Piloto | «La Maldición del Rey Aldric» en 3D: sala aparte, gratis, generada con un conversor interno 2D→3D y retocada. |
| Catálogo | Filtro 2D/3D. Etiqueta 2D/3D en las tarjetas y en la ficha de la sala. |

## 2. Sistema de coordenadas

El plano lógico `(x, y)` es el mismo que en 2D. El 3D añade la altura `h`.

- **Unidad:** 1 = 1 metro. Una celda del 2D equivale a 1 m. En 2D las posiciones son centros de
  celda (la celda `i` va de `i − 0,5` a `i + 0,5`); en 3D el origen está en la esquina (la celda `i`
  va de `i` a `i + 1`), así que el conversor suma 0,5 a las placas y las mirillas se resuelven con
  `Math.floor` en salas 3D (en 2D, `Math.round`). Las zonas de los puzles no cambian de valor.
- **Ejes lógicos:** `x` crece hacia el este, `y` hacia el sur, `h` hacia arriba. El origen
  `(0, 0, 0)` es la esquina noroeste del suelo de la habitación.
- **Three.js:** `X = x`, `Y = h`, `Z = y`.
- **Giro (`yaw`):** grados en `[0, 360)`. Con `yaw = 0` el frente del modelo mira a `+y` (sur);
  con `yaw = 90`, a `+x` (este). En Three.js, `object.rotation.y = yaw · π / 180`.
- **Origen de un modelo:** centro de su base. El frente del modelo es `+Z` del GLB. Excepción:
  en las piezas de suelo el origen está en el centro de la cara superior (la superficie que se
  pisa queda a la `h` de la pieza).
- **Límites de una habitación:** `0 ≤ x ≤ grid.cols`, `0 ≤ y ≤ grid.rows`, `0 ≤ h ≤ 32`. En 3D,
  `grid` son las medidas en metros de la caja de la habitación.

Consecuencia: todo el código que ya usa `position.x / position.y` de un jugador (placas con
`isOnCell`, mirillas con `viewpointAt`, zonas de `on_all_players_in_zone`) sigue funcionando sin
tocarlo. La altura solo añade una comprobación más donde importa (§6.4).

## 3. Formato (`RoomPackage`)

El `RoomPackage` sigue siendo un único documento. Una sala 3D usa los mismos campos que una 2D
y añade los siguientes. Todos son opcionales en el esquema Zod; el validador exige los que
correspondan según `meta.dimension`.

```typescript
// meta
dimension?: "2d" | "3d";              // ausente = "2d"

// Colocación libre de un objeto del mundo
interface Transform3D {
  x: number; y: number; h: number;    // metros (§2)
  yaw: number;                        // grados, [0, 360)
  scale?: number;                     // 0.1–10; ausente = 1
}

// WorldObject (objetos interactuables)
transform?: Transform3D;              // obligatorio en 3D

// SpawnPoint
h?: number;                           // ausente = 0
yaw?: number;                         // ausente = 0

// LightConfig de tipo "torch"
h?: number;                           // ausente = 1.6

// Raíz del paquete
world3d?: {
  rooms: Record<string /* roomId */, { pieces: Piece3D[] }>;
  models: Record<string /* modelId */, CustomModel3D>;   // GLB del creador (§9)
};

// Pieza de arquitectura o decoración sin lógica (suelo, muro, columna, alfombra…)
interface Piece3D {
  id: string;                         // único en el paquete; "p-" + 8 caracteres [a-z0-9]
  model: string;                      // id de modelo (catálogo del pack o world3d.models)
  x: number; y: number; h: number;
  yaw: number;
  scale?: number;
}
```

### 3.1 Qué significa cada campo existente en una sala 3D

| Campo | En 3D |
|---|---|
| `map.tileset` | Id del pack, igual que en 2D. |
| `map.rooms[].grid` | Medidas en metros de la habitación (`cols` = ancho en `x`, `rows` = fondo en `y`). |
| `map.rooms[].layers` | Siempre `[]`. |
| `map.rooms[].decorations` | Siempre `[]` (la decoración son `pieces`). |
| `map.rooms[].spawnPoints` | Igual, con `h` y `yaw`. |
| `map.rooms[].lighting` | Igual. Las antorchas llevan `h`. |
| `objects[].position` | Derivado: `{ x: Math.round(transform.x), y: Math.round(transform.y) }`. Lo escriben los comandos; el validador comprueba que coincide. |
| `objects[].sprite` y `states[*].sprite` | Id de **modelo** (el mismo nombre que el sprite 2D sin sufijo de orientación: `arca-cerrada`, no `arca-cerrada-der`). |
| `states[*].animation` | Nombre del clip de transición del modelo de ese estado. |
| `objects[].footprint` | No se usa (la huella sale del colisionador del modelo). |
| Puzles: `plates[].x/y`, `viewpoints[].zone`, `wallOccluder`, `hidingSpot.x/y`, `position` | Metros en el plano lógico. Mismo significado. |

Una sala 2D no puede llevar `world3d`, `transform`, `h` ni `yaw`.

### 3.2 Límites

| Constante | Valor |
|---|---|
| `MAX_WORLD3D_PIECES_PER_ROOM` | 4000 |
| `MAX_WORLD3D_HEIGHT` | 32 (m) |
| `MAX_WORLD3D_CUSTOM_MODELS` | 40 |
| `MIN_SCALE_3D` / `MAX_SCALE_3D` | 0.1 / 10 |

### 3.3 Dimensión fija

- `room.dimension` (columna nueva, `'2d'` por defecto) se escribe al crear el borrador y no hay
  ninguna operación que la cambie.
- `meta.dimension` del documento debe coincidir. La publicación rechaza la sala si no coincide.
- El selector 2D/3D solo aparece al crear la sala (asistente web y `create_room` del MCP).

## 4. Catálogo de modelos del pack

Cada pack declara sus modelos 3D en un catálogo **versionado**:
`packages/shared/src/packs/<packId>.models3d.json`, accesible con
`getModels3DCatalog(packId)` desde `@escaperoom/shared/packs`. Lo usan el validador, la
generación de la navmesh (cliente y servidor), el editor (paleta) y el runtime (cajas de
sustitución cuando falta el GLB). Lo genera el exportador de `tools/assets-generator`.

```typescript
interface Models3DCatalog {
  packId: string;
  version: string;
  models: Record<string /* modelId */, Model3DEntry>;
  avatars: Record<string /* characterId */, Avatar3DEntry>;
}

interface Model3DEntry {
  file: string;                       // relativo a la carpeta del pack: "models/arca-cerrada.glb"
  category: "suelo" | "muro" | "estructura" | "mueble" | "pared" | "suelto";
  label: LocalizedText;
  size: { w: number; d: number; hgt: number };   // caja envolvente (x, y, h), origen en el centro de la base
  colliders: Collider3D[];            // [] = no bloquea ni se pisa
  snap: boolean;                      // true = pieza de kit (imán de 1 m y 90° por defecto)
  clips: string[];                    // clips de animación que trae el GLB
  group?: string;                     // familia de estados ("arca"): agrupa la paleta
}

type Collider3D =
  // Caja alineada con los ejes del modelo. c = centro, s = tamaño completo.
  | { type: "box"; cx: number; cy: number; ch: number; sx: number; sy: number; sh: number }
  // Cuña transitable: la cara superior sube de h0 a h1 avanzando en `dir`.
  | { type: "ramp"; cx: number; cy: number; sx: number; sy: number; h0: number; h1: number;
      dir: "x+" | "x-" | "y+" | "y-" };

interface Avatar3DEntry {
  file: string;                       // "avatars/caballero-m.glb"
  label: LocalizedText;
  height: number;                     // m
  clips: { idle: string; walk: string; interact: string };
}
```

Los GLB viven en `packages/web/public/packs/<packId>/models/` y `.../avatars/`, **fuera de
git** (regla nueva en `.gitignore`). El runtime los pide a `/packs/<packId>/<file>`.

### 4.1 Kit modular de `medieval-v1`

Todas las piezas de kit miden múltiplos de 1 m en planta y tienen `snap: true`.

| Id | Planta × alto (m) | Colisión | Sustituye en 2D a |
|---|---|---|---|
| `suelo-piedra-1`, `suelo-piedra-2`, `suelo-alfombra`, `suelo-madera` | 1×1 × 0,1 (la cara superior queda en `h` de la pieza) | caja (se pisa) | `tile-1`, `tile-2`, `tile-3`, `tile-madera` |
| `muro` | 1×1 × 2,4 | caja | `tile-10` |
| `muro-arco` | 1×1 × 2,4, hueco de 0,8 × 2,0 | dos jambas y dintel | `tile-20/21/22` |
| `muro-ventana` | 1×1 × 2,4 | caja | `muro-ventana` |
| `columna` | 1×1 × 2,4 | caja de 0,5×0,5 | `columna` |
| `escalon` | 1×1 × 0,2 | caja (se pisa) | `escalon` |
| `tarima` | 1×1 × 0,4 | caja (se pisa) | — |
| `rampa` | 1×2 × 0,4 | cuña | — |
| `escalera` | 1×2 × 1,0 | cuña | — |
| `umbral` | 1×1 × 0,05 | caja (se pisa) | `umbral` |
| `trampilla` | 1×1 × 0,05 | caja (se pisa) | `trampilla` |

Los muros son **bloques de celda completa**, como en 2D. Así la conversión es exacta y los
muros hacen de tope natural para la cámara. Los objetos de pared (cuadros, tapices, antorchas,
mirillas) se colocan pegados a la cara interior del bloque.

### 4.2 Objetos del pack

Los modelos se generan **bajo demanda**: cada vez que una sala (la primera, el Rey Aldric 3D)
necesita un modelo, se exporta con el pipeline de `tools/assets-generator` y se añade su entrada
al catálogo. Un id que todavía no está en el catálogo se pinta como caja y el validador lo avisa
(`unknown_model`), sin bloquear.

Un modelo por cada sprite 2D sin sufijo de orientación. Los estados que hoy son frames
distintos (`arca-cerrada` / `arca-abierta`) son modelos distintos. Las imágenes planas de pared
(cuadros, tapices, mural, estandarte) son un tablero con la imagen como textura.

## 5. Navmesh y movimiento

### 5.1 Geometría de entrada

`buildNavInput(pkg, roomId, catalog)` (paquete `@escaperoom/nav3d`) devuelve los triángulos de
todos los colisionadores de la habitación, ya transformados:

- Colisionadores de todas las `pieces` de la habitación.
- Colisionadores de los objetos (`objects`) que bloquean. Criterio: el mismo de
  `defaultObjectBlocks` de 2D (`pack/collisions.ts`): no bloquean las puertas (`type === "puerta"`
  o con `leadsTo`) ni las placas que se pisan. Se usa el modelo del `initialState`.
- Un objeto no cambia la navmesh al cambiar de estado (v1).

### 5.2 Parámetros de recast (fijos, iguales en cliente y servidor)

| Parámetro | Valor |
|---|---|
| Tamaño de celda (`cs`) / alto de celda (`ch`) | 0,15 m / 0,1 m |
| Radio del agente | 0,3 m |
| Altura del agente | 1,8 m |
| Escalón máximo que se sube sin rampa | 0,25 m |
| Pendiente máxima | 45° |

La navmesh se genera bajo demanda en cada proceso a partir del paquete y el catálogo, y se
guarda en memoria por `(packageId, version, roomId)`. No se persiste.

### 5.3 Cliente

- **Clic en el suelo:** ruta por la navmesh hasta el punto; el avatar la sigue.
- **Clic en un objeto interactuable:** ruta hasta el punto de la navmesh más cercano al objeto;
  al llegar (a menos de 1,5 m) se abre su menú contextual. Es el mismo comportamiento que en 2D.
- **WASD / joystick:** avanza respecto a la cámara, deslizándose por los bordes de la navmesh.
  Cancela la ruta en curso.
- **Velocidad:** 3,5 m/s.
- El cliente envía `move` como mucho cada 100 ms (`AVATAR_MOVE_EMIT_MS`), con `x`, `y`, `h` y `yaw`.

### 5.4 Servidor

En una sala 3D, `move` se valida así:

1. El punto más cercano de la navmesh a `(x, y, h)` debe estar a ≤ 0,35 m en planta y ≤ 0,5 m en
   altura. Si no, `OUT_OF_BOUNDS`. Se guarda el punto de la navmesh, no el pedido.
2. La distancia al punto anterior debe ser ≤ `GAME_MAX_STEP_3D` (1,5 m por mensaje). Si no,
   `MOVE_TOO_FAST`.

El cambio de habitación no cambia: `move` con otro `roomId`, cerca de una puerta abierta
(`GAME_DOOR_REACH`, distancia en planta al `transform` de la puerta y ≤ 1,5 m de diferencia de
altura). El jugador aparece en un `spawnPoint` de la habitación destino.

## 6. Protocolo y estado

### 6.1 Estado sincronizado

`GamePlayerState` añade `h: number` y `yaw: number` (0 en salas 2D). `GamePlayerSnapshot` y
`ScenePlayer` los exponen.

### 6.2 Mensajes

`move` añade `h?: number` y `yaw?: number`. No hay mensajes nuevos.

### 6.3 Sesión

`RoomPlayerPosition` añade `h?` y `yaw?`. `spawnPlayer` y el cruce de habitación usan `h` y
`yaw` del `spawnPoint`.

### 6.4 Mecánicas de posición

- **Placas (`simultaneous_plates`):** el jugador está sobre la placa si lo está en planta
  (`isOnCell`, sin cambios) **y** su `h` difiere ≤ 1 m del `transform.h` del objeto de la placa.
- **Mirillas (`split_clue`):** igual, con el objeto de la mirilla.
- **Zonas (`on_all_players_in_zone` con rectángulo):** solo planta, sin comprobar altura.

## 7. Runtime 3D (`@escaperoom/game-runtime/three`)

`RoomRuntime3D` ofrece **la misma fachada** que `RoomRuntime` (Phaser): mismo constructor
`(parent, model, options)`, mismos métodos (`showRoom`, `placeAvatar`, `avatarCell`,
`setObjectState`, `setPlayers`, `setLocalTint`, `setLocalCharacter`, `setInputEnabled`,
`dropItemAt`, `onWorldEvent`, `setBackgroundColor`, `isObjectInteractive`,
`getObjectScreenFraction`, `destroy`) y los mismos `WorldSceneEvent` (`interact`, `use-item`,
`avatar-move` con `h` y `yaw`, `enter-room`). La capa React (HUD, paneles,
`useSceneSync`) elige uno u otro según `model.dimension` y no cambia nada más.

- **Render:** `MeshToonMaterial` con la luz del estilo (sol arriba-izquierda y ambiente) y
  niebla de fondo. Sin sombras proyectadas en calidad baja.
- **Carga:** `GLTFLoader` con meshopt y texturas WebP. Si un GLB falla o no existe, caja del tamaño de
  `size` con el color de su categoría (modo sustitución; es el modo de CI y E2E).
- **Estados:** cambiar de estado sustituye el modelo. Si el estado declara `animation` y el
  modelo nuevo trae ese clip, lo reproduce una vez.
- **Antorchas:** `PointLight` por antorcha encendida (máximo 8 a la vez, las más cercanas) y una
  llama con sprite.
- **Avatar:** GLB con esqueleto, clips `idle` / `walk` / `interact`. Anillo de color del jugador
  en el suelo. Sin personaje: maniquí tintado.
- **Otros jugadores:** interpolación de posición y giro entre actualizaciones.
- **Cámara:** órbita alrededor del avatar (distancia 5–10 m, arranque a 10 m, inclinación 10°–75°). Arrastrar
  gira; rueda o pellizco acercan. La cámara solo choca con muros y estructura
  (categorías `muro` y `estructura`, más modelos desconocidos; malla de colisión de cámara aparte
  de la navmesh). Los objetos y piezas que no la frenan (muebles, objetos interactivos…) y que
  tapan al personaje se vuelven semitransparentes (opacidad 0,3, transición de 0,2 s) mientras
  estorban; siguen siendo clicables. No aplica al editor.
- **Clic frente a arrastre:** si el puntero se mueve menos de 6 px entre pulsar y soltar, es un
  clic (caminar o seleccionar); si no, gira la cámara.
- **Resaltado:** el objeto interactuable más cercano a menos de 2 m y dentro de un cono de 120°
  frente al avatar es el objeto cercano: Espacio o el botón táctil lo seleccionan, sin
  resaltado visual (decisión del usuario, 2026-10-05). En escritorio el HUD no muestra pista.
  En la partida 3D ningún objeto se contornea, ni por proximidad ni al pasar el cursor por
  encima (hover): decisión del usuario, 2026-10-05. Solo el editor contornea la selección.
- **Arrastrar del inventario:** `dropItemAt` lanza un rayo desde el punto de pantalla; si da en
  un objeto interactuable, emite siempre `use-item` (el HUD decide si tiene efecto), como en 2D.
- **Táctil:** joystick virtual a la izquierda, botón «Interactuar» a la derecha, arrastrar en el
  resto de la pantalla gira la cámara y tocar hace de clic.
- **Calidad:** alta o baja. Empieza en alta y baja sola si la media cae por debajo de 30 FPS
  durante 5 s. En baja: sin sombras, sin contorno por postproceso (se usa un tinte), y
  resolución de render a 1×.
- **Modo observador** (organizador de un evento y cualquier cliente sin avatar propio): dos
  cámaras, con un selector en el HUD.
  - *Seguir a un jugador:* la misma cámara en órbita, centrada en el jugador elegido de una
    lista; cambia de habitación con él.
  - *Cámara libre:* vuela por la habitación elegida (WASD para moverse, arrastrar para girar,
    rueda para acercar), sin colisión y limitada a la caja de la habitación más 5 m. Un selector
    elige la habitación.
  El observador no envía `move` ni interactúa.
- **Modo edición:** ver §8.

### 7.1 Presupuestos

| Límite | Valor |
|---|---|
| Triángulos por habitación | 500.000 (aviso del validador al superarlo) |
| Luces dinámicas | 8 |
| Modelo del pack | ≤ 2 MB y ≤ 30.000 triángulos, texturas ≤ 1024 px |
| Avatar | ≤ 4 MB y ≤ 40.000 triángulos |

## 8. Editor 3D

El editor de una sala 3D usa el mismo `RoomEditorShell` (inspector, reglas, plantillas,
idiomas, validación, playtest) con otro lienzo y otra paleta. **La distribución es la del editor
2D**: paleta y herramientas donde están hoy, lienzo en el centro, panel de habitación e inspector
en su sitio. Lo propio del 3D (selector de altura, modos del gizmo, ver navmesh) va en la misma
barra de herramientas. No hay maqueta previa: el usuario lo valida visualmente una vez
implementado.

- **Lienzo:** `RoomRuntime3D` en `mode: "edit"`, con cámara libre de editor (órbita, paneo y
  zoom) y rejilla de suelo de 1 m en la altura de trabajo.
- **Paleta:** pestañas Kit (suelo, muro, estructura), Objetos (mueble, pared, suelto) y Mis
  modelos (§9). Sale del catálogo.
- **Colocar:** elegir un modelo y hacer clic. Las piezas con `snap: true` se ajustan a la
  rejilla de 1 m y a giros de 90°; mantener Alt lo desactiva. Arrastrar con una pieza de kit
  elegida pinta una fila.
- **Altura de trabajo:** selector de nivel (en pasos de 0,2 m) que mueve la rejilla. Lo nuevo
  se coloca a esa altura.
- **Seleccionar y transformar:** clic selecciona; gizmo de mover (W), girar (E) y escalar (R).
  Supr borra. Ctrl+D duplica. Selección múltiple con Mayús.
- **Piezas frente a objetos:** del catálogo, lo que se coloca desde Kit es una `Piece3D`; lo que
  se coloca desde Objetos es un `WorldObject` (con `transform`), que luego se configura en el
  inspector como en 2D.
- **Spawns, antorchas y puertas:** herramientas propias, con gizmo. Las puertas son objetos con
  `leadsTo`, como en 2D.
- **Ver navmesh:** conmutador que la dibuja encima del suelo, para ver por dónde se puede andar.
- **Colaboración:** todo cambio es una transacción Yjs con los comandos de
  `@escaperoom/editor/room-doc` (§8.1), igual que en 2D.

### 8.1 Comandos del documento (los usan editor y MCP)

| Comando | Qué hace |
|---|---|
| `setRoomBounds3D(doc, roomId, { cols, rows })` | Fija las medidas de la habitación. |
| `placePieces3D(doc, roomId, pieces[])` | Añade piezas (genera ids). |
| `updatePiece3D(doc, pieceId, patch)` | Mueve, gira, escala o cambia de modelo. |
| `removePieces3D(doc, pieceIds[])` | Borra piezas. |
| `fillPieces3D(doc, roomId, { model, from, to, h })` | Rellena un rectángulo con una pieza de kit. |
| `placeObject3D(doc, { roomId, sprite, transform, id?, type?, interactable? })` | Coloca un objeto. |
| `addObject(doc, object)` | Ya existe. En 3D exige `transform` y deriva `position`. |
| `setObjectTransform(doc, objectId, transform)` | Mueve o gira un objeto y actualiza `position`. |
| `setSpawnPoints3D(doc, roomId, spawns[])` | Fija los puntos de aparición. |
| `listPieces3D(doc, roomId?)` | Lee las piezas. |

### 8.2 Herramientas del MCP

`create_room` acepta `dimension`. En una sala 3D, `set_map` (con capas), `paint_tiles` y
`decorate_subroom` devuelven un error que remite a las herramientas 3D:

| Herramienta | Comando |
|---|---|
| `define_subrooms` | Ya existe; en 3D `cols`/`rows` son metros. |
| `place_pieces` | `placePieces3D` / `fillPieces3D` |
| `update_pieces` | `updatePiece3D` |
| `remove_pieces` | `removePieces3D` |
| `add_object` | Ya existe; en 3D lleva `transform`. |
| `move_object` | `setObjectTransform` |
| `set_spawn_points` | `setSpawnPoints3D` |
| `get_pieces` | `listPieces3D` (consulta). |
| `get_model_catalog` | Lista los modelos del pack y los propios (consulta). |

## 9. Modelos de creadores (GLB propios)

- **Subida:** igual que el vídeo de la introducción (`IntroMediaService`): PUT presignado desde
  el editor web y, por MCP, `upload` con `kind: "model3d"` (tope de transporte de 10 MB).
- **Validación técnica automática**, en el servidor, antes de dejarlo `ready`:
  glTF 2.0 binario; ≤ 15 MB; ≤ 100.000 triángulos; texturas ≤ 2048 px; sin extensiones salvo
  `KHR_materials_emissive_strength`, `KHR_texture_transform`, `KHR_mesh_quantization`,
  `EXT_meshopt_compression`, `KHR_draco_mesh_compression`, `EXT_texture_webp` y
  `KHR_texture_basisu`; sin cámaras ni
  luces; sin URIs externas.
- **Metadatos calculados al validar:** caja envolvente (`size`), lista de clips y un colisionador
  por defecto (una caja con la envolvente). El creador puede desactivar la colisión.
- **Referencia:** `world3d.models[<id>] = { ref, size, colliders, clips, label }`, con
  `ref = "model:<uuid>"` en el borrador y la clave del bucket en una versión publicada (la
  publicación copia y reescribe, como con audio y vídeo). El `id` cumple `ID_PATTERN` y se usa
  igual que un modelo del pack en `sprite`, `states` y `pieces[].model`.
- **Moderación:** sin revisión previa. Se puede reportar la sala. En el panel de moderación
  (`/admin/moderation`), el detalle de un reporte sobre una sala 3D lista sus modelos propios y
  abre cada uno en un **visor 3D** (órbita, zoom, material original y toon, medidas, triángulos
  y peso), con el mismo cargador que el runtime. Retirar la sala al confirmar el reporte funciona
  como con cualquier otro contenido.
- **Cuota:** 40 modelos propios por sala.

## 10. Catálogo y creación

- **Crear sala:** el asistente web y `create_room` piden 2D o 3D. Por defecto, 2D.
- **Filtro del catálogo:** «Formato: cualquiera / 2D / 3D».
- **Etiqueta:** distintivo «2D» o «3D» en la tarjeta de la sala y en la ficha.

## 11. Rey Aldric 3D

- **Conversor interno** (no se ofrece a creadores, ni en la web ni en el MCP): vive en
  `packages/shared/src/convert3d/convert.ts` (`convertRoomTo3D`, módulo puro y probado) y se
  ejecuta con `pnpm --filter @escaperoom/shared convertir:3d`
  (`packages/shared/scripts/convertir-sala-3d.ts`). Lee `docs/reference/roompackage-rey-aldric.v1.json`
  y escribe `docs/reference/roompackage-rey-aldric-3d.v1.json` (`meta.id: "room-rey-aldric-3d"`).
  Usa la tabla sprite 2D → modelo y giro (`sprites2d`) y `sinModelo` de
  `tools/assets-generator/packs/medieval-v1/modelos3d.json`. La celda `(cx, cy)` del 2D ocupa en 3D
  `[cx, cx+1] × [cy, cy+1]`; su centro es `(cx + 0,5, cy + 0,5)`.
  - **Suelo y muros** (`ground` y `walls`, por celda con tile ≠ 0) → pieza en el centro de la
    celda, `h = 0`: tiles 1, 2 y 3 → `suelo-piedra-1`, `suelo-piedra-2` y `suelo-alfombra`; tile 10 →
    `muro`; tiles 20, 21 y 22 → `muro-arco` (`yaw` 0 si hay muro o borde a su izquierda o derecha,
    90 si no). Un tile sin pieza hace fallar el conversor. Bajo un muro no hay suelo, salvo bajo un
    arco. Ids de pieza deterministas (`p-` + contador en base 36 de 8 cifras).
  - **Cara interior** de una celda de muro: la primera de `(0,+1)`, `(+1,0)`, `(0,−1)`, `(−1,0)` cuya
    vecina existe y no es muro; el giro que mira hacia dentro es 0, 90, 180 y 270.
  - **Objetos:** `sprite` → modelo de la tabla (sufijo `-der` → `yaw = 90`, sin sufijo → 0; el
    sprite pierde el sufijo), igual que el de cada estado; los estados `oculto` se dejan. Una puerta
    va al centro de su celda mirando hacia la cara interior; un objeto sobre una celda de muro
    (cuadros, tapices, mural, antorchas, mirillas…) va en la cara interior, `0,01 + 0,02 × k` m hacia
    dentro (`k` = los ya colocados en esa celda) y mirando hacia dentro; el resto, al centro de su
    celda o, con `footprint`, al centro del conjunto de celdas (el `footprint` se quita).
    `position = positionFromTransform(transform)`.
  - **Decoraciones** → piezas en el centro de su celda. **Aparición:** centro de la celda, `h = 0`,
    `yaw = 0`. **Antorchas:** en la cara interior si su celda es de muro, si no al centro; `h = 1,6`.
  - **Puzles:** las placas de `simultaneous_plates` y las coordenadas de `hidingSpot` (si las hay)
    suman `+ 0,5`; `split_clue` no cambia (la zona significa lo mismo: en salas 3D `splitClueView`
    usa `Math.floor` en lugar de `Math.round`, §2). `puzzle.position` es de celda entera y se deja.
    Reglas, ítems, diálogos y pistas se copian tal cual. `world3d.models` = `{}`.
  - **Estado «oculto»:** `oculto` no es un modelo (el runtime no pinta nada); el validador no lo
    avisa como `unknown_model` (`HIDDEN_STATE_SPRITE`).
- **Fixture:** el 3D se versiona y un test falla si no coincide con lo que genera el conversor hoy.
  Los retoques manuales futuros se harán cambiando el conversor o, cuando el usuario lo revise,
  sustituyendo ese test.
- **Siembra:** sala `…3002` publicada gratis (`priceCents: 0`) en todos los entornos, con la
  portada de la sala principal y la misma introducción (texto y narración) que la 2D, añadida
  solo en el seed (`meta.intro`; el fixture y el conversor no la llevan) y también en el `update`
  del upsert, para que un `db:seed` sobre una base ya sembrada la ponga. La «Sala de pruebas 3D» (`…3001`) sigue siendo solo de
  desarrollo.
- **Pruebas:** validación, resolubilidad de 1 a 8 jugadores con la misma ruta crítica que el 2D y
  alcance sobre la navmesh en `shared`/`nav3d`; E2E de humo (primer puzle de la ruta, en modo
  sustitución, como CI) y paridad MCP (el guion construye el mundo 3D solo con herramientas).

## 12. Pruebas

- Esquemas y validador: unitarias en `shared`.
- Navmesh: unitarias en `nav3d`, en Node, con salas pequeñas hechas a mano (suelo, muro, rampa).
- Servidor: tests de `GameRoom` con una sala 3D de prueba (movimiento válido, fuera de la
  navmesh, demasiado rápido, cruce de puerta, placa a distinta altura).
- Runtime: unitarias de lo puro (ruta, cámara, selección por proximidad). El render no se prueba
  con capturas en CI.
- E2E: `game.reyaldric-3d.spec.ts`, usando `getObjectScreenFraction` e `isObjectInteractive`
  como el de 2D.
- La verificación visual la hace el usuario.

---

## 13. Puntos abiertos

| # | Punto | Afecta a | Cómo se cierra |
|---|---|---|---|
| A9 | **Retoques del Rey Aldric 3D** respecto a la conversión automática. | 7.10 | Revisión en vivo del usuario, como la del 2D. |

Ninguno bloquea el código: runtime, editor y partida se construyen y se prueban con cajas de
sustitución. Cerrados el 2026-10-04: cámara del observador (§7), distribución del editor (§8) y
visor 3D en moderación (§9).
