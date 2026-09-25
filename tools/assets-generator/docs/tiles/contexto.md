# Generador de tiles (suelos y muros SVG)

Generador de tiles isométricos 2:1 en SVG para los packs de EscapeRoom (`~/Dev/escaperoom`; el primero,
`medieval-v1`). Antes era la carpeta `tiles-generator/`; desde el 25-09-2026 está repartido en la
estructura de `assets-generator/`. Este documento contiene todo el contexto necesario para retomar el trabajo desde
cero: **leerlo antes de tocar `scripts/tiles/`**. Uso resumido para humanos en `uso.md`.

## Qué es y por qué existe

- Produce tiles de suelo en SVG: viewBox `0 0 128 64` (proporción 2:1), un rombo a
  sangre recortado con `clipPath`, fondo transparente.
- Los tiles deben **encajar entre sí** al repetirse en un tablero isométrico: la
  textura es periódica en el "suelo" y las juntas coinciden con el tile vecino.
- Nació para no perder variantes: cada modelo (madera, piedra, alfombra, con sus
  semillas y valores) se guarda como un preset JSON. Si mañana se crea una piedra
  con otros valores, se guarda como preset nuevo y el anterior sigue existiendo.

## Estructura

Rutas relativas a `assets-generator/`; todos los comandos se lanzan desde ahí.
```
scripts/tiles/tilegen.py       generador (Python 3, sin dependencias). Tipos de tile/muro y CLI.
scripts/tiles/sprites.py       objetos de vector-plano (tipo "sprite": columnas, muebles, objetos con estados, iconos, avatar, fx). Lo importa tilegen.py; NO importa tilegen (sería circular al ejecutar tilegen.py como script), por eso duplica rgb/shift/fmt/K.
scripts/tiles/preview.mjs      previsualización con sharp (package.json y node_modules en assets-generator/).
scripts/tiles/preview-estetica.mjs  previsualización de los tiles de un estilo (piezas a 1×/2× y sala de prueba).
scripts/tiles/rasterizar.mjs   SVG -> PNG a una escala dada (lo usa empaquetar_pack.py).
estilos/<estilo>/tiles/estetica.json   paleta y proporciones del estilo por tipo.
estilos/<estilo>/tiles/presets/*.json  FUENTE DE VERDAD: {"type": "piedra", "params": {...}}. Uno por modelo.
estilos/vector-plano/tiles/pack.json   mapa nombre-del-pack -> preset de vector-plano (lista en estilos/vector-plano/pack-assets.md).
packs/<pack>/tiles.json        mapa nombre-del-juego -> preset de cada pack (medieval-v1 usa presets de castillo-toon).
estilos/<estilo>/renders/svg/  SVG generados a partir de presets (regenerables, fuera de git: `pnpm run tiles:build`).
estilos/<estilo>/renders/previews/  <nombre>-mosaico.png (iso 3×3), <nombre>-tile.png (tile suelto, misma escala 4×), todos-128.png (tiles y muros a tamaño real) y sprites-128.png / sprites-hoja.png (sprites). Fondo transparente (pedido por el usuario 23-09-2026). Fuera de git.
packs/<pack>/renders/tiles/    salida de `export --pack <pack>` (fuera de git; se vacía en cada export). La de vector-plano, en estilos/vector-plano/renders/pack/.
```
`tilegen.py export` (también al final de `build --all`) copia cada SVG del mapa a `<destino>/<carpeta>/<nombre>.svg`.
Carpeta por prefijo, como espera el script del juego (elige el tipo de cada frame por carpeta): tiles/ (tile*),
icons/ (icon-*), avatar/ (avatar-*), fx/ (fx-*), sprites/ (resto). Al principio solo había tiles/ y sprites/ y el
juego no encontraba iconos ni fx ni animaciones del avatar (corregido 23-09-2026).

## Estilos y estéticas (25-09-2026)

El generador admite varias estéticas, una por estilo (`estilos/<id>/`):
- `estilos/<id>/tiles/estetica.json`: `nombre`, `descripcion`, `escala` (opcional, informativa) y `tipos.<tipo>`:
  parámetros que sobrescriben los defaults de ese tipo para toda la estética (paleta, alto de muro, tamaño de sillar…).
- Nombres de preset: **siempre** `<estilo>/<nombre>` (`castillo-toon/piedra-1` = `estilos/castillo-toon/tiles/presets/piedra-1.json`,
  sale en `estilos/castillo-toon/renders/svg/piedra-1.svg`), también los de **`vector-plano`** (la estética original,
  con los sprites de `sprites.py`): `vector-plano/piedra-1`. Un nombre sin estilo da error. Dentro de un preset, un
  parámetro que nombra otro preset (`floor_preset`) sin prefijo se refiere al mismo estilo.
