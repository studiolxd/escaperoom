# Generador de tiles — uso

Comandos desde `assets-generator/`. Contexto completo (para retomar el trabajo o tocar el código) en `contexto.md`.

Generador de tiles isométricos 2:1 en SVG (rombo a sangre, fondo transparente, 128×64).
Las texturas se dibujan en un suelo de 8×8 unidades proyectado a iso y son periódicas,
así que los tiles encajan entre sí al repetirlos en un tablero.

## Estilos

Cada estilo tiene su estética de tiles: `estilos/<id>/tiles/estetica.json` (paleta y proporciones por tipo) y sus
presets en `estilos/<id>/tiles/presets/` (todo preset se nombra `<estilo>/<preset>`, también los de `vector-plano`, la original).
Cada pack mapea sus nombres del juego a presets en `packs/<pack>/tiles.json`.

```bash
python3 scripts/tiles/tilegen.py esteticas
python3 scripts/tiles/tilegen.py new piedra piedra-3 --estilo castillo-toon --seed 3
python3 scripts/tiles/tilegen.py export --pack medieval-v1     # packs/medieval-v1/renders/tiles/
pnpm run tiles:preview-estetica castillo-toon                 # estilos/castillo-toon/renders/previews/
```

## Carpetas

- `estilos/<id>/tiles/presets/` — un JSON por modelo (`piedra-1.json`, `madera-1.json`, …). **Es la fuente de verdad**: guarda tipo, semilla y parámetros. Cada modelo nuevo va en un archivo nuevo, nunca se sobrescribe uno existente.
- `estilos/<id>/tiles/estetica.json`, `packs/<pack>/tiles.json`, `estilos/vector-plano/tiles/pack.json` — estética y mapas nombre-del-juego → preset.
- `scripts/tiles/tilegen.py` — el generador. Solo necesita Python 3, sin dependencias.
- `scripts/tiles/preview.mjs`, `preview-estetica.mjs` — previsualización con `sharp` (`pnpm install` en `assets-generator/`).
- `estilos/<id>/renders/svg/` — SVG generados a partir de los presets. Fuera de git.
- `estilos/<id>/renders/previews/` — PNG de comprobación (mosaico 3×3, tile suelto y tira a 128×64). Fuera de git.
- `packs/<pack>/renders/tiles/` — carpeta exportada (`tiles/`, `sprites/`, `icons/`, `avatar/`, `fx/`, por prefijo del nombre). La de vector-plano, en `estilos/vector-plano/renders/pack/` (lista de assets en `estilos/vector-plano/pack-assets.md`).

## Uso

```bash
python3 scripts/tiles/tilegen.py build --all          # regenera todos los presets (+ export)
python3 scripts/tiles/tilegen.py build castillo-toon/piedra-1   # solo uno
python3 scripts/tiles/tilegen.py list                 # presets y parámetros
python3 scripts/tiles/tilegen.py defaults piedra      # parámetros por defecto de un tipo
python3 scripts/tiles/tilegen.py export --pack medieval-v1   # packs/medieval-v1/renders/tiles/{tiles,…}/*.svg con los nombres del juego
python3 scripts/tiles/tilegen.py svg vector-plano/pared-3 --set arms='["-u","+v"]' > /tmp/esquina.svg   # SVG con overrides, sin guardar preset

# nuevo modelo: parte de los defaults (o de otro preset con --from) y guarda estilos/vector-plano/tiles/presets/piedra-2.json
python3 scripts/tiles/tilegen.py new piedra vector-plano/piedra-2 --seed 11 --set grid=4 --set jitter=0.6
python3 scripts/tiles/tilegen.py new piedra vector-plano/piedra-3 --from vector-plano/piedra-1 --seed 21
python3 scripts/tiles/tilegen.py new alfombra alfombra-azul --estilo castillo-toon --set color='"#1b3a9c"'

pnpm install && pnpm run tiles:preview  # estilos/vector-plano/renders/previews/ (otro estilo: ESTILO=<id>)
```

## Tipos y parámetros

