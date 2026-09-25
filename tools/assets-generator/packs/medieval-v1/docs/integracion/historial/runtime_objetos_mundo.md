# EscapeRoom — objetos del mundo (encargo nuevo para el runtime)

> **Sustituido como encargo por `../ESPECIFICACION-INTEGRACION-RUNTIME.md`** (25/09/2026). Se conserva como historial
> razonado de cada decisión.

Encargo independiente del de avatares e iconos (`cambios-escaperoom-avatares.md`, ya en curso).
Se irá ampliando a medida que se entreguen objetos. Estado: **piloto** (25/09/2026).

## 1. Cambios de comportamiento

### 1.1 Cuadro del rey: al torcerlo, la llave cae al suelo
- **Hoy (fixture):** `cuadro-aurelio` es un `escondite`; al inspeccionarlo pasa a `open` (`cuadro-rey-torcido`)
  y la `llave-bronce` va directa al inventario.
- **Nuevo:** al pasar a `open`, la llave **cae al suelo** delante del cuadro (celda frente al muro) como objeto
  del mundo recogible; al recogerla va al inventario.
- **Motivo:** se ve de dónde sale la llave; el jugador entiende el escondite sin textos extra.
- **Qué hace falta:** un objeto de mundo "item en el suelo" (recogible) con sprite propio, generado por la regla
  del cuadro. Sprite entregado: `llave-bronce-suelo` (ver §2). Escala libre: es un objeto para recoger, se dibuja
  más grande que una llave real para verse bien; no tiene que respetar la escala del jugador ni de los muebles.
- Opcional: patrón reutilizable (cualquier escondite puede "soltar" su item al suelo).

### 1.2 Colocación: armario y arca a un muro del fondo
- `armario` (x=18, y=4) y `arca-candado` (x=18, y=6) están pegados al muro del frente-derecha (`x=19`); con la
  cámara isométrica se verían de espaldas.
- **Cambio:** moverlos junto a uno de los muros del fondo (fila `y=0`/`y=1` o columna `x=0`/`x=1`), mirando
  hacia la sala. Motivo: que se vean de frente, con su estado (abierto/cerrado) legible.
- Ambos tienen 2 estados: `armario`/`armario-abierto`, `arca-cerrada`/`arca-abierta` (+ base `arca`).

### 1.3 Spec 26 §3.1: permitir que los objetos sobresalgan un poco de su celda
- **Hoy:** "Overhang permitido hacia arriba; nunca hacia abajo/lados". Con esa regla, un armario a escala real con
  el avatar (1,6 m de alto → 1,06 m de ancho) no cabe en una celda (0,905 m) y habría que encogerlo a ~1,37 m;
  las puertas abiertas se salen siempre.
- **Por qué existe la regla:** el depth-sort ordena por el objeto entero; lo que invade una celda vecina puede
  quedar por detrás de un avatar que está en esa celda aunque debería taparlo, y esa parte no es clicable ni colisiona.
- **Por qué relajarla:** los salientes pequeños (8 cm del armario, 5 cm del arca) no producen fallos visibles; los
  grandes (puertas abiertas, ~½ celda) quedan cubiertos por la política de oclusión (spec 04: lo que queda delante
  del avatar se desvanece), y los muebles van contra el muro, donde las celdas laterales rara vez se pisan.
  A cambio, todos los objetos mantienen la escala real respecto al avatar y al suelo.
- **Cambio propuesto:**
  - Overhang **hacia arriba libre**; **hacia los lados y hacia delante, hasta ½ celda** (32 px a 1×).
  - Depth-sort por el **pivote** del objeto (centro de su celda en el suelo, ver §2).
  - Objetos que necesiten más (mesas largas, sarcófago...): **huella de varias celdas** declarada en el objeto.
  - Opcional: marcar como no transitables las celdas que invade una puerta abierta mientras esté abierta.

### 1.4 Brasero: la luz está en otra celda
- En el fixture el objeto `brasero` está en (4, 6), pero su luz (`lighting`, tipo `torch`, `objectId: brasero`) está
  en (5, 1). **Cambio:** poner la luz en la celda del brasero (o, mejor, que la luz ligada a un `objectId` tome la
  posición del objeto). Motivo: el halo del fuego debe salir del propio brasero.