- Los parámetros se resuelven en capas: el suelo de `castillo-toon/trampilla-1` no está en el preset sino en su
  estética (`tipos.trampilla.floor_preset` = `castillo-toon/piedra-1`). Mirar siempre las tres capas (defaults del
  tipo, estética, preset) o `tilegen.load_preset()`, que da el resultado final.
- Orden de parámetros: defaults del tipo <- `estetica.json` `tipos.<tipo>` <- params del preset. Un preset de
  estética solo guarda lo que cambia (a menudo solo la semilla).
- Pack: `packs/<id>/tiles.json` (nombre del juego -> preset) -> `tilegen.py export --pack <id>`
  -> `packs/<id>/renders/tiles/{tiles,sprites,…}`. `build --all` exporta los mapas de demostración de los estilos
  (`estilos/*/tiles/pack.json`) y todos los `packs/*/tiles.json`. `empaquetar_pack.py` genera y exporta él mismo los presets de su pack.
- `python3 scripts/tiles/tilegen.py esteticas` lista los estilos con tiles y cuántos presets tiene cada uno.
- `pnpm run tiles:preview-estetica <id>`: cada pieza a 1× y 2× y una sala de prueba
  (`estilos/<id>/renders/previews/sala-1x.png`, `sala-3x.png`).
