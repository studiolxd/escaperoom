# Pack gráfico v1 — lista de assets para buscar/encargar

Compañero de `specs/26-pack-grafico-v1.md` (el brief/contrato) y del fixture
`reference/roompackage-rey-aldric.v1.json` (el inventario exacto). Esta lista es para
**buscar en webs de recursos** o **encargar**, y para que los ficheros lleguen con el nombre que el
runtime resuelve.

---

## 1. Reglas de nombres (obligatorio)

El **nombre del frame debe ser EXACTAMENTE** el identificador del `RoomPackage`. Así el runtime
resuelve frames por nombre, sin tablas intermedias (specs/26 §3.3).

| Categoría | Patrón | Ejemplo |
|---|---|---|
| Tiles | `tile-<id>` | `tile-10` |
| Objetos, estados y decoración | el id literal, minúsculas y guiones | `arca-abierta`, `cuadro-rey-torcido` |
| Iconos de inventario | `icon-<item>` | `icon-llave-bronce` |
| Avatar | `avatar-<n\|e\|s\|w>-<idle\|walk\|interact>-<n>` | `avatar-s-walk-1` |
| Efectos | `fx-spark-<n>` | `fx-spark-1` |

- Formato: **PNG-24 con alpha**, sRGB, **sin fondo**, sin premultiplicar, minúsculas y guiones.
- **Un PNG por frame** con ese nombre (nosotros los empaquetamos luego en el atlas de Phaser y
  generamos `manifest.json`). Si el pack trae un atlas, da igual: lo troceamos y renombramos.
- **Pivote: abajo-centro** del rombo de la celda (documentado en el manifiesto).
- **Sin texto incrustado** (todo el copy va por i18n) y **sin IP registrada**.

## 2. Tamaños

La referencia manda: **celda isométrica 2:1 de 64 × 32 px** a 1×. Entrega 1× (y, si se puede, 2× =
128 × 64). El lienzo de cada sprite debe ser **generoso y transparente**, con la **base del objeto
alineada al rombo**; lo recortamos nosotros. Números orientativos:

| Tipo | Lienzo 1× sugerido |
|---|---|
| Suelo (tile liso) | 64 × 32 (a sangre) |
| Muro (tile con cara y alto) | 64 × 64 |
| Umbral / escalón / trampilla | 64 × 32 – 64 × 48 |
| Decoración de pared (cuadro, tapiz, estandarte) | 64 × 64 – 96 × 96 |
| Columna / antorcha de pared | 64 × 96 |
| Props bajos (placa, ranura, compuerta, alfombra) | 64 × 32 |
| Props medios (arca, barril, cofre, compartimento, reja) | 96 × 96 |
| Props altos (armario, estatua, altar, sarcófago, relicario, trono, puertas, mesa) | 128 × 128 |
| Iconos de inventario | 64 × 64 (cuadrado) |
| Avatar (por frame) | 64 × 96 |
| Efectos (spark) | 64 × 64 por frame, o sheet 512 × 512 (8 × 8) |

> Regla práctica: **64 × 32 es el dato crítico**. Si compras un pack a 32 × 16 o 128 × 64, vale
> igual (escala ×2 / ÷2) **siempre que sea 2:1**; mezclar packs de distinto tamaño/estilo NO vale.

## 3. Tiles (7 obligatorios + variedad)

| Frame | Uso | ¿Colisiona? |
|---|---|---|
| `tile-1` | suelo piedra (tablero A) | no |
| `tile-2` | suelo loseta/piedra (tablero B) | no |
| `tile-3` | alfombra roja | no |
| `tile-10` | muro | **sí** |
| `tile-20` | umbral de puerta | no |
| `tile-21` | escalón / peldaño | no |
| `tile-22` | reja / trampilla en el suelo | no |

**Variedad mínima** (specs/04 §8, para el editor): 4–6 baldosas de suelo (piedra, loseta, alfombra),
4 variantes de muro, 2 muros decorados (antorcha, tapiz) y transiciones (arco, escalera). Nombres
`tile-<id>` con ids nuevos (a partir de 30, p. ej.), que se declaran en el manifiesto.

## 4. Objetos, estados y decoración (frames de sprite)

### Decoración bake-able (6)
`antorcha`, `barril-suelto`, `barriles`, `columna`, `estandarte`, `tapiz-dragones`.

### Objetos (28 objetos → frames por estado)

