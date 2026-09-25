# 26 — Pack gráfico v1 (`medieval-v1`)

Depende de `03-arquitectura-y-stack.md` (assets en Cloudflare R2), `04-runtime-juego-y-mundo.md`
§1–§4 y §8 (modelo de mundo, iluminación y alcance gráfico mínimo), `08-formato-roompackage.md`
(`meta.assetsManifest`, `map.tileset`) y `18-legal-rgpd-y-menores.md` §2.3–§2.4 (titularidad).

Este documento es el **brief de encargo y contrato de entrega** del pack gráfico de referencia de
v1. Es el entregable de documentación del ticket **1.2** (`plan/fase-1-runtime.md`): el arte lo
produce un estudio externo con plazo propio; el runtime lo consume cuando el pack está publicado.

---

## 1. Objetivo y alcance

- Un **único pack** `medieval-v1` que cubre la sala de prueba del **Rey Aldric** y dura todo el
  MVP. Se referencia desde `meta.assetsManifest` (`r2://assets/packs/medieval-v1/manifest.json`)
  y `map.tileset` (`medieval-v1`).
- El pack debe cubrir **todos** los assets referenciados por
  `reference/roompackage-rey-aldric.v1.json` (el fixture es el contrato), más la variedad mínima
  descrita en `04-runtime-juego-y-mundo.md` §8.
- **Sin pack no hay render final:** hasta la entrega, el runtime usa primitivas isométricas de
  color (ticket 1.1) como placeholder. El pack no cambia el contrato del `RoomPackage`.

## 2. Convenciones de producción (ADR-001)

- **Isométrico fijo 2:1**, sin rotación de cámara y **sin elevaciones/multinivel en v1** (rejilla
  plana con paredes en dos lados). Ver ADR-001 y `04-runtime-juego-y-mundo.md` §1.
- **Producción admitida:** sprites isométricos **pre-renderizados desde 3D** (3D para producir,
  2D para jugar). El runtime **nunca** carga 3D.
- **Luz única y coherente** en todo el pack (p. ej. desde arriba-izquierda). Sombras de contacto
  suaves, no proyectadas duras.
- **Legibilidad sobre fondo oscuro** (`#0b1120`, ver `game-runtime`): contraste suficiente para
  distinguir objetos interactuables de decoración.
- **Oclusión (guarda 2):** paredes y objetos por delante de un avatar se atenúan con alpha. Los
  bordes deben quedar limpios al 0–100 % de opacidad (sin halos ni franjas de fondo).
- **Sin texto incrustado** en los assets (todo copy va por `LocalizedText`/i18n).
- **Sin IP registrada**: nada de marcas, logotipos ni referencias a obras protegidas.

## 3. Especificación técnica

### 3.1 Rejilla y proyección

| Parámetro | Valor |
|---|---|
| Proyección | isométrica 2:1 |
| Celda (footprint en pantalla) | **64 × 32 px** a 1× |
| Export de referencia | 1× (64×32) y 2× (128×64) para pantallas HiDPI |
| Origen/pivote | **abajo-centro** del rombo de la celda (documentado en el manifiesto); **excepción: avatares**, ver abajo |
| Overhang | permitido hacia arriba (paredes, columnas, objetos altos); nunca hacia abajo/lados |
| Direcciones de avatar | 4 sentidos de rejilla (`n`, `e`, `s`, `w`), dibujados en iso |

**Pivote del avatar (excepción a "abajo-centro").** El punto de apoyo (suelo bajo el personaje)
está al **88,6 % del alto del frame** (desde arriba), centrado en horizontal —
`avatarOrigin: [0.5, 0.886]` en el manifiesto (§6)—, el mismo valor para los 8 personajes. En
proyección isométrica, el pie adelantado y la puntera quedan **por debajo** del punto de apoyo en
pantalla: si el suelo fuese el borde inferior del lienzo, habría que cortar los pies; dejando
espacio y pivotando en ese punto, el personaje no flota ni se hunde. El runtime lee
`avatarOrigin` del manifiesto con `[0.5, 1]` (abajo-centro) por defecto, por compatibilidad con
packs antiguos que no lo declaran.