- El sprite `brasero-encendido` no lleva halo propio (spec 26 §5): el resplandor lo pone el runtime.
- Las **3 brasas flotantes** del sprite encendido son la pista del dígito 3 (`d-brasero`): no taparlas con UI ni
  partículas. Una animación del fuego (opcional, `brasero.arder`) se puede producir más adelante con la misma cámara.

### 1.5 Pista del candado del arca (código 4732): retratos y tapices del muro del fondo
- La pista 1 dice: «los cuatro retratos del fondo, de izquierda a derecha: torres, dragones, brasas, estatuas».
  En el fixture: `retrato-2` (x=8) `cuadro-reino-4torres` → 4; `tapiz-dragones` (x=10) `tapiz-7-dragones` → 7;
  `retrato-3` (x=12) y `retrato-4` (x=14) comparten `cuadro-reino` → deberían remitir a brasas (3) y estatuas (2).
- **Cambio 1, sprites distintos:** `retrato-3` → **`cuadro-reino-brasero`** (el brasero ardiendo) y `retrato-4` →
  **`cuadro-reino-estatuas`** (dos estatuas de caballero). Con el mismo sprite el jugador no sabe qué contar.
  Añadirlos a la lista de frames de la spec 26 §4.2.
- **Cambio 2, tapices decorativos:** `tapiz-dragones` (x=4 y x=15, bake-able) llevan **un solo dragón grande**
  (emblema) para no confundirse con el tapiz de la pista, que muestra 7 dragones pequeños y separados.
- **Cambio 3, vista de inspección con imagen:** a tamaño de juego (64–96 px) no se pueden contar 7 dragones ni
  4 torres, e «Inspeccionar» solo muestra texto (spec 04 §2). Propuesta: acción `show_image` (o `show_dialog` con
  imagen) que abra el master del objeto en un panel. Se entregan masters en `entregas/objetos/inspeccion/`
  (lado largo 1024 px). Mientras no exista, añadir a esos cuatro objetos un `show_dialog` descriptivo al inspeccionar.
- **Cambio 4, solape:** `retrato-4` (x=14) y el tapiz decorativo (x=15) se pisan: el cuadro mide 1,2 m y el tapiz
  1,1 m, y las celdas están a 0,9 m. Mover el tapiz a x=16 (o el retrato a x=13).
- **A revisar (diseño del puzle):** el cuadro del rey (x=6, escondite) también muestra 4 torres, y queda justo a la
  izquierda de `retrato-2` (4 torres). Leyendo «los cuatro retratos del fondo, de izquierda a derecha», el jugador
  puede empezar por el del rey y desfasar la secuencia (torres, torres, dragones, brasas…). Propuesta: que la pista
  diga «los cuatro retratos a la derecha del Rey», o que el cuadro del rey no muestre torres contables.

### 1.6 Bodega
- **Mural, ranura y compartimento, juntos en el muro del fondo.** En el fixture están en (2,1), (2,3) y (2,4), celdas
  de suelo, pero son objetos de pared y el compartimento se abre «tras el azulejo central» del mural. Propuesta:
  los tres en la **misma celda del muro** (p. ej. x=3 de la fila y=0). Se entregan con **el mismo lienzo y pivote**:
  el runtime dibuja encima del mural el compartimento (azulejo central) y la ranura (repisa bajo el mural). Si se
  prefieren objetos separados en celdas distintas, hay que volver a sacar la ranura con su propio lienzo.
- **Estado inicial del mural:** `mural-azulejos` = `mural-desordenado` (8 piezas barajadas con la semilla del puzle,
  812, y el hueco abajo a la derecha). `mural-completo` al resolverlo. El panel del puzle usa
  `entregas/objetos/puzles/mural-vendimia-3x3.png` (1024×1024, solo la escena, sin la cenefa).
- **Pista del 5 («al barril número 5», «cinco uvas me vieron caer»):** sin números en los assets. El mural completo
  muestra **5 racimos cayendo en el barril**. Propuesta para `d-mural`: «…los campesinos vierten cinco racimos en el
  barril…» en vez de «al barril número 5».
- **Barril escondite (15,8):** en esa misma celda hay también una decoración `barril-suelto`: sobra (el objeto ya se
  dibuja). `barril-movido`: el barril se aparta media celda y deja ver un hueco en el suelo con el espejo (el runtime
  entrega el `espejo` al moverlo).
