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
| Origen/pivote | **abajo-centro** del rombo de la celda (documentado en el manifiesto) |
| Overhang | permitido hacia arriba (paredes, columnas, objetos altos); nunca hacia abajo/lados |
| Direcciones de avatar | 4 sentidos de rejilla (`n`, `e`, `s`, `w`), dibujados en iso |

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
| `20` | umbral de puerta | no |
| `21` | escalón / peldaño | no |
| `22` | reja / trampilla en el suelo | no |

> La semántica de `20`, `21` y `22` es una **propuesta** a cerrar al cablear 1.2/1.3. Lo que es
> obligatorio: que exista un frame para cada tileId no nulo del fixture y que el manifiesto declare
> `collides` por tileId (el runtime **no** infiere colisiones del número).

**Variedad mínima** (`04-runtime-juego-y-mundo.md` §8): 4–6 baldosas de suelo (piedra, loseta,
alfombra roja), 4 variantes de muro, 2 muros decorados (antorcha, tapiz) y transiciones: arco y
escalera. La **puerta de madera** es un `WorldObject` (sprite suelto `puerta-cerrada`/`puerta-abierta`),
no un tile.

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

### 4.3 Iconos de inventario (9)

`icon-antorcha`, `icon-caliz`, `icon-espejo`, `icon-llave-bronce`, `icon-llave-oro`,
`icon-llave-plata`, `icon-mechero`, `icon-pergamino`, `icon-vela`.

Formato cuadrado, ~64×64 a 1×, legible sobre panel oscuro. Las 3 llaves pueden compartir forma y
distinguirse por tintado (bronce/plata/oro), pero deben entregarse los 3 frames.

### 4.4 Avatares (1 base + atlas)

- **1 sprite base** con **tintado por color** (4 colores = 4 jugadores en v1); no se entregan 4
  sprites, solo la máscara tintable.
- Tamaño ~48×64 a 1× (cabe en una celda con overhang).
- Animaciones mínimas (`04` §2): `idle` (2 frames), `andar` (4 direcciones × 4 frames),
  `interactuar` (1 frame).
- Se entrega como **atlas de avatar** (`avatar-atlas`) con sus frames y `anims` en el manifiesto.

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
  packageFormat: string;   // versión del RoomPackage con la que se probó ("1")
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
}
```

## 7. Checklist de entrega

- [ ] Frame para cada **tileId** del fixture (`1`, `2`, `3`, `10`, `20`, `21`, `22`) + variedad §4.1.
- [ ] **57 frames** de objeto/estado/decoración con el nombre literal del `RoomPackage`.
- [ ] **9 iconos** `icon-*`.
- [ ] **Atlas de avatar** con `idle`/`andar`/`interactuar` y sus `anims`.
- [ ] **FX** de brillo reutilizable.
- [ ] `manifest.json` completo y validado (§6).
- [ ] Licencia y titularidad documentadas (§8).

## 8. Licencia y titularidad

- Al ser un pack **oficial** de la plataforma, la titularidad es de la plataforma o del estudio
  contratado según el contrato de encargo; se documenta la cesión de derechos.
- Si algún asset se generara con IA, aplica `18` §2.3: revisar TOS del proveedor y no asumir
  titularidad plena; reflejarlo en la licencia del asset.
- Nada de assets de terceros sin licencia compatible; sin marcas registradas.

## 9. Empaquetado y publicación

- Publicación en R2 bajo `assets/packs/medieval-v1/`, versión semver e **inmutable**; los
  `roomVersion` publicados guardan su `assets_hash` (`08` §5).
- Al publicar una revisión del pack, se actualiza el manifiesto y el hash; lo ya jugado no cambia
  en caliente.

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
- Personalización de avatar, animaciones de combate/emote, temas gráficos adicionales.
- Audio (vive en `15-audio-y-creditos-ia.md`).
- Plantillas de puzzle v2 (`07-plantillas-puzzle-v2.md`).

## 12. Dependencias

- `04-runtime-juego-y-mundo.md` §1–§4, §8 — modelo de mundo y alcance gráfico mínimo.
- `08-formato-roompackage.md` §2.1, §5 — `assetsManifest`, tileset y versionado.
- `reference/roompackage-rey-aldric.v1.json` — fuente exacta de tileIds, sprites e iconos.
- `18-legal-rgpd-y-menores.md` §2.3–§2.4 — titularidad de assets (incl. IA).
- `22-qa-y-pruebas.md` §2 — validador de assets.