### 3.2 Formato y export

- **Imágenes:** PNG-24 con alpha, sRGB, sin fondo, sin premultiplicar.
- **Atlas:** JSON con el formato de Phaser 3 (`TexturePacker`), `trim: false`, `rotation: false`,
  `padding: 2`, `bleed: 1`. Cada asset conserva el nombre de frame exacto (§4).
- **Audio:** fuera de alcance de este pack (ver `15-audio-y-creditos-ia.md`).
- **Pesos orientativos:** atlas de suelo/muros ≤ 2 MB; pack completo ≤ 5 MB en 1×.

### 3.3 Nombres de frame (obligatorio)

Los nombres de frame **deben coincidir exactamente** con los identificadores del `RoomPackage`:

- `WorldObject.sprite` y cada valor de `states` → un frame con ese nombre literal
  (`cuadro-rey`, `cuadro-rey-torcido`, `puerta-cerrada`, …).
- `Decoration.sprite` → un frame con ese nombre (`columna`, `tapiz-dragones`, …).
- `ItemDef.icon` → un frame con ese nombre (`icon-llave-bronce`, …).
- Tiles → `tile-<id>` (p. ej. `tile-10`), mapeado por el manifiesto (§6).
- Avatares → `avatar-<characterId>-<dirección>-<acción>-<n>` (p. ej.
  `avatar-caballero-m-e-idle-1`), ver §4.4.

Así el runtime resuelve frames por nombre sin tablas intermedias específicas del pack.

## 4. Inventario de assets

### 4.1 Tileset (`map.tileset = "medieval-v1"`)

Capas del tilemap: `ground`, `walls`, `decorations`, `objects` (`04-runtime-juego-y-mundo.md` §1).

**TileIds usados por el fixture** (mínimo obligatorio; `0` = celda vacía, nunca se pinta):

| tileId | Uso propuesto | ¿Colisiona? |
|---|---|---|
| `1` | suelo piedra (tablero A) | no |
| `2` | suelo loseta / piedra (tablero B) | no |
| `3` | alfombra roja | no |
| `10` | muro | **sí** |
| `20` | puerta de madera (hueco en la fila de muro) | no |
| `21` | reja (hueco en la fila de muro) | no |
| `22` | arco abierto (hueco en la fila de muro; lienzo de muro, como `muro-arco`) | no |

> `20`, `21` y `22` son **piezas de muro**: van en la capa `walls`, sobre la fila de muro, y se
> pasa a través de ellas. La semántica sigue las notas de diseño del fixture
> (`reference/rey-aldric-notas-diseno.md`). `22` usa el lienzo del muro (`tile-10`, 64×64 base);
> `20` y `21` mantienen 64×48 base. Lo obligatorio: que exista un frame para cada tileId no nulo
> del fixture y que el manifiesto declare `collides` por tileId (el runtime **no** infiere
> colisiones del número).

**Variedad mínima** (`04-runtime-juego-y-mundo.md` §8): 4–6 baldosas de suelo (piedra, loseta,
alfombra roja), 4 variantes de muro, 2 muros decorados (antorcha, tapiz) y transiciones: arco y
escalera. La **puerta de madera** es un `WorldObject` (sprite suelto `puerta-cerrada`/`puerta-abierta`),
no un tile.

#### Muros (sprites con altura, no tiles del suelo)

Los muros **no** son tiles del tileset de suelo: se pintan como **sprites con overhang** (pivote
abajo-centro, depth-sort por `x+y`, `collides: true`), porque **suben** por encima de la celda.

- **Celda/huella:** rombo **2:1** (64×32 a 1×), igual que el suelo.
- **Lienzo:** más alto que la huella — **64×64** a 1× (**128×128** a 2×). Un muro más alto (con
  cornisa o viga) es cambiar el preset (`height`/`canvas_h`); v1 no lo necesita porque **ningún
  elemento decorativo sobresale del alto del muro**. Base apoyada en la celda, cuerpo creciendo
  **hacia arriba** con padding transparente alrededor.