- **Mesa de catas:** mide 2,3 m (≈ 2,5 celdas); declararla con **huella de 1×3 celdas** (§1.3). `mesa-activa`: las 6 copas
  de pie, con vino y un brillo suave; en reposo, boca abajo.
- **Mirillas:** cuelgan de la pared ocultadora (`wallOccluder`), que aún no existe como sprite (va con muros).
- **Reja:** pendiente, se hará con suelos y muros.

### 1.7 Catacumbas
- **Canal de agua:** el fixture solo tiene la entrada (`canal-entrada`, (2,4)) y la compuerta (4,4); el agua llega al
  altar (10,4). Se entrega además **`canal-tramo`** (tramo recto sin boca) para decorar las celdas (3,4) y (5..9,4), de
  modo que se vea el recorrido del agua. El canal corre a lo largo de la fila: orientación principal = variante sin
  sufijo; `-y` si algún tramo va a lo largo de la columna.
- **Relicario «sobre el altar»:** `d-catacumbas` dice que el relicario está sobre el altar, pero en el fixture están en
  celdas distintas ((10,2) y (10,4)). Opciones: (a) mover el relicario a la celda del altar y dibujarlo **38 px (1×)
  más arriba** (altar de 0,9 m), o (b) cambiar el texto («junto al altar»). Recomendado (a).
- **Huellas de varias celdas (§1.3):** `sarcofago` (2,1 m), `altar` (1,9 m) y `vasijas-8` (2,1 m) ocupan ≈ 1×2 celdas.
- **Pista del 8:** `vasijas-8` son 8 vasijas iguales en dos filas de 4 sobre una grada (la de atrás, más alta, para
  que se vean todas). Imagen grande en `inspeccion/vasijas-8.png`.
- **Relicario:** sellado = bandas de magia morada que lo atan; abierto = tapa abierta y el alma del rey (luz dorada)
  saliendo. Sin halo propio: el runtime puede añadir una luz dorada al abrirlo (fin de la partida).
- **Antorchas:** `antorcha` (encendida) sirve para las 4 decoraciones de las catacumbas y las luces de la bodega.
  La luz la pone el runtime (spec 26 §5).

### 1.8 Spec 26 §4.1: muros de 2,4 m y objetos de pared
- **Hoy:** muros de 64×64 a 1× (≈ 0,74 m de alto, por la rodilla del avatar), «porque ningún elemento decorativo
  sobresale del muro». Los cuadros, tapices, mural, antorchas y mirillas entregados cuelgan a 1,3–2,1 m y quedarían
  flotando por encima.
- **Cambio:** muros de **2,4 m: lienzo 64×136 a 1× (128×272 a 2×)**, misma huella 64×32 y pivote abajo-centro. Los
  genera el generador de tiles con el estilo `castillo-toon` (`packs/medieval-v1/renders/tiles/`). Los muros del frente ya se
  desvanecen por la política de oclusión (spec 04), así que la altura solo se ve en los dos muros del fondo.
- **Objetos de pared y su celda:** el pivote de cuadros, tapices, mural, antorcha y mirilla es el centro de la **celda
  de suelo delante del muro**; su cara queda pegada a la cara del bloque de muro. En el fixture del salón están en la
  propia celda del muro (fila y=0): el runtime debe dibujarlos en la celda de delante (y=1), o desplazar el sprite
  (−32, +16) px a 1× si sigue usando la celda del muro.
- **Puerta y reja (objetos en la celda del muro):** su pivote es el centro de la **celda del muro** (la del arco,
  `muro-arco`/`tile-22`), y la hoja está en la cara del muro que da a la sala: se dibujan **después** del muro, encajan
  en el hueco del arco (0,72 m × 1,83 m). Abiertas, giran 100° hacia la sala. Sin sufijo = fila y=0; `-x` = columna x=0.
- **Placas, umbral y escalón:** objetos de suelo (pivote = su celda). `umbral` y `escalon` son sprites propios;
  `tile-20`/`tile-21` NO (en el fixture son piezas de muro con hueco, §1.9).
- **Columna:** `columna` (entera, 2,4 m: alto del muro), `columna-base` y `columna-capital` (mismo lienzo y pivote: son
  la base y el capitel en su sitio, para apilar o usar sueltos).