- **madera**: `seed`, `planks` (tablones), `base` (RGB), `shade_range`, `grain_lines`, `noise_alpha`, `dir` (`"u"` o `"v"`: eje de los tablones, `"v"` = girado 90°).
- **piedra** (losas Voronoi periódicas): `seed`, `grid` (semillas por lado), `jitter`, `gray_min`, `gray_max`, `tint`, `mortar`, `gap`, `shadow`, `highlight`, `noise_alpha`.
- **alfombra** (fieltro): `seed`, `color`, `weave_color`, `weave_step`, `weave_opacity`, `weave_width`, `fine_alpha`, `blotch_alpha`, `motif` (`"none"`, `"cuadros"`, `"rombos"`), `motif_step`, `motif_color`, `motif_width`, `motif_opacity`, `motif_dot`.
- **trampilla** (compuerta de madera con flejes y anilla sobre el suelo de otro preset): `seed`, `floor_preset` (p. ej. `"piedra-1"`), `size`, `planks`, `wood` (RGB o `"floor"` = la del suelo), `shade_range`, `grain_lines`, `gap`, `frame`, `frame_width`, `edge_width`, `edge_opacity`, `iron`, `strap_width`, `ring_r`, `iron_thick` (grosor iso de los herrajes, px).
- **pared** (muro de sillería; sprite de 128×128 con la base 2:1 abajo, pivote abajo-centro, sin suelo): `seed`, `dir` (`"u"` o `"v"`: eje del tramo recto), `arms` (brazos desde el centro, p. ej. `["-u","+v"]` esquina, `["-u","+u","+v"]` T, los cuatro cruz, `["+u"]` remate; si se da, ignora `dir`), `thick` (grosor, unidades de suelo), `height` (px), `canvas_h` (alto del lienzo, px), `courses` (hiladas), `block_len` (largo de sillar, divide 8), `gray_min`, `gray_max`, `tint`, `mortar`, `gap`, `jitter`, `highlight`, `shadow`, `edge_width`, `edge_opacity`, `shade_left`/`shade_right`/`shade_top` (luz de arriba-izquierda: cara −u clara, cara +v oscura, canto más claro), `foot_shadow`/`foot_opacity` (sombra de contacto dentro de la cara), `noise_alpha`, `feature` (`"none"`, `"antorcha"`, `"tapiz"`, `"ventana"`, `"arco"`: elemento sobre la cara larga), `feature_pos`, `torch_z`, `banner_color`, `banner_trim`, `window_w/h/z`, `arch_w`, `arch_h`. El arco recorta el muro de verdad (se ve lo que hay detrás). Con `thick` 8 el muro es un bloque de celda completa (base = rombo entero 128×64, tapa = rombo superior): es el formato `tile-10` del pack (`muro-1`); con `thick` 2 es un muro fino centrado (`pared-*`).
- **sprite** (`sprites.py`: columnas, muebles, objetos con estados, iconos, avatar, efectos; un preset por archivo del pack): `kind`, `state`. Ver `estilos/vector-plano/pack-assets.md`.
- **cesped** (briznas erguidas estilo cartoon): `seed`, `base` (RGB), `patch_color`, `patches`, `patch_radius`, `patch_opacity`, `tones` (lista de RGB oscuro→claro), `tone_weights`, `grid` (mechones por lado), `jitter`, `blades_per_tuft`, `under_blades`, `blade_h_min`/`blade_h_max` (px de pantalla), `blade_width`, `lean`, `bend`, `noise_alpha`.

Los valores de `--set` se interpretan como JSON (`grid=4`, `base=[120,80,50]`); las cadenas con `#` van entre comillas dobles dentro de las simples.

## Encaje entre tiles

- Madera: el ancho de tablón divide el suelo de forma exacta y las juntas transversales se repiten con periodo 8.
- Piedra: las semillas del Voronoi se replican en toroide; una losa que cruza el borde continúa en el tile vecino con el mismo color, y la junta se calcula sobre la losa completa antes de recortar al rombo.
- Alfombra: ruido con `stitchTiles` y trama de paso exacto, sin degradados ni viñetas.
- Pared: el patrón de sillares es un marco fijo de 8 unidades por tipo de cara (−u / +v) que toda pieza recorta, así el tramo recto, la esquina o el remate continúan la sillería del vecino; los bordes verticales caen en x entero. Los cantos cortos se dibujan siempre; en una fila los tapa la pieza anterior al pintar por profundidad (x+y). El preview compone suelo `piedra-1` + una fila de 3 tramos (recto) o la pieza en el centro con un tramo vecino por brazo (`arms`), generado al vuelo con `python3 scripts/tiles/tilegen.py svg <preset> --set arms=…`.