- **Dos caras visibles:** un muro iso enseña **cara izquierda** y **cara derecha** (y opcionalmente
  el **canto superior**). Solo esas dos: dibujar las cuatro taparía la sala. Las dos caras siguen la
  **luz única del pack** (a igual luz: una más clara, otra más oscura).
- **Tileable y con piezas:** tramo **recto** sin costuras (repetible a lo largo del grid), **esquina**
  (L) y, si se puede, cruce y **arco/paso**. Variantes: muro **normal**, **con antorcha**,
  **con tapiz/estandarte**, **con ventana/mirilla**. La **puerta** sigue siendo objeto, no muro.
- **Decoración sobre la cara:** antorcha, tapiz, ventana, arco y remate se dibujan **sobre la cara
  larga** del muro, en su mismo espacio 2D (heredan la luz de esa cara) y **sin desplazar el pivote**
  (la base sigue siendo el rombo 2:1 abajo-centro). El **arco** es un **hueco de medio punto
  recortado de verdad** del muro: se ve el suelo de detrás (transparente) y dentro se pintan la
  jamba interior y el intradós del lado que toca según la cara.
- **Remate (`muro-remate`):** brazo único con el canto del extremo a **mitad de celda** (para
  cerrar el final de un tramo); hay variante vertical.
- **Transparencia real** en el fondo (nunca un color plano opaco; ver §4.1 — un PNG con fondo opaco
  deja huecos oscuros entre tiles) y **sin outline en el borde inferior** (se duplicaría entre
  piezas). Bordes limpios al 0–100 % de alpha para que la **oclusión** (`04` §1) los desvanezca bien.

#### Esquinas de sala

Una esquina no es un muro distinto: es el **encaje** del vértice interior donde se juntan dos muros
(en iso, la que mira al jugador), para que no quede hueco ni costura.

- **`muro-esquina` (pieza L)**: resuelve el ángulo interior con la **misma anchura de huella y misma
  altura/cornisa** que el muro recto, de modo que el **canto superior quede continuo** (sin escalón).
- **`muro-remate` (opcional)**: cierra el canto cuando el muro gira hacia el lado visible.
- Se apoya en la celda con pivote abajo-centro; `collides: true`; transparente; sin outline en los
  bordes de unión.

#### Columnas

- **Huella** rombo 2:1, base apoyada en la celda; **lienzo ~64×128** a 1× (hasta 128×256 a 2×) para
  columnas altas.
- **Dos caras visibles** (izquierda/derecha con la luz del pack) + **capital/canto** arriba. Si es
  redonda, mismo tratamiento: sombreado por caras, sin degradado de fondo.
- Se entrega en piezas: **`columna-base`**, **`columna`** (fuste, opcionalmente tileable vertical),
  **`columna-capital`**. La base encaja con la anchura del muro si hace esquina.
- `collides: true`; **ocluible** (se desvanece al quedar por delante de un avatar, como los muros).

### 4.2 Sprites de objetos, estados y decoración

Checklist exacto tomado del fixture: **57 frames únicos**. Cada uno es un sprite isométrico
pivotado a la celda que ocupa.

**Decoración bake-able (6):**
`antorcha`, `barril-suelto`, `barriles`, `columna`, `estandarte`, `tapiz-dragones`.

**Objetos y sus estados (51):**
`altar`, `altar-con-agua`, `altar-seco`, `arca`, `arca-abierta`, `arca-cerrada`, `armario`,
`armario-abierto`, `barril-cerrado`, `barril-movido`, `brasero`, `brasero-apagado`,
`brasero-encendido`, `canal`, `compartimento`, `compartimento-abierto`, `compartimento-cerrado`,
`compuerta`, `compuerta-abierta`, `compuerta-cerrada`, `cuadro-reino`, `cuadro-reino-4torres`,
`cuadro-rey`, `cuadro-rey-torcido`, `estatua-caballero`, `mesa`, `mesa-activa`, `mesa-catas`,
`mirilla`, `mural-azulejos`, `mural-completo`, `mural-desordenado`, `placa-arriba`,
`placa-hundida`, `placa-piedra`, `puerta-abierta`, `puerta-cerrada`, `puerta-madera`,
`ranura-caliz`, `ranura-con-caliz`, `ranura-vacia`, `reja`, `reja-abierta`, `reja-cerrada`,
`relicario`, `relicario-abierto`, `relicario-sellado`, `sarcofago`, `tapiz-7-dragones`, `trono`,
`vasijas-8`.