- **Muros decorados:** `muro-antorcha` y `muro-tapiz` no se generan en esta estética: la antorcha y los tapices son
  objetos 3D colgados sobre `muro-1`. `muro-arco` (y `tile-22`) y `muro-ventana` sí: sin sufijo = fila y=0, `-x` =
  columna x=0.

### 1.9 Pack del juego: quién hace qué y cambios en `pack:build` y el runtime
- **Nosotros** (assets-generator, `python3 scripts/empaquetar/empaquetar_pack.py --pack medieval-v1`) generamos `packs/medieval-v1/salida/`: la carpeta de fuentes
  que espera `pnpm pack:build` (`tiles/`, `sprites/`, `icons/`, `avatar/`, `fx/`, PNG a 2×) + `pack.config.json`
  (id, version, projection, collides, avatars, avatarOrigin, anims, **sizes**, **origins**). Se copia a
  `packages/web/public/packs/medieval-v1/`.
- **El juego** construye atlas y `manifest.json` con `pack:build`, valida contra el `RoomPackage` y publica en R2.
- **Cambios necesarios en el juego** (hoy chocan con la escala real de los assets):
  1. `pack:build` (`src/pack/svg.ts`, `FRAME_CANVASES` / `checkPngAspect`): los lienzos canónicos (arca 96×96,
     muro 64×64…) no coinciden con los reales (arca 102×92, muro 64×136…). Tomar el lienzo de `pack.config.sizes`
     cuando exista, en vez de exigir la proporción canónica.
  2. Manifiesto: `sprites[frame].origin?: [x, y]` (y lo mismo para los muros de `tiles`), copiado de
     `pack.config.origins`. Es la fracción del frame que cae en `tileAnchor` (vértice inferior del rombo de la celda).
  3. Runtime (`room-scene.ts`): pintar cada sprite a su tamaño lógico (frame / `projection.scale`) en vez de
     `fitToLogicalSize(…, SPRITE_SIZE 64×96)` / `WALL_TILE_SIZE 64×64`, y usar `setOrigin(origin)` en vez de
     `(0.5, 1)` fijo. Sin esto los objetos se deforman (todos a 64×96) y los que sobresalen de su celda se descolocan.
- **tileIds 20, 21 y 22** son piezas de la fila de muro (así los usa el fixture): se entregan como el muro con hueco
  de arco; la hoja (`puerta-*`, `reja-*`) es el objeto que va encima. Un tileId no lleva orientación: hoy los tres
  salen para la fila y=0; si hacen falta en la columna x=0, añadir tileIds (o una variante por orientación).
- **Alias provisional:** `cuadro-reino` = `cuadro-reino-estatuas` hasta que el fixture use los dos cuadros de §1.5.
- **Falta:** `fx/` (brillo reutilizable, spec 26 §7) y el resto de personajes (solo `caballero-m`).

