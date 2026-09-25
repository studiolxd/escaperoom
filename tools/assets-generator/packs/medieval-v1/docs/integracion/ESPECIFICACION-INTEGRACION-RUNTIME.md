# EscapeRoom — especificación de integración del pack `medieval-v1` (assets 3D toon)

Fecha: 25/09/2026. Para: responsable del repo `escaperoom` (runtime `packages/game-runtime`, `docs/specs`, fixture
`docs/reference/roompackage-rey-aldric.v1.json`). Origen: `assets-generator` (nació en el repo `pipeline-assets`).

Este documento es **completo y autocontenido**: sustituye como encargo a `historial/runtime_objetos_mundo.md` (que queda como
historial razonado de cada decisión). El encargo de avatares e iconos (`historial/cambios-escaperoom-avatares.md`) **ya está
integrado** en el juego (PR #138: 8 personajes, `avatarOrigin`, 8/8/4 frames, sombra y anillo, yesquero); aquí solo
se cita lo que le afecta.

Objetivo: que el juego pinte el Rey Aldric con los assets definitivos (objetos renderizados en 3D toon, suelos y muros
del generador de tiles con el estilo `castillo-toon`), a escala real respecto al avatar, sin deformar nada.

---

## 1. Dónde están los assets y cómo llevarlos al juego

### 1.1 Generar la carpeta del pack
En `assets-generator/` (en el repo del juego, `tools/assets-generator/`; Python 3 con Pillow, y Node con `sharp` para rasterizar los SVG del generador):
```bash
cd tools/assets-generator                  # donde esté assets-generator
pnpm install                                # solo la primera vez (sharp)
python3 scripts/empaquetar/empaquetar_pack.py --pack medieval-v1   # -> packs/medieval-v1/salida/
```
Resultado (`packs/medieval-v1/salida/`, no versionado; se regenera): PNG a 2×.

| Carpeta | Frames | Contenido |
|---|---|---|
| `tiles/` | 8 | `tile-1` piedra (salón, catacumbas), `tile-2` piedra oscura (bodega), `tile-3` alfombra, `tile-10` muro, `tile-20`/`tile-21`/`tile-22` muro con hueco de arco, `tile-madera` (extra) |
| `sprites/` | 123 | objetos, estados, decoración y variantes de orientación; piezas de muro sin tileId (`muro-arco`, `muro-arco-x`, `muro-ventana`, `muro-ventana-x`, `muro-esquina`, `muro-remate`, `trampilla`) |
| `icons/` | 11 | los 10 iconos del fixture + `icon-mechero` (copia del yesquero, se puede borrar) |
| `avatar/` | 80 | `avatar-caballero-m-<dir>-<acción>-<n>` |
| `fx/` | 16 | `fx-spark-1..16` (brillo reutilizable, nuevo) |
| `pack.config.json` | — | id, version, projection, collides, avatars, avatarOrigin, anims (avatar + `fx-spark`) y los campos nuevos **`sizes`** y **`origins`** (§3) |
| `LEEME.md` | — | resumen |

### 1.2 Copiarla al juego
Las fuentes actuales de `packages/web/public/packs/medieval-v1/` son los SVG de vector plano del generador antiguo
(placeholders). `pack:build` lee **todos** los archivos de cada carpeta, así que hay que **vaciarlas antes** (si no,
convivirían `arca.svg` y `arca.png`):
```bash
P=escaperoom/packages/web/public/packs/medieval-v1
rm -rf $P/tiles $P/sprites $P/icons $P/avatar $P/fx
cp -R tools/assets-generator/packs/medieval-v1/salida/{tiles,sprites,icons,avatar,fx,pack.config.json} $P/
pnpm pack:build medieval-v1            # tras los cambios de §3; antes fallará por los lienzos no canónicos
```
Imágenes grandes para la vista de inspección (§6.1): `tools/assets-generator/packs/medieval-v1/entregas/objetos/inspeccion/*.png` (lado
largo 1024). Imagen del puzle deslizante del mural: `tools/assets-generator/packs/medieval-v1/entregas/objetos/puzles/mural-vendimia-3x3.png`
(1024×1024).

---

## 2. Convenciones del pack (lo que el runtime debe asumir)

1. **Proyección y escala.** Iso 2:1, celda 64×32 a 1×, `projection.scale` = 2 (los PNG están a 2×). Todo está a la
   **misma escala física que el avatar**: 1× = **49,93 px por metro** en horizontal (avatar de 1,75 m = 96 px de
   alto; celda de 0,905 m = rombo de 64 px), 43,24 px por metro de altura vertical en pantalla. Luz única desde
   arriba-izquierda (la de los avatares).
2. **Lienzo real por frame.** Cada sprite tiene su lienzo (p. ej. arca 102×92, trono 94×122, muro 64×136 a 1×), no
   uno canónico. `pack.config.sizes[frame] = [w, h]` a 1×.
3. **Ancla y origen.** El runtime ancla los objetos en `tileAnchor(x, y)` = vértice inferior del rombo de su celda.
   `pack.config.origins[frame] = [ox, oy]` es la **fracción del frame que debe caer en ese ancla**
   (`setOrigin(ox, oy)`). Puede salir fuera de [0, 1] (p. ej. la mirilla, `ox` = 1,09): Phaser lo admite.
   - Objetos de suelo: su celda.
   - **Objetos colgados de un muro** (cuadros, tapices, estandarte, mural, compartimento, ranura, mirilla, antorcha):
     se colocan **en la celda del muro** (como los cuadros del salón en y=0); el origin ya incluye el desplazamiento
     a la cara del muro que da a la sala.
   - **Puerta y reja:** en la celda del muro con hueco (tile 20/21/22); la hoja va en la cara que da a la sala.
   - Frames sin entrada en `origins` (muros, suelos): `(0.5, 1)`.
4. **Orientación por sufijo** (una celda no lleva rotación, así que va en el nombre del frame):
   - sin sufijo: pegado a la **fila y=0** (muro del fondo arriba-derecha), mirando a la sala (abajo-izquierda);
   - `-der`: pegado a la **columna x=0** (muro arriba-izquierda), mirando abajo-derecha;
   - `-x` (puerta, reja, umbral, escalón): pieza en la columna x=0 / a lo largo del eje y;
   - `-y` (canal, compuerta): el canal corre a lo largo del eje y (sin sufijo: a lo largo del eje x).
   Objetos simétricos (brasero, barril) no tienen variante.
5. **Estados:** el frame base (`arca`, `brasero`…) es el primer estado (cerrado/apagado/seco/vacío) y comparte lienzo
   y origen con todos sus estados: cambiar de estado = cambiar de frame, sin mover el sprite.
6. **Sin halo propio:** fuego, brasas, alma del relicario, agua… son colores planos; el resplandor lo pone el runtime
   con sus luces (spec 26 §5).
7. **Huellas de varias celdas** (el sprite sobresale de una celda más de lo que admite la spec actual; ver §5.1):
   `mesa-catas` 1×3 (eje x), `sarcofago` 1×2, `altar` 1×2, `vasijas-8` 1×2, `trono` (tarima) y puertas/rejas
   abiertas sobresalen hacia la sala. Para el orden de dibujo, usar la celda del ancla (la del objeto).
8. **Muros de 2,4 m** (`tile-10`, 20, 21, 22, piezas `muro-*`): lienzo 64×136 a 1× (128×272 a 2×), base 2:1 abajo.

---

## 3. Cambios de código

### 3.1 `pack:build` — `packages/game-runtime/scripts/build-pack.ts` y `src/pack/svg.ts`, `src/pack/image.ts`
- **Lienzos:** `FRAME_CANVASES` / `checkPngAspect` / `normalizePng` exigen hoy proporción y tamaño canónicos (arca
  96×96, muro 64×64…) y reescalan con `fit: "fill"`. Cambiar a: si `pack.config.sizes[frame]` existe, **ese** es el
  lienzo lógico del frame (sin comprobar la proporción canónica y sin reescalar con deformación); si no, el
  comportamiento actual.
- **`PackConfig`:** añadir
  ```ts
  sizes?: Record<string, [number, number]>;   // lienzo lógico a 1× por frame
  origins?: Record<string, [number, number]>; // fracción del frame en tileAnchor
  ```
  y copiarlos al manifiesto (§3.2).
- **Validación contra el RoomPackage:** con las variantes de orientación y los frames nuevos habrá frames que el
  fixture no usa: que sean aviso, no error.

### 3.2 Manifiesto — `src/pack/manifest.ts` (+ `specs/26` §6)
```ts
tiles: Record<string, { frame: string; collides: boolean; size?: [number, number]; origin?: [number, number] }>;
sprites: Record<string, { frame: string; size?: [number, number]; origin?: [number, number] }>;
```
(Zod: tuplas de dos números, sin restringir a [0, 1].) Por defecto `size` = el del frame / `projection.scale` y
`origin` = `[0.5, 1]`, para que los packs antiguos sigan funcionando.

### 3.3 Runtime — `src/phaser/room-scene.ts`
- `drawWalls` y los objetos/decoraciones usan hoy `fitToLogicalSize(image, ref, WALL_TILE_SIZE 64×64)` y
  `SPRITE_SIZE 64×96`, y `setOrigin(0.5, 1)` fijo. Cambiar a: tamaño = `manifest.*[frame].size` (o el del frame /
  `scale`) y `setOrigin(...(manifest.*[frame].origin ?? [0.5, 1]))`. **Sin esto todos los objetos se pintan
  deformados a 64×96 y los colgados/salientes se descolocan.**
- Orden de dibujo: el de siempre (`isoDepth` por celda). Puerta y reja se dibujan **después** del muro de su celda
  (ya ocurre si objetos van después de la capa `walls` en la misma celda; comprobarlo).
- Oclusión: los muros de 2,4 m del frente deben desvanecerse como ya prevé la spec 04 (probar que el alpha cubre
  el alto nuevo).
- **Brillo:** `manifest.fx.spark` sigue siendo `fx-spark-1`; hay anim `fx-spark` (16 frames, 16 fps, bucle) en
  `pack.config.anims` por si se quiere animar.

### 3.4 Acción de inspección con imagen (recomendado; §6.1)
Nueva acción de regla `show_image` (`{ type: "show_image", image: "<frame o ruta>", caption?: LocalizedText }`) que
abre un panel con la imagen grande. Imágenes en `entregas/objetos/inspeccion/` (subirlas con el pack, p. ej. como
`inspect/<nombre>.png`).

---

## 4. Cambios en el RoomPackage (`docs/reference/roompackage-rey-aldric.v1.json`)

Coordenadas `(x, y)` de celda. "Colgado" = en la celda del muro. Cada cambio lleva el motivo entre paréntesis.

### 4.1 Salón del trono (20×14; muros: fila 0, columnas 0 y 19, fila 13 con la puerta en (10,13))
1. **Llave que cae** (se ve de dónde sale la llave): regla del cuadro (`cuadro-aurelio` → `open`) crea un objeto
   recogible `llave-bronce-suelo` (sprite `llave-bronce-suelo`, 64×64, centrado) en la celda delante del cuadro,
   (6,1); al recogerlo, `grant_item llave-bronce` y se elimina. Patrón reutilizable: "escondite que suelta su item".
2. **Armario y arca, al muro del fondo** (en (18,4)/(18,6) están contra el muro del frente y se verían de espaldas):
   `armario` → **(1,4)**, sprite `armario-der`, estados `armario-der` / `armario-abierto-der`;
   `arca-candado` → **(1,6)**, sprite `arca-der`, estados `arca-cerrada-der` / `arca-abierta-der`.
3. **Luz del brasero:** `lighting` `torch` con `objectId: brasero` está en (5,1); el brasero en (4,6) → ponerla en
   (4,6) (o que la luz ligada a un objeto tome su posición).
4. **Pista del candado del arca (4732):**
   - `retrato-3` (12,0) → sprite **`cuadro-reino-brasero`** (el brasero apagado: remite al brasero real, que hay que
     encender para ver las 3 brasas); `retrato-4` (14,0) → **`cuadro-reino-estatuas`** (2 estatuas). Con el mismo
     `cuadro-reino` no se sabe qué contar. (`cuadro-reino` se entrega como alias provisional de `-estatuas`.)
   - `hint-arca-1`: "Los cuatro retratos **a la derecha del Rey**, de izquierda a derecha: torres, dragones, brasas,
     estatuas." (el cuadro del rey, a la izquierda, también tiene 4 torres y desfasaría la cuenta).
   - Diálogos al inspeccionar `retrato-2`, `retrato-3`, `retrato-4` y `tapiz-dragones` (hoy no tienen): p. ej.
     "Un castillo con cuatro torres", "Siete dragones dorados bordados", "Un brasero apagado", "Dos estatuas
     guardan una puerta"; y/o `show_image` (§3.4). A 64–96 px no se pueden contar 7 dragones.
5. **Decoración:** `tapiz-dragones` (4,0) se queda; el de (15,0) **se solapa** con `retrato-4` (14,0) → **(16,0)**.
   `estandarte` (2,10) y (17,10) no están en ningún muro visible → **(2,0)** y **(18,0)**. `columna` (2,3), (17,3):
   sin cambios (columna entera de 2,4 m; `columna-base`/`-capital` disponibles).
6. **Puerta de la bodega** (10,13, tile 20): sprite `puerta-madera`, estados `puerta-cerrada`/`puerta-abierta`. Está
   en el muro del frente (desvanecido por oclusión): la hoja se ve a través; abre hacia fuera (hacia la cámara).
7. **Placas** (6,11), (14,11): `placa-piedra`, estados `placa-arriba`/`placa-hundida` (sin cambios de posición).

### 4.2 Bodega (18×12; muros: fila 0, columnas 0 y 17, fila 10 con arco (7,10) y reja (12,10), fila 11)
1. **Mural, ranura y compartimento juntos, colgados del muro del fondo** (son piezas de pared; el compartimento se
   abre "tras el azulejo central" del mural): los tres en **(3,0)**. Se entregan con el mismo lienzo y origen: el
   runtime pinta encima del mural el compartimento (azulejo central) y la ranura (repisa con el cáliz).
   - `mural-vendimia`: sprite `mural-azulejos` (= `mural-desordenado`), estados `mural-desordenado`/`mural-completo`.
   - `compartimento-plata`: `compartimento`, estados `compartimento-cerrado`/`compartimento-abierto`.
   - `mural-ranura`: `ranura-caliz`, estados `ranura-vacia`/`ranura-con-caliz`.
   - `p-mural-vendimia.imageAsset` = `mural-vendimia-3x3` → la imagen de `entregas/objetos/puzles/` (solo la escena,
     sin la cenefa; semilla 812 y hueco abajo-derecha como en el fixture).
2. **Pista del 5:** los assets no llevan números: el mural completo muestra **5 racimos cayendo en el barril**.
   `d-mural`: "…los campesinos vierten **cinco racimos** en el barril…" (en vez de "al barril número 5"). Encaja con
   "cinco uvas me vieron caer" del sarcófago.
3. **Antorchas:** hay dos luces `torch` en (3,1) y (14,1) sin sprite → decoraciones `antorcha` colgadas en **(2,0)**
   y **(14,0)**, y mover las luces a esas celdas (o a (2,1)/(14,1), delante).
4. **Barriles:** `barriles` (1,2), (1,4) → sprite **`barriles-der`** (contra la columna x=0); (16,2) → `barriles`
   (pegado al muro del fondo, dejar en (16,1) si se prefiere que no toque el muro derecho). **Quitar** la decoración
   `barril-suelto` (15,8): duplica al objeto `barril-espejo` de esa celda.
5. **Barril escondite** (15,8): sprite `barril-suelto`, estados `barril-cerrado`/`barril-movido` (al moverlo deja ver
   el hueco con el espejo; entregar `espejo` como hasta ahora).
6. **Mesa de catas** (9,6): `mesa-catas`, estados `mesa`/`mesa-activa` (copas boca abajo / de pie con vino
   encantado). Huella **1×3 a lo largo de x**: (8..10, 6) no transitables.
7. **Reja** (12,10, tile 21): `reja`, estados `reja-cerrada`/`reja-abierta`. **Mirillas** (10,10), (14,10): `mirilla`.
   Nota de diseño: la fila 10 es el muro del frente de la bodega (su cara hacia la sala no la ve la cámara); reja y
   mirillas se ven a través del muro desvanecido. Si se quiere verlas de frente, el paso a la escalera debería ir en
   un muro del fondo.

### 4.3 Catacumbas (20×20; muros: filas 0 y 19, columnas 0 y 19)
1. **Canal visible hasta el altar** (hoy solo hay entrada y compuerta): `canal-entrada` → **(1,4)** (la boca contra
   el muro x=0), sprite `canal`; decoraciones **`canal-tramo`** en (2,4), (3,4), (5,4), (6,4), (7,4), (8,4);
   `compuerta-oro` (4,4) sin cambios (`compuerta`, estados `compuerta-cerrada`/`compuerta-abierta`).
2. **Altar** (10,4): `altar`, estados `altar-seco`/`altar-con-agua`. Huella 1×2 a lo largo de x (9..10 o 10..11).
3. **Relicario:** `d-catacumbas` dice "sobre el altar", pero están en celdas distintas ((10,2) y (10,4)). Recomendado:
   dejarlo en (10,2) y cambiar el texto a "**tras el altar**" (poner un objeto encima de otro exigiría elevación en
   el runtime). Sprite `relicario`, estados `relicario-sellado` (bandas de magia morada) / `relicario-abierto` (sale
   el alma del rey como luz dorada; buen momento para una luz dorada del runtime antes de `end_game`).
4. **Sarcófago** (10,8): `sarcofago`, huella 1×2 a lo largo de x. **Vasijas** (16,10): `vasijas-8` (8 vasijas, 2 filas
   de 4), huella 1×2.
5. **Antorchas:** (2,1), (17,1) → colgadas en **(2,0)** y **(17,0)**; (2,18), (17,18) cuelgan del muro sur, que no se
   ve → **(0,6)** y **(0,13)** con sprite **`antorcha-der`**.

---

## 5. Cambios en las especificaciones

### 5.1 `specs/26-pack-grafico-v1.md`
- **§3.1 Overhang:** "permitido hacia arriba; nunca hacia abajo/lados" → **hacia arriba libre; hacia los lados y
  hacia delante hasta ½ celda** (32 px a 1×); más allá, **huella de varias celdas** declarada en el objeto. Depth
  por la celda del ancla. Motivo: objetos a escala real respecto al avatar (armario de 1,6 m = 1,06 m de ancho).
- **§3.1 Origen:** además de `avatarOrigin`, **origen por frame** en el manifiesto (§3.2 de este documento).
- **§4.1 Muros:** lienzo **64×136 a 1×** (2,4 m), no 64×64: cuadros, tapices, antorchas y mirillas cuelgan a
  1,3–2,1 m. `tile-20`/`21`/`22` = muro con hueco de arco (la hoja de puerta/reja es objeto). Muros decorados
  `muro-antorcha`/`muro-tapiz`: no se usan (antorcha y tapiz son objetos colgados sobre `tile-10`).
- **§4.2 Frames:** añadir `cuadro-reino-brasero`, `cuadro-reino-estatuas`, `canal-tramo`, `llave-bronce-suelo`,
  `umbral`, `escalon`, `estandarte`, y las variantes `-der`/`-x`/`-y`. `tile-20`/`tile-21` no son umbral/escalón
  (la lista de assets los llamaba así; el fixture los usa como piezas de muro).
- **§4.3 Iconos:** ya actualizado con #138 (vista común, yesquero, busto).
- **§5 Iluminación:** la luz ligada a `objectId` se coloca en la celda del objeto.
- **§6 Manifiesto:** `size`/`origin` por frame (§3.2).
- **§2 Convenciones:** producción = objetos pre-renderizados desde 3D (Blender) y suelos/muros SVG del
  generador de tiles (estilo `castillo-toon`); escala física común (49,93 px/m a 1×).

### 5.2 `specs/04-runtime-juego-y-mundo.md`
- Inspeccionar: además de `show_dialog`, **`show_image`** (§3.4).
- Objetos con **huella de varias celdas** (colisión en todas; depth por el ancla).

### 5.3 `reference/pack-grafico-lista-assets.md`
Actualizar tamaños a los reales (anexo A) y la lista de frames (§5.1).

---

## 6. Funcionalidad nueva o recomendada

### 6.1 Vista de inspección con imagen
Varias pistas son conteos que a tamaño de juego no se leen (7 dragones, 4 torres, 8 vasijas, 5 racimos). Imágenes
grandes entregadas: `inspeccion/` → `cuadro-rey`, `cuadro-reino-4torres`, `cuadro-reino-brasero`,
`cuadro-reino-estatuas`, `tapiz-7-dragones`, `tapiz-dragones`, `estandarte`, `mural-completo`, `mural-desordenado`,
`mirilla`, `vasijas-8`. Sin esta vista, como mínimo un `show_dialog` descriptivo en cada uno.

### 6.2 Opcional
- Animación del fuego del brasero (`brasero.arder`) y de las antorchas: se pueden producir con la misma cámara.
- Luz dorada al abrir el relicario; brillo `fx-spark` sobre objetos interactuables.

---

## 7. Criterios de aceptación
1. `pnpm pack:build medieval-v1` sin errores (avisos por frames no usados, aceptables).
2. En el Rey Aldric, a 1× y 2×: ningún objeto deformado; el avatar (96 px) y el arca, el trono o el armario guardan
   proporción; los cuadros del salón quedan sobre la cara del muro del fondo, a media altura; la puerta y la reja
   llenan el hueco del arco; el mural, su compartimento y la ranura coinciden.
3. Cambios de estado sin salto de posición (arca, armario, brasero, placas, mural, compartimento, ranura, barril,
   mesa, altar, relicario, compuerta, puerta, reja, cuadro del rey).
4. Oclusión: los muros de 2,4 m del frente se desvanecen y dejan ver al avatar.
5. Las pistas se pueden resolver: 4 torres, 7 dragones, 3 brasas (brasero encendido), 2 estatuas; 5 racimos, 3 pares
   de copas, 8 vasijas; con la vista de inspección (o los diálogos) cuando el sprite es pequeño.
6. Referencia visual de cómo debe verse (sala pintada con la convención del runtime):
   `packs/medieval-v1/docs/integracion/pack_como_runtime.jpg` (en `assets-generator/`).

## 8. Pendiente (no bloquea)
- 7 personajes restantes (solo `caballero-m`); el pack los incluirá sin cambios de código (#138).
- Animaciones de fuego (§6.2).
- Si algún día hacen falta los muros con hueco en la columna x=0: tileIds nuevos (p. ej. `23`/`24`/`25`) mapeados a
  las variantes `-x`.

---

## Anexo A. Frames del pack: lienzo (1×) y origen

Generado de `packs/medieval-v1/salida/pack.config.json` (`python3 scripts/empaquetar/empaquetar_pack.py --pack medieval-v1`). Muros y suelos: origen `(0.5, 1)`.

| Frame | Carpeta | Lienzo 1× | Origen |
|---|---|---|---|
| `altar` | sprites | 110×94 | (0.5, 0.8849) |
| `altar-con-agua` | sprites | 110×94 | (0.5, 0.8849) |
| `altar-con-agua-der` | sprites | 110×94 | (0.5, 0.8849) |
| `altar-der` | sprites | 110×94 | (0.5, 0.8849) |
| `altar-seco` | sprites | 110×94 | (0.5, 0.8849) |
| `altar-seco-der` | sprites | 110×94 | (0.5, 0.8849) |
| `antorcha` | sprites | 46×122 | (1.1957, 0.8525) |
| `antorcha-der` | sprites | 46×122 | (-0.1957, 0.8525) |
| `arca` | sprites | 102×92 | (0.5, 0.9782) |
| `arca-abierta` | sprites | 102×92 | (0.5, 0.9782) |
| `arca-abierta-der` | sprites | 102×92 | (0.5, 0.9782) |
| `arca-cerrada` | sprites | 102×92 | (0.5, 0.9782) |
| `arca-cerrada-der` | sprites | 102×92 | (0.5, 0.9782) |
| `arca-der` | sprites | 102×92 | (0.5, 0.9782) |
| `armario` | sprites | 118×108 | (0.5, 0.9671) |
| `armario-abierto` | sprites | 118×108 | (0.5, 0.9671) |
| `armario-abierto-der` | sprites | 118×108 | (0.5, 0.9671) |
| `armario-der` | sprites | 118×108 | (0.5, 0.9671) |
| `barril-cerrado` | sprites | 84×76 | (0.5, 0.942) |
| `barril-movido` | sprites | 84×76 | (0.5, 0.942) |
| `barril-suelto` | sprites | 84×76 | (0.5, 0.942) |
| `barriles` | sprites | 80×84 | (0.5, 0.9443) |
| `barriles-der` | sprites | 80×84 | (0.5, 0.9443) |
| `brasero` | sprites | 60×104 | (0.5, 0.9807) |
| `brasero-apagado` | sprites | 60×104 | (0.5, 0.9807) |
| `brasero-encendido` | sprites | 60×104 | (0.5, 0.9807) |
| `canal` | sprites | 66×64 | (0.5, 0.9688) |
| `canal-tramo` | sprites | 60×48 | (0.5, 0.9583) |
| `canal-tramo-y` | sprites | 60×48 | (0.5, 0.9583) |
| `canal-y` | sprites | 66×64 | (0.5, 0.9688) |
| `columna` | sprites | 52×138 | (0.5, 0.9855) |
| `columna-base` | sprites | 52×138 | (0.5, 0.9855) |
| `columna-capital` | sprites | 52×138 | (0.5, 0.9855) |
| `compartimento` | sprites | 98×140 | (0.8265, 0.8714) |
| `compartimento-abierto` | sprites | 98×140 | (0.8265, 0.8714) |
| `compartimento-abierto-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `compartimento-cerrado` | sprites | 98×140 | (0.8265, 0.8714) |
| `compartimento-cerrado-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `compartimento-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `compuerta` | sprites | 60×80 | (0.5, 0.975) |
| `compuerta-abierta` | sprites | 60×80 | (0.5, 0.975) |
| `compuerta-abierta-y` | sprites | 60×80 | (0.5, 0.975) |
| `compuerta-cerrada` | sprites | 60×80 | (0.5, 0.975) |
| `compuerta-cerrada-y` | sprites | 60×80 | (0.5, 0.975) |
| `compuerta-y` | sprites | 60×80 | (0.5, 0.975) |
| `cuadro-reino` | sprites | 84×118 | (0.881, 0.8475) |
| `cuadro-reino-4torres` | sprites | 84×118 | (0.881, 0.8475) |
| `cuadro-reino-4torres-der` | sprites | 84×118 | (0.119, 0.8475) |
| `cuadro-reino-brasero` | sprites | 84×118 | (0.881, 0.8475) |
| `cuadro-reino-brasero-der` | sprites | 84×118 | (0.119, 0.8475) |
| `cuadro-reino-estatuas` | sprites | 84×118 | (0.881, 0.8475) |
| `cuadro-reino-estatuas-der` | sprites | 84×118 | (0.119, 0.8475) |
| `cuadro-rey` | sprites | 98×128 | (0.8265, 0.8594) |
| `cuadro-rey-der` | sprites | 98×128 | (0.1735, 0.8594) |
| `cuadro-rey-torcido` | sprites | 98×128 | (0.8265, 0.8594) |
| `cuadro-rey-torcido-der` | sprites | 98×128 | (0.1735, 0.8594) |
| `escalon` | sprites | 64×42 | (0.5, 0.9524) |
| `escalon-x` | sprites | 64×42 | (0.5, 0.9524) |
| `estandarte` | sprites | 62×128 | (1.0161, 0.8594) |
| `estandarte-der` | sprites | 62×128 | (-0.0161, 0.8594) |
| `estatua-caballero` | sprites | 66×128 | (0.5, 0.9844) |
| `estatua-caballero-der` | sprites | 66×128 | (0.5, 0.9844) |
| `llave-bronce-suelo` | sprites | 64×64 | (0.5, 0.75) |
| `mesa` | sprites | 126×102 | (0.5, 0.8583) |
| `mesa-activa` | sprites | 126×102 | (0.5, 0.8583) |
| `mesa-activa-der` | sprites | 126×102 | (0.5, 0.8583) |
| `mesa-catas` | sprites | 126×102 | (0.5, 0.8583) |
| `mesa-catas-der` | sprites | 126×102 | (0.5, 0.8583) |
| `mesa-der` | sprites | 126×102 | (0.5, 0.8583) |
| `mirilla` | sprites | 54×106 | (1.0926, 0.8302) |
| `mirilla-der` | sprites | 54×106 | (-0.0926, 0.8302) |
| `mural-azulejos` | sprites | 98×140 | (0.8265, 0.8714) |
| `mural-azulejos-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `mural-completo` | sprites | 98×140 | (0.8265, 0.8714) |
| `mural-completo-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `mural-desordenado` | sprites | 98×140 | (0.8265, 0.8714) |
| `mural-desordenado-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `muro-arco` | sprites | 64×136 | (0.5, 1) |
| `muro-arco-x` | sprites | 64×136 | (0.5, 1) |
| `muro-esquina` | sprites | 64×136 | (0.5, 1) |
| `muro-remate` | sprites | 64×136 | (0.5, 1) |
| `muro-ventana` | sprites | 64×136 | (0.5, 1) |
| `muro-ventana-x` | sprites | 64×136 | (0.5, 1) |
| `placa-arriba` | sprites | 64×38 | (0.5, 0.9474) |
| `placa-hundida` | sprites | 64×38 | (0.5, 0.9474) |
| `placa-piedra` | sprites | 64×38 | (0.5, 0.9474) |
| `puerta-abierta` | sprites | 122×110 | (0.5, 0.8701) |
| `puerta-abierta-x` | sprites | 122×110 | (0.5, 0.8701) |
| `puerta-cerrada` | sprites | 122×110 | (0.5, 0.8701) |
| `puerta-cerrada-x` | sprites | 122×110 | (0.5, 0.8701) |
| `puerta-madera` | sprites | 122×110 | (0.5, 0.8701) |
| `puerta-madera-x` | sprites | 122×110 | (0.5, 0.8701) |
| `ranura-caliz` | sprites | 98×140 | (0.8265, 0.8714) |
| `ranura-caliz-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `ranura-con-caliz` | sprites | 98×140 | (0.8265, 0.8714) |
| `ranura-con-caliz-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `ranura-vacia` | sprites | 98×140 | (0.8265, 0.8714) |
| `ranura-vacia-der` | sprites | 98×140 | (0.1735, 0.8714) |
| `reja` | sprites | 124×110 | (0.5, 0.8661) |
| `reja-abierta` | sprites | 124×110 | (0.5, 0.8661) |
| `reja-abierta-x` | sprites | 124×110 | (0.5, 0.8661) |
| `reja-cerrada` | sprites | 124×110 | (0.5, 0.8661) |
| `reja-cerrada-x` | sprites | 124×110 | (0.5, 0.8661) |
| `reja-x` | sprites | 124×110 | (0.5, 0.8661) |
| `relicario` | sprites | 68×70 | (0.5, 0.9715) |
| `relicario-abierto` | sprites | 68×70 | (0.5, 0.9715) |
| `relicario-abierto-der` | sprites | 68×70 | (0.5, 0.9715) |
| `relicario-der` | sprites | 68×70 | (0.5, 0.9715) |
| `relicario-sellado` | sprites | 68×70 | (0.5, 0.9715) |
| `relicario-sellado-der` | sprites | 68×70 | (0.5, 0.9715) |
| `sarcofago` | sprites | 116×98 | (0.5, 0.8712) |
| `sarcofago-der` | sprites | 116×98 | (0.5, 0.8712) |
| `tapiz-7-dragones` | sprites | 80×130 | (0.9, 0.8615) |
| `tapiz-7-dragones-der` | sprites | 80×130 | (0.1, 0.8615) |
| `tapiz-dragones` | sprites | 80×130 | (0.9, 0.8615) |
| `tapiz-dragones-der` | sprites | 80×130 | (0.1, 0.8615) |
| `tile-1` | tiles | 64×32 | (0.5, 1) |
| `tile-10` | tiles | 64×136 | (0.5, 1) |
| `tile-2` | tiles | 64×32 | (0.5, 1) |
| `tile-20` | tiles | 64×136 | (0.5, 1) |
| `tile-21` | tiles | 64×136 | (0.5, 1) |
| `tile-22` | tiles | 64×136 | (0.5, 1) |
| `tile-3` | tiles | 64×32 | (0.5, 1) |
| `tile-madera` | tiles | 64×32 | (0.5, 1) |
| `trampilla` | sprites | 64×32 | (0.5, 1) |
| `trono` | sprites | 94×122 | (0.5, 0.9448) |
| `trono-der` | sprites | 94×122 | (0.5, 0.9448) |
| `umbral` | sprites | 52×36 | (0.5, 0.9444) |
| `umbral-x` | sprites | 52×36 | (0.5, 0.9444) |
| `vasijas-8` | sprites | 128×94 | (0.5, 0.8386) |
| `vasijas-8-der` | sprites | 128×94 | (0.5, 0.8386) |

Iconos: 64×64 a 1× (`icons/`). Brillo: `fx-spark-1..16`, 64×64. Avatar: 64×96, `avatarOrigin` (0.5, 0.886).