- El frame base y el de cada estado deben ser **visualmente distinguibles** (p. ej. `arca-cerrada`
  vs `arca-abierta`).
- Las transiciones de estado con animación son **opcionales en v1** (`SpriteState.animation`,
  `04` §3.1); si se entregan, nombrarlas `<sprite>.<accion>` y declararlas en `anims` (§6).

### 4.3 Iconos de inventario (10)

`icon-antorcha`, `icon-busto`, `icon-caliz`, `icon-espejo`, `icon-llave-bronce`, `icon-llave-oro`,
`icon-llave-plata`, `icon-yesquero`, `icon-pergamino`, `icon-vela`.

Formato cuadrado, ~64×64 a 1×, legible sobre panel oscuro **y** claro. Las 3 llaves pueden compartir
forma y distinguirse por tintado (bronce/plata/oro), pero deben entregarse los 3 frames.

**Vista común (C1):** los 10 iconos comparten una misma vista de cámara — 3/4 ligeramente desde
arriba (~30°), objetos alargados dibujados en diagonal y verticales de pie — con el mismo
tratamiento toon 3D que los personajes (§4.4): sin contorno ni sombra propia, luz única
arriba-izquierda, cada objeto ocupando ~80 % del lienzo. En el inventario los iconos se ven juntos;
una vista común los hace parecer del mismo pack, y la 3/4 lee mejor los objetos verticales (cáliz,
vela, busto) que una vista frontal pura.

### 4.4 Avatares (8 personajes seleccionables)

- **8 personajes medievales** cerrados, no un avatar tintable: caballero/a, arquero/a, mago/a,
  campesino/a (4 masculinos, 4 femeninos). Se producen de uno en uno; el primero entregado es
  `caballero-m`. La elección de personaje **no** es personalización de avatar (fuera de alcance,
  §11): son personajes prediseñados entre los que el jugador elige.
- Lienzo **64×96** a 1× (128×192 a 2×), cabe en una celda con overhang para el pivote de §3.1.
- Animaciones por personaje (`04` §2): `idle` **8 frames** (bucle, 8 fps), `andar` **8 frames** ×
  4 direcciones (bucle, 12 fps), `interactuar` **4 frames** (una vez, 8 fps) — **80 frames por
  personaje**. "Interactuar" es alcanzar/manipular: el personaje extiende el brazo hacia el
  objeto a la altura del pecho y vuelve (cuadros, palancas, cofres, cerraduras); otros gestos
  quedan para después.
- **Sin sombra de contacto en el sprite** (A5): la dibuja el runtime en su propia capa bajo el
  avatar (una elipse, en el mismo punto de apoyo que el pivote de §3.1), para que no se desalinee
  al andar ni quede por encima de otros objetos en el orden isométrico.
- **Anillo de color del jugador**: como los personajes pueden repetirse entre dos jugadores de la
  misma sesión (el pack de hoy solo tiene uno), el runtime dibuja bajo los pies un anillo discreto
  con el color del jugador (el mismo del chat), junto a la sombra, y el nombre encima si ya existe
  esa etiqueta — así se reconoce quién es quién sin leer nombres, sin necesidad de tintar el
  sprite del personaje.
- Se entrega un **master 2D a 1536×2048** por personaje y su **modelo 3D**, para reutilizar
  (retrato del lobby/chat, nuevas animaciones o direcciones) sin volver a generar desde cero
  (A3/A9).
- **Estructura de entrega:** subcarpeta `avatar/<characterId>/` con los 80 frames prefijados
  (`avatar-<characterId>-<dirección>-<acción>-<n>`), su `pack.config.fragment.json` (`anims` y
  `avatarOrigin`) y su `LEEME.md` (herramientas y fecha, §8). `pnpm pack:build` fusiona todos los
  personajes en un único **atlas de avatar**; el manifiesto declara la lista en `avatars` (§6).