## 2. Sprites entregados (`entregas/objetos/`)
PNG transparentes en `1x/`, `2x/` y `master/` (resolución del render). **Escala de los objetos de suelo: la misma
que los avatares** (1× = 49,9 px por metro: avatar de 1,75 m → 96 px; celda → rombo de 64×32). Todos los frames
de un objeto (estados y orientaciones) comparten lienzo y pivote: se sustituyen sin moverse.
**Pivote** = centro de la celda en el suelo, dado como fracción del lienzo (x, y); la esquina inferior del rombo de
la celda queda 16 px (1×) más abajo.
| Frame | Tamaño 1× | Notas |
|---|---|---|
| `cuadro-rey`, `cuadro-rey-torcido` | 98×128, pivote (0,5, 0,859) | Cuelgan del muro de la fila y=0 (mirando abajo-izquierda); mismo lienzo: se sustituyen sin moverse. Variantes `-der` para el muro de la columna x=0 |
| `cuadro-reino-4torres` (+`-der`) | 84×118, pivote (0,5, 0,847) | Paisaje del reino con un castillo de 4 torres (pista 4) |
| `cuadro-reino-brasero` (+`-der`) | 84×118, pivote (0,5, 0,847) | Nuevo (§1.5): el brasero **apagado**; remite al brasero real, que hay que encender para ver las 3 brasas |
| `cuadro-reino-estatuas` (+`-der`) | 84×118, pivote (0,5, 0,847) | Nuevo (§1.5): 2 estatuas de caballero a los lados de una puerta (pista 2) |
| `tapiz-7-dragones` (+`-der`) | 80×130, pivote (0,5, 0,862) | 7 dragones en dos filas, 4 + 3 (pista 7) |
| `tapiz-dragones` (+`-der`) | 80×130, pivote (0,5, 0,862) | Decorativo: un solo dragón (emblema), para no confundirse con la pista |
| `arca` / `arca-cerrada` | 102×92, pivote (0,5, 0,804) | Arca con candado de 4 ruedas, 0,95 m de ancho; frente mirando abajo-izquierda (junto al muro de la fila y=0). `arca` = `arca-cerrada` |
| `arca-abierta` | 102×92, pivote (0,5, 0,804) | Tapa abierta sobre la bisagra trasera; interior de madera |
| `arca-der`, `arca-cerrada-der`, `arca-abierta-der` | 102×92, pivote (0,5, 0,804) | Variante con el frente mirando abajo-derecha (junto al muro de la columna x=0) |
| `armario` | 118×108, pivote (0,5, 0,819) | Armario de 1,6 m, dos puertas con tapajuntas y cerradura en la derecha; frente mirando abajo-izquierda (fila y=0) |
| `armario-abierto` | 118×108, pivote (0,5, 0,819) | Puertas abiertas 140° sobre sus bisagras exteriores; dentro, dos estantes. Las puertas sobresalen de la celda (§1.3) |
| `armario-der`, `armario-abierto-der` | 118×108, pivote (0,5, 0,819) | Variante con el frente mirando abajo-derecha (columna x=0) |
| `brasero` / `brasero-apagado` | 60×104, pivote (0,5, 0,827) | Brasero ceremonial: cuenco de hierro remachado sobre pedestal de piedra, 0,95 m. Simétrico: una sola orientación. `brasero` = `brasero-apagado` |
| `brasero-encendido` | 60×104, pivote (0,5, 0,827) | Llamas toon y las 3 brasas flotantes de la pista (§1.4); sin halo propio |
| `estatua-caballero` | 66×128, pivote (0,5, 0,859) | Estatua de piedra de caballero (yelmo cerrado, espada apoyada), 2,4 m con pedestal; mirando abajo-izquierda. Un solo sprite para `estatua-izq` y `estatua-der`. Sobresale hacia arriba (permitido) |
| `estatua-caballero-der` | 66×128, pivote (0,5, 0,859) | Variante mirando abajo-derecha, por si alguna va junto al muro de la columna x=0 |
| `trono` | 94×122, pivote (0,5, 0,814) | Trono de madera con terciopelo rojo y herrajes, sobre tarima de dos escalones de piedra; 2 m de alto; mirando abajo-izquierda (fixture: (10, 1), contra el muro y=0). La tarima sobresale algo de la celda (§1.3) |
| `trono-der` | 94×122, pivote (0,5, 0,814) | Variante mirando abajo-derecha |
| `barril-suelto` / `barril-cerrado` | 84×76, pivote (0,5, 0,732) | Barril de roble con aros remachados, 1 m. Simétrico |
| `barril-movido` | 84×76, pivote (0,5, 0,732) | Apartado media celda: hueco en el suelo con el espejo (§1.6) |
| `barriles` (+`-der`) | 80×84, pivote (0,5, 0,754) | Decoración: tres barriles tumbados sobre calzos |
| `mesa-catas` / `mesa` (+`-der`) | 126×102, pivote (0,5, 0,701) | Mesa de catas con 6 copas boca abajo; huella 1×3 (§1.6) |
| `mesa-activa` (+`-der`) | 126×102, pivote (0,5, 0,701) | Copas de pie con vino encantado (brillo suave) |
| `mural-azulejos` / `mural-desordenado` (+`-der`) | 98×140, pivote (0,5, 0,871) | Mural 3×3 barajado, hueco abajo-derecha |
| `mural-completo` (+`-der`) | 98×140, pivote (0,5, 0,871) | Vendimia: 5 racimos cayendo en el barril (pista 5) |
| `compartimento` / `compartimento-cerrado` (+`-der`) | 98×140, pivote (0,5, 0,871) | Pieza superpuesta al mural: azulejo central en su sitio |
| `compartimento-abierto` (+`-der`) | 98×140, pivote (0,5, 0,871) | Azulejo central abierto sobre su bisagra, hueco oscuro detrás |
| `ranura-caliz` / `ranura-vacia` (+`-der`) | 98×140, pivote (0,5, 0,871) | Repisa de piedra bajo el mural con hueco para el cáliz |
| `ranura-con-caliz` (+`-der`) | 98×140, pivote (0,5, 0,871) | Con el cáliz real dorado (gema roja) |
| `mirilla` (+`-der`) | 54×106, pivote (0,5, 0,83) | Placa de hierro con rendija, a 1,5 m |
| `sarcofago` (+`-der`) | 116×98, pivote (0,5, 0,708) | Sarcófago de piedra con la efigie del rey; huella 1×2 |
| `altar` / `altar-seco` (+`-der`) | 110×94, pivote (0,5, 0,715) | Altar de piedra con pila vacía; huella 1×2 |
| `altar-con-agua` (+`-der`) | 110×94, pivote (0,5, 0,715) | Pila llena de agua sagrada (azul luminoso) |
| `relicario` / `relicario-sellado` (+`-der`) | 68×70, pivote (0,5, 0,743) | Relicario de madera y oro atado con el sello morado |
| `relicario-abierto` (+`-der`) | 68×70, pivote (0,5, 0,743) | Tapa abierta, el alma del rey sale como luz dorada |
| `vasijas-8` (+`-der`) | 128×94, pivote (0,5, 0,668) | 8 vasijas funerarias (pista 8); huella 1×2 |
| `canal` (+`-y`) | 66×64, pivote (0,5, 0,719) | Entrada del canal: artesa de piedra seca con la boca oscura |
| `canal-tramo` (+`-y`) | 60×48, pivote (0,5, 0,625) | Nuevo (§1.7): tramo recto del canal |
| `compuerta` / `compuerta-cerrada` (+`-y`) | 60×80, pivote (0,5, 0,775) | Compuerta de madera con cerradura de oro sobre el canal |
| `compuerta-abierta` (+`-y`) | 60×80, pivote (0,5, 0,775) | El tablero sube: el paso queda libre |
| `antorcha` (+`-der`) | 46×122, pivote (0,5, 0,852) | Antorcha de pared encendida (decoración bake-able) |
| `puerta-madera` / `puerta-cerrada` (+`-x`) | 122×110, pivote (0,5, 0,725) | Puerta de roble con herrajes, en el hueco de `muro-arco` (§1.8) |
| `puerta-abierta` (+`-x`) | 122×110, pivote (0,5, 0,725) | Abierta 100° hacia la sala |
| `reja` / `reja-cerrada` (+`-x`) | 124×110, pivote (0,5, 0,721) | Reja de hierro con la forma del arco |
| `reja-abierta` (+`-x`) | 124×110, pivote (0,5, 0,721) | Abierta 100° hacia la sala |
| `placa-piedra` / `placa-arriba` | 64×38, pivote (0,5, 0,526) | Placa de presión de piedra con anillo tallado |
| `placa-hundida` | 64×38, pivote (0,5, 0,526) | Hundida casi a ras, junta oscura alrededor |
| `columna`, `columna-base`, `columna-capital` | 52×138, pivote (0,5, 0,87) | Columna de 2,4 m; base y capitel en su sitio (§1.8) |
| `estandarte` (+`-der`) | 62×128, pivote (0,5, 0,859) | Estandarte rojo con corona dorada, colgado del muro |
| `umbral` (+`-x`) | 52×36, pivote (0,5, 0,5) | Umbral de piedra |
| `escalon` (+`-x`) | 64×42, pivote (0,5, 0,571) | Escalón de piedra de 0,2 m |
| `llave-bronce-suelo` | 64×64 | Nuevo: llave caída en el suelo (§1.1), centrada. Modelo 3D de la llave del icono, tumbada, en isométrico; mismo bronce que `icon-llave-bronce` |

**Objetos de pared:** el pivote es el centro de la celda del suelo de la que cuelgan (la celda pegada al muro), como
los objetos de suelo; el cuadro queda a ~1,3 m de altura sobre el muro. Imágenes grandes para la vista de
inspección (§1.5) en `entregas/objetos/inspeccion/` (lado largo 1024 px, fondo transparente en los tapices).