| Objeto (id) | Frames de sprite necesarios | Qué es |
|---|---|---|
| `trono` | `trono` | Trono del rey (Salón) |
| `cuadro-aurelio` | `cuadro-rey`, `cuadro-rey-torcido` | Cuadro del rey; versión "torcida" al revelar el escondite |
| `retrato-2` | `cuadro-reino-4torres` | Retrato del reino (4 torres) |
| `retrato-3`, `retrato-4` | `cuadro-reino` | Retrato del reino (comparten frame) |
| `tapiz-dragones` | `tapiz-7-dragones` | Tapiz con 7 dragones |
| `armario` | `armario`, `armario-abierto` | Armario (contiene el mechero) |
| `arca-candado` | `arca`, `arca-cerrada`, `arca-abierta` | Arca con candado (código) |
| `brasero` | `brasero`, `brasero-apagado`, `brasero-encendido` | Brasero que se enciende |
| `estatua-izq`, `estatua-der` | `estatua-caballero` | Estatua de caballero (comparten frame) |
| `placa-izq`, `placa-der` | `placa-piedra`, `placa-arriba`, `placa-hundida` | Placas de presión |
| `puerta-bodega` | `puerta-madera`, `puerta-cerrada`, `puerta-abierta` | Puerta a la Bodega |
| `mural-vendimia` | `mural-azulejos`, `mural-desordenado`, `mural-completo` | Mural de azulejos (puzzle) |
| `mural-ranura` | `ranura-caliz`, `ranura-vacia`, `ranura-con-caliz` | Ranura del cáliz |
| `compartimento-plata` | `compartimento`, `compartimento-cerrado`, `compartimento-abierto` | Compartimento oculto (llave de plata) |
| `barril-espejo` | `barril-suelto`, `barril-cerrado`, `barril-movido` | Barril que se mueve (espejo) |
| `mesa-catas` | `mesa-catas`, `mesa`, `mesa-activa` | Mesa de catas (memoria de copas) |
| `reja-escalera` | `reja`, `reja-cerrada`, `reja-abierta` | Reja de la escalera a las Catacumbas |
| `mirilla-a`, `mirilla-b` | `mirilla` | Mirillas para ver símbolos (comparten frame) |
| `sarcofago` | `sarcofago` | Sarcófago (pista) |
| `altar` | `altar`, `altar-seco`, `altar-con-agua` | Altar final (canal) |
| `canal-entrada` | `canal` | Canal de agua |
| `compuerta-oro` | `compuerta`, `compuerta-cerrada`, `compuerta-abierta` | Compuerta del relicario de oro |
| `relicario` | `relicario`, `relicario-sellado`, `relicario-abierto` | Relicario (objetivo final) |
| `vasijas` | `vasijas-8` | Conjunto de 8 vasijas |

> El frame **base** y cada **estado** deben ser visualmente distinguibles. Las animaciones de
> transición son opcionales en v1 (si se entregan: `<sprite>.<accion>` y se declaran en el
> manifiesto).

## 5. Iconos de inventario (9)

`icon-antorcha`, `icon-caliz`, `icon-espejo`, `icon-llave-bronce`, `icon-llave-oro`,
`icon-llave-plata`, `icon-mechero`, `icon-pergamino`, `icon-vela`. Cuadrados, 64 × 64, legibles
sobre panel oscuro. Las 3 llaves pueden compartir forma y distinguirse por tintado, pero se entregan
los 3 frames.

## 6. Avatar (1 base tintable)

- 1 sprite base con **tintado por color** (4 colores = 4 jugadores). Lienzo ~64 × 96.
- Frames: **28** = 4 direcciones (`n`, `e`, `s`, `w`) × (idle 2 + walk 4 + interact 1).
  `avatar-n-idle-1`, `avatar-n-idle-2`, `avatar-n-walk-1..4`, `avatar-n-interact-1`, y así con e/s/w.

## 7. Efectos (1)

`fx-spark-1..64` (o sheet 8 × 8): brillo dorado reutilizable para reveals/aciertos. 64 × 64 por frame.

---

## 8. Dónde buscar y qué mirar

- **Términos:** "isometric 64x32 tileset", "isometric medieval props", "iso dungeon tileset",
  "isometric RPG assets". (Ojo: "top-down" **no** es isométrico.)
- **Proporción:** debe ser **2:1** (rombo 64 × 32). Evita "true isometric" (30°) y "dimetric"
  que no encajen.
- **Coherencia:** un solo **pack/familia** (mismo autor, misma luz) o se notará el pegote.
  Mejor un pack bueno + piezas a medida que cinco packs mezclados.
- **Licencia:** que permita **uso comercial**; guarda la licencia. Para audio/imágenes IA aplica
  `specs/18` §2.3 (titularidad). Nada de marcas registradas.
- **Audio:** fuera de este pack (`specs/15`).

## 9. Flujo de entrega

1. Consigues los PNG (pack comprado o encargado).
2. Los **renombras** exactamente a los frames de esta lista (§1).
3. Los dejas en una carpeta por categoría (`tiles/`, `sprites/`, `icons/`, `avatar/`, `fx/`).
4. Nosotros generamos el **atlas de Phaser** + `manifest.json` (specs/26 §6) y validamos contra la
   checklist de `specs/26` §7 y los criterios de §10.