- **Personaje de reserva:** mientras no estén los 8, el maniquí SVG tintado por color que existía
  antes de A1 se mantiene en el pack como personaje de reserva (`avatar/maniqui/…`, characterId
  `maniqui`) — no aparece en `manifest.avatars` (no es seleccionable), pero conserva la convención
  de nombres de frame para que el runtime lo trate como un personaje más. Ver `specs/19` para
  cuándo el servidor lo asigna.

### 4.5 Efectos (FX)

- **1 partícula reutilizable** de brillo dorado (sheet 8×8) para reveals, aciertos y magia.
- La transición de fundido entre salas la implementa el runtime (no requiere asset).

### 4.6 UI

Los paneles (HUD, inventario 3×4 + zona de combinación, avatar de chat) se construyen en React.
Del pack solo se requiere la **iconografía mínima** (los 9 `icon-*` de §4.3 y, si aplica, iconos de
cronómetro/pista en el mismo estilo).

## 5. Iluminación

`SubRoom.lighting` combina luces de antorcha (ligadas a `objectId`) y luz ambiental (`04` §3.4):

- El pack debe sentirse correcto con **caída suave** de luz (degradado radial, sin círculo de borde
  neto); el runtime aplica el halo, pero los sprites no deben incluir su propio halo fijo.
- Los assets de antorcha/brasero se entregan en estado apagado y encendido.

## 6. Manifiesto del pack (`manifest.json`)

`meta.assetsManifest` apunta a `r2://assets/packs/medieval-v1/manifest.json`. Las rutas del
manifiesto son relativas a `assets/packs/medieval-v1/`. Forma propuesta (a materializar como
esquema Zod al cablear 1.2):

```ts
interface PackManifest {
  id: string;              // "medieval-v1"
  version: string;         // semver del pack
  packageFormat: string;   // versión del RoomPackage con la que se probó ("roompackage/v1")
  projection: { tileWidth: 64; tileHeight: 32; scale: number };
  atlases: { key: string; image: string; data: string }[];
  /** Mapa tileId → frame + colisión (el runtime no infiere colisión del número). */
  tiles: Record<string, { frame: string; collides: boolean }>;
  /** Frame por identificador de sprite del RoomPackage (objetos, estados, decoración). */
  sprites: Record<string, { frame: string }>;
  anims: { key: string; frames: string[]; frameRate: number; repeat: number }[];
  /** Frame por `ItemDef.icon`. */
  ui: { icons: Record<string, string> };
  fx: { spark: string };
  keys: string[];          // claves de atlas a precargar
  /** Personajes jugables seleccionables (A1/§4.4); opcional (packs antiguos, sin lista). */
  avatars?: { id: string; label: LocalizedText; portrait?: string }[];
  /** Punto de apoyo del avatar, fracción [x, y] del frame, y desde arriba (§3.1); por defecto [0.5, 1]. */
  avatarOrigin?: [number, number];
}
```

## 7. Checklist de entrega

- [ ] Frame para cada **tileId** del fixture (`1`, `2`, `3`, `10`, `20`, `21`, `22`) + variedad §4.1.
- [ ] **57 frames** de objeto/estado/decoración con el nombre literal del `RoomPackage`.
- [ ] **10 iconos** `icon-*` (§4.3, vista 3/4 común).
- [ ] **Atlas de avatar** con `idle`/`andar`/`interactuar` y sus `anims`, 80 frames por personaje
      declarado en `manifest.avatars` (§4.4).
- [ ] **FX** de brillo reutilizable.
- [ ] `manifest.json` completo y validado (§6).
- [ ] Licencia y titularidad documentadas (§8).

## 8. Licencia y titularidad

- Al ser un pack **oficial** de la plataforma, la titularidad es de la plataforma o del estudio
  contratado según el contrato de encargo; se documenta la cesión de derechos.
- **Avatares (A8):** las imágenes de los personajes las genera **el equipo** (no los usuarios) con
  herramientas bajo licencia comercial (Magnific plan de pago, Blender, Mixamo); su titularidad es
  de la plataforma, no un caso de `18` §2.3 (que trata audio de voz generado por IA para
  jugadores). Cada personaje documenta herramientas y fecha en su `LEEME.md` (§4.4).