- **`castillo-toon`** (pack medieval-v1, escape room del Rey Aldric): piedra gris cálida (tinte [16,8,-6], mortero
  #3b322b), muros de bloque de celda (`thick` 8) de **2,4 m** (`height` 208, `canvas_h` 272 → 64×136 a 1×), sillares
  de `block_len` 4 y 11 hiladas, arco/ventana escalados a esa altura. Los objetos NO salen de `sprites.py`: son renders
  3D (`packs/medieval-v1/entregas/objetos`). Piezas con elemento: sin sufijo = cara +v (columna x=0 del juego),
  `-v` (`dir: "v"`) = cara −u (fila y=0 del juego).
- Cambio en `gen_pared`: en un bloque de celda completa las dos caras miden igual; el desempate de la "cara larga"
  ahora respeta `dir` (`"u"` -> +v como antes, `"v"` -> −u). Presets existentes regenerados byte a byte iguales.
- Ejes: u del generador = x de pantalla hacia arriba-derecha = −y del juego; v del generador = abajo-derecha = +x del
  juego. La fila y=0 del juego mira a la sala con su cara −u; la columna x=0, con su cara +v.

## Comandos

```bash
python3 scripts/tiles/tilegen.py list                     # presets y parámetros
pnpm run tiles:build                                      # = tilegen.py build --all: regenera todos los SVG (+ export)
python3 scripts/tiles/tilegen.py export --pack medieval-v1   # packs/medieval-v1/renders/tiles/{tiles,sprites,…}
python3 scripts/tiles/tilegen.py export --estilo vector-plano   # mapa de demostración: estilos/vector-plano/renders/pack/
python3 scripts/tiles/tilegen.py build vector-plano/piedra-1
python3 scripts/tiles/tilegen.py build castillo-toon/piedra-1
python3 scripts/tiles/tilegen.py defaults piedra          # parámetros por defecto de un tipo
python3 scripts/tiles/tilegen.py new piedra vector-plano/piedra-3 --from vector-plano/piedra-1 --seed 21 --set grid=4
python3 scripts/tiles/tilegen.py new piedra piedra-3 --estilo castillo-toon --seed 3
python3 scripts/tiles/tilegen.py new alfombra alfombra-azul --estilo castillo-toon --set color='"#1b3a9c"'
pnpm run tiles:preview                                    # vector-plano: estilos/vector-plano/renders/previews/<nombre>-mosaico.png, -tile.png y todos-128.png
ESTILO=castillo-toon node scripts/tiles/preview.mjs       # mosaicos de otro estilo
node scripts/tiles/preview.mjs piedra-3                   # solo uno
```

- `--set clave=valor` interpreta el valor como JSON (`grid=4`,
  `base=[120,80,50]`); las cadenas con `#` van con comillas dobles dentro de simples.
- `new` **rechaza** sobrescribir un preset existente. Para cambiar un modelo, crear
  otro nombre (`piedra-2`, `piedra-gris-claro`…). No editar presets aprobados.
- Tras crear o cambiar un modelo: `build`, `preview` y **mirar el mosaico** para
  confirmar que las juntas no se notan entre tiles.

## Cómo funciona el dibujo (leer antes de tocar tilegen.py)

- El "suelo" es un cuadrado `[0,8]×[0,8]` en unidades de suelo. Se proyecta a iso con
  `transform="matrix(8 -4 8 4 0 32)"`: (0,0)→(0,32), (8,0)→(64,0), (0,8)→(64,64),
  (8,8)→(128,32). Todo lo que se dibuja dentro de ese `<g>` sale ya en perspectiva.
- Eje **u** (x del suelo) = de la esquina izquierda a la superior del rombo; eje **v**
  (y del suelo) = de la izquierda a la inferior.
- El `clipPath#rombo` (en coordenadas de pantalla) recorta a sangre. Los elementos
  pueden (y los fondos DEBEN) sobresalir del cuadrado (`rect x=-1 y=-1 width=10
  height=10`); el clip los recorta y así es el único borde del tile.
- Ruido: `noise_layer(freq, octaves, seed, alpha, offset, color)` genera en Python
  un value noise fractal **periódico en el suelo** (toro de 8×8 unidades de suelo,
  celdas enteras: `nu = round(8·8.944·fu)`, `nv` ídem) como PNG gris+alfa de
  `NOISE_PX`² (256) y lo embebe como `<image x=0 y=0 width=8 height=8>` dentro
  del grupo ISO, igual que el resto del dibujo: el periodo es el tile entero. El
  contraste se comprime ×0.6 alrededor de 0.5 para parecerse al `fractalNoise`
  antiguo. NO usar `feTurbulence`: ver "Estado actual" (su `stitchTiles` no es
  fiable en librsvg y no casaba entre tiles). Frecuencias en uso: madera
  `"0.16 0.6"` (grano corto a lo largo de u; la original `"0.02 0.35"` daba 1
  celda en u = ondas anchas tipo "papel doblado", rechazado por el usuario),
  piedra 0.8, alfombra 1.4 (fino) + 0.25 (manchas claras), cesped `"0.05 0.3"`.
  Nada de degradados radiales ni viñetas.
- Regla de encaje: cualquier cosa que cruce el borde del cuadrado debe hacerlo con
  **periodo exacto 8** en u y en v (o no cruzarlo).

### Tipos

- **madera** (`gen_madera`): `planks` tablones de ancho `8/planks` a lo largo de u,
  cada uno con su tono (`shade_range`) y vetas onduladas (`polyline`, `grain_lines`
  por tablón). Sin clavos, juntas transversales ni bisel entre tablones (se
  probaron y se quitaron, quedaban demasiado marcados). `dir` ("u" por defecto,
  "v" = girado 90°) intercambia u↔v con `matrix(0 1 1 0 0 0)` dentro del grupo ISO y
  gira también la anisotropía del ruido; el orden de llamadas al RNG no cambia.
  Params: `seed, planks, base, shade_range, grain_lines, noise_alpha, dir`.
- **piedra** (`gen_piedra`): losas irregulares tipo "crazy paving" por **Voronoi
  periódico**. Semillas en rejilla `grid×grid` con `jitter`, replicadas en toroide
  (copias ±8 en u y v). Cada celda se calcula contra todas las copias, se le aplica el
  inset de junta (`_inset`, erosión por recorte sucesivo de semiplanos, no un simple
  miter-join) sobre la **celda completa** (no sobre el trozo recortado, si no aparece
  una junta falsa en el borde del tile) y después el clip del rombo la recorta. Mismo
  color de losa a ambos lados del borde porque el color va por semilla. Tres capas por
  losa: cara, sombra abajo-derecha (`shadow`), filo claro arriba-izquierda
  (`highlight`) desplazado (-0.08,-0.08). Params: `seed, grid, jitter, gray_min,
  gray_max, tint, mortar, gap, shadow, highlight, noise_alpha`.
  `_inset` erosiona por semiplanos (recorta un polígono grande contra cada arista
  desplazada hacia dentro) en vez de intersecar aristas consecutivas (miter-join): en
  losas puntiagudas el miter-join podía generar un polígono autointersecado (una
  "grieta" en forma de lazo cruzando la losa, visible p. ej. en `piedra-2`); la
  erosión por semiplanos no puede autointersecarse, como mucho el vértice desaparece.
  También se filtran celdas con área < 0.12 (restos degenerados del recorte contra
  las copias toroidales) para que se vea el mortero de fondo en su lugar.
- **alfombra** (`gen_alfombra`): rojo fieltro. Fondo `color`, trama tejida con
  `pattern` de paso `weave_step` (debe dividir 8), grano fino y manchas claras con dos
  capas de ruido. Motivo opcional (`motif`, 23-09-2026): `"cuadros"` (diagonales del
  suelo u±v, que en iso se proyectan como cuadrícula vertical/horizontal tipo tartán)
  o `"rombos"` (líneas a lo largo de u y v, que en iso salen como rombos), paso
  `motif_step` (divide 8), `motif_color/width/opacity` y punto central `motif_dot`.
  Líneas explícitas que sobresalen del cuadrado, no `<pattern>`. Params: `seed, color,
  weave_color, weave_step, weave_opacity, weave_width, fine_alpha, blotch_alpha,
  motif, motif_step, motif_color, motif_width, motif_opacity, motif_dot`.
- **cesped** (`gen_cesped`, reescrito 23-09-2026 a petición del usuario para
  parecerse a su referencia cartoon: verde lima, briznas afiladas erguidas):
  1. Suelo: rect `base` + `patches` manchas oscuras (`patch_color`, polígonos
     suaves de 14 puntos, radio `patch_radius`, `patch_opacity`) en coordenadas de
     suelo con copias toroidales.
  2. Briznas **en espacio de pantalla**, no en el suelo: raíces en rejilla
     `grid×grid` + `jitter` (suelo), proyectadas con `_iso(u,v)`; cada brizna es una
     forma rellena afilada (`path` con dos `Q` y `Z`) que sube desde la raíz con
     alto `blade_h_min..max` **en px del viewBox**, inclinación `lean`, curvatura
     `bend`, ancho `blade_width` y uno de los `tones` (elegido con `tone_weights`).
     Cada mechón lleva además `under_blades` briznas cortas y anchas del tono 0
     que se pintan antes que las altas (zoff -0.6 en la clave de orden).
  3. Todas las briznas (con sus copias toroidales) se ordenan por `y` de raíz
     antes de emitirse (profundidad: las de delante tapan a las de atrás).
  Encaje: la copia toroidal de la raíz (±8 en u/v) equivale a desplazar la brizna
  por el retículo de tiles en pantalla (±64,∓32), así lo que sale por un lado del
  rombo entra por el vecino en el sitio exacto; y como el orden de pintado (y de
  raíz) es global, el solape coincide en ambos tiles. Comprobado en el mosaico:
  sin juntas. Los parámetros de cada brizna se generan una vez por mechón
  (`spec`) y se reutilizan en las 9 copias.
  Es la única excepción consciente al estilo "flat + trazos": el usuario pidió
  explícitamente calidad tipo referencia (briznas erguidas). Sigue sin
  gradientes ni sombras duras; capa de `noise_layer` sutil encima.
- **trampilla** (`gen_trampilla`, 23-09-2026): tile "objeto", no textura periódica.
  **Compone**: carga el suelo de otro preset (`floor_preset`, p. ej. `piedra-1` o
  `madera-1`), genera su SVG con el generador de ese tipo y le inserta la compuerta
  justo ANTES de la primera capa de ruido del suelo (busca
  `<g transform="{ISO}" opacity="`, que es como empieza siempre `noise_layer`), así
  la trampilla comparte el grano del suelo. Compuerta cuadrada de lado `size`
  centrada en el suelo: `planks` tablones a lo largo de u con ranura `gap`, tono
  `wood`±`shade_range` y vetas, dos flejes de hierro a lo largo de v
  (`iron`, `strap_width`) y anilla (`ring_r`) con placa junto al borde inferior.
  Volumen de los herrajes (iteración con el usuario el 23-09-2026): (1) sombras
  proyectadas + filos + remaches en dos tonos → "demasiado"; (2) silueta oscura a ras
  de suelo + cara superior desplazada → "están volando"; (3) + sombra de contacto →
  mejor, pero "el perfil debería dar sensación de sólido, no de sombra". Versión
  actual: **caras laterales explícitas** (`solid_rect`): cara −u (abajo-izquierda)
  en `iron`−14, cara +v (abajo-derecha) en `iron`−36 y cara superior `iron`
  desplazada `iron_thick` px (1.0) hacia arriba en pantalla = (+t/8, −t/8) en suelo.
  En la anilla el muro exterior visible del toro se parte por ángulo (θ=atan2(v,u):
  135°–225° tono medio, 45°–135° oscuro; base completa en oscuro para el muro interior
  lejano). Sin sombras de ningún tipo; solo filo claro fino y clavos arriba.
  **Aprobado por el usuario** ("me encanta cómo ha quedado", 23-09-2026).
  `wood: "floor"` toma `base` y `shade_range` del preset de suelo (solo si es madera;
  si no, error). Presets: `trampilla-1` (sobre piedra-1, madera oscura),
  `trampilla-madera` (sobre madera-1, madera oscura) y `trampilla-madera-2` (sobre
  madera-1, `wood: "floor"`: misma madera que el suelo, pedido por el usuario).
  Al cambiar el preset de suelo se regenera también la trampilla (`build --all`).

- **pared** (`gen_pared`, 23-09-2026): tiles "sprite con altura" según la spec
  de paredes que pasó el usuario (celda 2:1, lienzo 128×128 a 2×, pivote
  abajo-centro, solo las caras que dan al jugador, luz única arriba-izquierda,
  tileable, sin outline inferior, sombra de contacto dentro del dibujo). Lista
  de piezas de la spec: recto (tileable, 2 caras + canto), esquina (L),
  antorcha, tapiz/estandarte, ventana/mirilla, arco/paso (64×96 a 1×) y remate
  (canto al girar). Se van haciendo **una a una** con aprobación del usuario.
  Geometría: centro de la celda (cuadrado de lado `thick`) + brazos `arms`
  (`-u`, `+u`, `-v`, `+v`) hasta el borde; `dir` ("u"/"v") es el atajo para el
  recto. Cada rectángulo ocupado aporta su cara −u (`shade_left`, clara) y +v
  (`shade_right`, oscura) si no hay otro rectángulo pegado; las colineales se
  funden (`_merge_faces`); se pintan de atrás adelante y luego el canto
  (`shade_top`, el más claro). Cada cara se dibuja en su espacio 2D (x a lo largo
  en px, `K=8.944` px por unidad; y = altura en px) y se proyecta con
  `matrix(±8/K ∓4/K 0 -1 tx ty)`; `noise_layer` acepta `box`, `transform` y
  `px` para esto (los suelos siguen byte a byte iguales). Sillería a soga
  (`_masonry`): `courses` hiladas, sillares de `block_len` unidades (divide 8),
  juntas alternas, esquinas con `jitter`, filos claro/oscuro (`edge_width`,
  `edge_opacity`). **El patrón de sillares es un marco fijo de 8 unidades por
  tipo de cara** (`_wall_specs`, RNG sembrado con `f"{seed}-cu"` / `"-cv"`):
  toda pieza recorta el mismo patrón, así una esquina o un remate continúan la
  sillería del tramo recto vecino sin salto. Con `thick` 2 las esquinas caen en
  px entero y la juntura vertical entre piezas es exacta (comprobado). NO lleva
  suelo ni sombra proyectada. Subcomando `tilegen.py svg <preset> --set …`
  (SVG a stdout sin guardar): lo usa `preview.mjs` para generar los tramos
  rectos vecinos de una pieza con `arms`. `preview.mjs` lee el alto del viewBox:
  tiles altos → suelo `piedra-1` + fila de 3 tramos (recto) o pieza en el centro
  con un tramo vecino por brazo (arms), en orden de profundidad; `todos-128.png`
  los alinea por la base.
  Historial: `pared-1` (jitter 0.6, juntas negras: "demasiado desajustada, no
  parece la pared de un castillo"), `pared-2` (regular: jitter 0.12, juntas
  finas gris medio, filos suaves, 7 hiladas, tonos 148–174), **`pared-3`
  (= pared-2 con jitter 0.3): APROBADO** ("me quedo con esta última"); `-v` =
  misma pieza a lo largo de v. Al generalizar a `arms` cambió la secuencia RNG
  de los tonos de sillar (ahora por marco), el estilo es el mismo.
  `pared-esquina-1` = pared-3 con `arms ["-u","+v"]` (esquina trasera de una
  sala: brazo −u hacia el tramo de la izquierda, +v hacia el de la derecha).
  Resto de piezas (23-09-2026, "haz ahora del tirón el resto"): parámetro
  `feature` ("antorcha" | "tapiz" | "ventana" | "arco"), dibujado por `_feature`
  en el espacio 2D de la **cara larga** (la visible más larga; en empate la +v)
  centrado en `feature_pos`, casi todo tras el ruido (piedra del marco de la
  ventana y dovelas del arco, antes). Antorcha: soporte y anilla de hierro,
  mango de madera, llama en tres tonos planos y mancha de hollín (`torch_z`).
  Tapiz: barra de madera, paño `banner_color` con punta, ribete y rombo
  `banner_trim`, pliegue oscuro en el lado izquierdo. Ventana: aspillera oscura
  con arco (`window_w/h/z`) en un marco de 4 sillares claros. Arco: hueco de medio
  punto (`arch_w` unidades, jambas `arch_h` px) **recortado de verdad** de la cara
  (clipPath con `clip-rule=evenodd`), así se ve el tile de detrás; dovelas claras
  con juntas radiales; dentro se pintan la jamba interior (paralelogramo barrido
  por el lado del hueco al desplazarlo el grosor t: cara +v → hacia −v, en espacio
  de cara (−t·K, +8t); cara −u → (+t·K, +8t)) y el intradós (banda entre el arco
  delantero y el trasero); el suelo del paso no se pinta (transparente). Remate:
  `arms` de un solo brazo (`["+u"]` / `["-v"]`): el canto del extremo queda a mitad
  de celda. Presets: `pared-{antorcha,tapiz,ventana,arco}-1` (+ `-v`) desde
  pared-3, `pared-remate-1` (`["+u"]`) y `pared-remate-1-v` (`["-v"]`). Pendientes
  de aprobación por el usuario. Alto de lienzo: todos a 128 (la spec decía 64×96 a 1×
  para las variantes; no hace falta porque nada sobresale del muro de 64 px; si se
  quiere un muro más alto, `height` + `canvas_h`).

- **sprite** (`sprites.py`, 23-09-2026, "saca todo esto del tirón"): todo lo
  demás de la lista del pack (`estilos/vector-plano/pack-assets.md`). Preset
  `{"type":"sprite","params":{"kind":..,"state":..}}`, **un preset por archivo
  del pack con su mismo nombre** (los crea `sprites.PACK_SPRITES`; 72 presets).
  `SIZES[kind]` = lienzo a 1× del pack; se genera a 2×. Clase `S`: lienzo con la
  celda apoyada abajo-centro (`p(u,v,z)` proyecta suelo+altura con la misma
  matriz que los tiles; `face()` = plano de pared v=0, que coincide con la cara
  +v del bloque de muro de la celda de detrás, para cuadros, tapices, mural,
  mirilla, antorcha, compartimento, puerta, reja, compuerta) y primitivas
  `box` (caja iso: −u clara, +v oscura, tapa más clara, contorno fino), `cyl`
  (cilindro en tres bandas planas), `flame` (llama en 3 tonos), `poly/ell/line/
  path`. Cada kind es `k_<kind>(s, state)`; `avatar` y `fx-spark` devuelven un
  dict nombre → svg (28 y 64 archivos): `build` escribe uno por entrada y
  `export` los copia todos. Estados: base = el estado "cerrado/seco/vacío"
  correspondiente. Avatar: personaje sencillo, túnica gris clara (tintable),
  n = de espaldas, e/w = perfil (w es e reflejado), walk 4 frames (paso ±6 px +
  balanceo), interact = brazo derecho levantado. fx-spark: estrella de 8 puntas
  que gira y crece/decrece con envolvente sin(πt) + 9 partículas; no se genera
  la sheet 512×512. Revisado en `estilos/vector-plano/renders/previews/sprites-hoja.png` (todos los sprites
  con etiqueta, muestras de avatar/fx): primera pasada completa, sin aprobación
  individual del usuario todavía. `preview.mjs`: un sprite se compone sobre suelo
  piedra-1 en la celda central; `sprites-128.png` es la hoja de contacto a
  tamaño real (×2) de todos los sprites (grande: incluye los 92 frames).

Para un tipo nuevo: añadir `X_DEFAULTS`, `gen_x(params)` que devuelva el SVG completo
(usar `HEAD`, `CLIP`, `ISO`, `noise_layer`) y registrarlo en `TYPES`. Mantener el
orden de las llamadas al `random.Random(seed)` cuando se retoque un tipo existente,
o los presets aprobados dejarán de reproducirse igual. **Coherencia gráfica**: todo
lo que se genere debe seguir el mismo lenguaje visual que ya usan madera/piedra/
alfombra/cesped — relleno(s) plano(s) + trazos/patrones vectoriales finos + una capa
de `noise_layer` sutil encima; nada de gradientes radiales, viñetas, ni relieve/3D
(sombras duras tipo "objeto levantado del suelo" como en referencias fotográficas).
Si se trae una imagen de referencia con otro estilo (más 3D, más detallada, etc.), se
adapta al estilo flat existente salvo que el usuario pida explícitamente romper con él.

## Estado actual (22-09-2026)

- `alfombra-1` a tamaño real es casi un rojo plano (la trama de 0.03 desaparece a
  128×64). El usuario preguntó "¿le harías algún arreglo?" (23-09-2026): se crearon
  `alfombra-2` (motif cuadros, ocre `#c9a04a`, width 0.1, opacidad 0.5, punto 0.16,
  trama 0.04) y `alfombra-3` (igual con motif rombos). Pendiente de elección.
- Presets aprobados por el usuario: `madera-1` (seed 7, `shade_range` 4, `dir` "u":
  el 23-09-2026 se giró a "v" y luego el usuario pidió volver a la orientación
  original; `shade_range`: ese mismo día
  el usuario pidió unificar una franja de tablón mucho más clara que el resto, que
  salía con el default 14; con 8 seguía viéndose en el mosaico como 3 franjas claras), `piedra-1` (losas
  grises estilo referencia "crazy paving", grid 3, jitter 0.9, seed 3), `alfombra-1`.
- `piedra-2` es una prueba (grid 4, jitter 0.6, seed 21), no aprobada explícitamente.
- `cesped-1` (seed 9, defaults). La primera versión (trazos planos en el suelo)
  la rechazó el usuario ("una porquería") frente a su referencia cartoon de
  briznas erguidas; el 23-09-2026 se reescribió `gen_cesped` por completo (ver
  "Tipos") y `cesped-1` se regeneró con el nuevo generador. El usuario dijo que
  "está bien" pero que difiere del estilo gráfico de madera/piedra (verde lima
  saturado, mucho contraste). Tras el commit 90e3118 se creó `cesped-2` (solo
  preset, mismo código): base [96,138,58] apagada, tonos de brizna más próximos
  entre sí y a la base, briznas 4–11 px, ancho 1.4, 4+2 por mechón, manchas al
  0.35, ruido 0.4. Después `cesped-3` = paleta de `cesped-2` + briznas de
  `cesped-1` (5–15 px, ancho 1.5, 5+3 por mechón). El usuario decidió dejar
  los tres como variantes (23-09-2026), ninguno marcado como "el" césped.
- 22-09-2026: corregido un bug en `_inset` (ver arriba) que producía losas
  autointersecadas ("grietas" cruzando la losa) en `piedra-2`; verificado que
  `piedra-1` se regenera visualmente idéntico (mismos vértices, solo cambia el orden
  de listado). Migrado el proyecto de npm a pnpm (`pnpm-lock.yaml`).
- 23-09-2026: `gen_madera` ya no dibuja clavos, ni el bisel claro/oscuro en el
  borde de cada tablón, ni la junta transversal (`cut`) por tablón (pedido por
  el usuario, quedaban demasiado marcados; primero se aclaró la junta pero
  seguía viéndose, así que se quitó del todo). Quitados los parámetros `nails`
  y `cut_step` de `MADERA_DEFAULTS`. Ahora `gen_madera` solo dibuja color base
  por tablón + vetas onduladas + ruido. `madera-1` regenerado.
- 23-09-2026: en el mosaico de `preview.mjs` se veía una fina línea en la juntura
  entre tiles. Parte del problema sí era del SVG: la onda de las vetas en
  `gen_madera` usaba `sin(u*1.3+ph)`, y 1.3 no da un número entero de ciclos en
  `L=8`, así que el valor en `u=0` y `u=8` no coincidía (violaba la regla de
  encaje "período exacto 8"). Arreglado forzando `cycles` entero (1 o 2 al azar)
  y `freq = 2π·cycles/L`; ya no hay salto de veta entre tiles.
- 23-09-2026: **la "línea" en las junturas: RESUELTA. No era antialiasing, era
  el ruido.** Diagnóstico anterior (erróneo): se atribuyó a los ~2 px de alfa
  parcial del borde diagonal del rombo. Midiendo píxeles crudos del mosaico
  había un **escalón de color** (p. ej. 136→142) al cruzar la juntura, no un
  píxel oscuro: `feTurbulence` con `stitchTiles` es periódico en su región de
  filtro (128×64), que NO es el desplazamiento entre tiles vecinos (±64,±32),
  así que el ruido no casaba entre tiles. Intentos descartados: (a) rombo
  escalonado alineado a píxel (alfa exacto 0/255, pero el usuario lo rechazó:
  borde exterior dentado y la línea seguía, porque era el ruido); (b) ruido en
  cuadrantes de 64×32 vía `<pattern>`/`<use>`/`<g translate>`: periodicidad
  exacta, pero **librsvg no implementa bien `stitchTiles`**: salto de alfa ~30
  en la frontera del cuadrante frente a ~2 en el interior, a 0.5×, 2× y 4× (a
  1× solo casaba en x por casualidad); tampoco con frecuencias que encajan un
  número entero de periodos ni con región `userSpaceOnUse`. Solución final:
  `noise_layer` genera el ruido en Python (value noise fractal sobre un toro
  de 8×8 unidades de suelo, `_value_noise`, PNG gris+alfa vía `_png_la`, sin
  dependencias) y lo embebe como `<image>` base64 de 256² px en el grupo ISO
  (35–95 KB por capa; primero se probó con cuadrantes de 64×32 en pantalla, más
  pequeño pero se veía la repetición 4× dentro del tile en alfombra).
  Periódico por construcción en cualquier renderizador. Parámetros equivalentes
  a los antiguos de feTurbulence (freq, octavas, seed, alfa/offset, color), así
  que los presets aprobados mantienen su aspecto (el grano cambia de forma
  concreta, no de carácter). Además los fondos sobresalen del cuadrado y madera
  lleva un rect base bajo los tablones (dos rect con lado diagonal compartido
  dejaban alfa 0.75 en la junta). Medido tras el cambio: salto de luminancia en
  la juntura igual al interno (madera 23.7 vs 23.2; alfombra 9.9 vs 10.1). El
  residuo de antialiasing del rombo recto es alfa 245–250 en 1 px (≈3 %,
  0.5 puntos de luminancia sobre fondo oscuro): imperceptible, se deja así.
  El rombo de `CLIP` sigue siendo de lados rectos.
- 23-09-2026: corregido un bug en `preview.mjs`: `node scripts/tiles/preview.mjs madera-1`
  (pasando nombres concretos) regeneraba `todos-128.png` solo con esos
  nombres, perdiendo el resto de tiles de la tira. Ahora `todos-128.png` siempre
  se construye con todos los SVG del estilo, independientemente de qué mosaico
  3×3 se haya pedido regenerar.
- Copia de los tres SVG aprobados también en
  `~/Dev/escaperoom/docs/assets/tiles-svg/tile-{madera,piedra,alfombra}.svg`
  (sin commit allí). La fuente de verdad es este generador.

## Relación con escaperoom

- El juego rasteriza los tiles a **64×32 px** (`packages/game-runtime/src/pack/svg.ts`,
  `TILE_CANVAS`) con `sharp`, y `pnpm pack:build medieval-v1` acepta SVG en
  `packages/web/public/packs/medieval-v1/tiles/tile-N.svg`. Según
  `docs/reference/pack-grafico-lista-assets.md`: tile-1 piedra, tile-2 loseta/piedra,
  tile-3 alfombra roja. Los tiles actuales del pack son de otro origen (114×66, export
  de Affinity) y **no se han sustituido**; hacerlo es decisión del usuario.
- El usuario pidió explícitamente: "no tienes que usar el pipeline, tienes que generar
  los svg". No integrar en el build del juego salvo que lo pida.
- **No tocar el código de escaperoom.** Aunque `TILE_CANVAS` siga en 64×32 ahí, el
  trabajo de comprobación de tamaño real en este repo se hace a **128×64** (ver más
  abajo); si algún día el juego pasa a 128×64 es decisión y cambio del usuario en su
  propio repo, no algo que se automatice desde aquí.
- Los SVG deben verse bien a tamaño real reducido: detalles menores de ~0.15 unidades
  de suelo (~1-2 px a 128×64) desaparecen. Comprobar siempre `estilos/<estilo>/renders/previews/todos-128.png`.

## Preferencias del usuario

- Español, con tildes. Respuestas cortas, resultados primero.
- Enseñar el resultado: enviar los SVG y los mosaicos de comprobación como archivos
  (SendUserFile) tras cada cambio relevante.
- Referencias visuales que ha dado: piedra tipo losas poligonales irregulares con
  mortero oscuro y borde iluminado (estilo "crazy paving" gris); le gustó ese resultado.
- Guardar variantes con nombres numerados (`piedra-1`, `piedra-2`…), sin sobrescribir.

## Git

Desde el 25-09-2026 **no es un repositorio ni una carpeta aparte**: el antiguo `tiles-generator/` (su historial
está en el repositorio pipeline-assets) está repartido en `scripts/tiles/`, `docs/tiles/`, `estilos/<estilo>/tiles/` y
`packs/<pack>/tiles.json` de `assets-generator/`. `node_modules/` y `renders/` ignorados (se regeneran). Commits solo cuando el usuario lo pida.