- Nada de assets de terceros sin licencia compatible; sin marcas registradas.

## 9. Empaquetado y publicación

- Publicación en R2 bajo `assets/packs/medieval-v1/`, versión semver e **inmutable**; los
  `roomVersion` publicados guardan su `assets_hash` (`08` §5).
- Al publicar una revisión del pack, se actualiza el manifiesto y el hash; lo ya jugado no cambia
  en caliente.

### 9.1 Empaquetado local (`pack:build`, ticket 1.2)

El arte se entrega como **un PNG por frame** (nombre = identificador del `RoomPackage`, §3.3) en
`packages/web/public/packs/<packId>/{tiles,sprites,icons,avatar,fx}`. La carpeta `avatar/` acepta
además subcarpetas `avatar/<characterId>/…` (§4.4, un personaje por carpeta con sus 80 frames ya
prefijados), además de ficheros sueltos directamente en `avatar/` (el maniquí de reserva). El
script `packages/game-runtime/scripts/build-pack.ts` (raíz: `pnpm pack:build <packId>`) decodifica
los PNG, compone un atlas Phaser por carpeta (`atlas-<kind>.png` + `atlas-<kind>.json`) y genera
`manifest.json` (§6). El manifiesto se valida con el esquema Zod y contra el `RoomPackage`: exige un
frame por sprite/icono, una entrada `tiles` con `collides` **explícito** por cada `tileId` no nulo,
y **80 frames** por cada personaje declarado en `pack.config.json → avatars` (error si hay una
entrega parcial; aviso, no bloqueante, si el personaje aún no tiene ningún frame).

```bash
pnpm pack:build medieval-v1            # genera atlas + manifest.json en public/packs/medieval-v1
pnpm pack:build medieval-v1 --check    # valida nombres/faltantes sin escribir
```

Un `pack.config.json` opcional en la carpeta declara `collides` por `tileId` (obligatorio para que
la colisión sea correcta), la versión del pack y animaciones explícitas. Sin pack —o con un
manifiesto que no valida— el runtime dibuja **placeholders procedurales** con el nombre de cada
frame; al añadir el pack, los frames se resuelven desde el atlas sin tocar código. El detalle de la
carpeta está en `packages/web/public/packs/README.md`.

## 10. Criterios de aceptación (QA de la entrega)

1. Todo `sprite`/`icon` del fixture tiene un frame con el **mismo nombre**.
2. Todo tileId no nulo del fixture tiene entrada en `manifest.tiles` con `collides` explícito.
3. Proyección 2:1 verificada (rombo 64×32 a 1×) y sin costuras entre tiles.
4. Los assets se ven bien al atenuarse por oclusión (bordes limpios).
5. Pesos dentro de §3.2 y atlas JSON válidos para Phaser.
6. `manifest.json` pasa el validador de assets (`22-qa-y-pruebas.md` §2) y el fixture del Rey
   Aldric se renderiza íntegro con el pack.
7. Licencia/titularidad documentadas.

La **validación visual** la hace una persona: Sala 1 con tiles, decoración y colisiones, y avatares
atravesando puertas (`plan/fase-1-runtime.md` 1.2).

## 11. Fuera de alcance v1

- Rotación de cámara, multinivel/elevaciones, iluminación dinámica avanzada.
- Personalización de avatar (más allá de elegir entre los personajes cerrados de §4.4), animaciones
  de combate/emote, temas gráficos adicionales.
- Audio (vive en `15-audio-y-creditos-ia.md`).
- Plantillas de puzzle v2 (`07-plantillas-puzzle-v2.md`).

## 12. Dependencias

- `04-runtime-juego-y-mundo.md` §1–§4, §8 — modelo de mundo y alcance gráfico mínimo.
- `08-formato-roompackage.md` §2.1, §5 — `assetsManifest`, tileset y versionado.
- `reference/roompackage-rey-aldric.v1.json` — fuente exacta de tileIds, sprites e iconos.
- `18-legal-rgpd-y-menores.md` §2.3–§2.4 — titularidad de assets (incl. IA).
- `22-qa-y-pruebas.md` §2 — validador de assets.
