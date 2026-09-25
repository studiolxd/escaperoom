# Packs gráficos (`public/packs/<packId>`)

Aquí viven los packs gráficos que consume la previsualización del runtime
(`/[locale]/room-preview`) y, más adelante, el juego. Un pack se identifica por
el `map.tileset` del `RoomPackage` (p. ej. `medieval-v1`).

## Estructura

```
public/packs/<packId>/
  pack.config.json          # opcional: collides, avatars, avatarOrigin, version, proyección…
  tiles/    tile-1.png, tile-2.png, tile-3.png, tile-10.png, …   # tiles del mapa
  sprites/  cuadro-rey.png, arca-cerrada.png, columna.png, …     # objetos, estados y decoración
  icons/    icon-llave-bronce.png, …                             # iconos de inventario
  avatar/
    caballero-m/  avatar-caballero-m-n-idle-1.png, …             # un personaje por carpeta (80 frames)
    maniqui/      avatar-maniqui-n-idle-1.svg, …                 # personaje de reserva (no seleccionable)
  fx/       fx-spark-1.png, …                                    # brillo reutilizable
```

El **nombre del archivo debe ser exactamente el frame** del `RoomPackage`
(`specs/26` §3.3): `WorldObject.sprite`, cada estado, `Decoration.sprite`,
`ItemDef.icon`, `tile-<id>` y los frames de avatar
`avatar-<characterId>-<dir>-<acción>-<n>`. `avatar/` acepta tanto subcarpetas
por personaje (`avatar/<characterId>/…`, la forma recomendada: un personaje
por carpeta con sus 80 frames ya prefijados) como ficheros sueltos
directamente en `avatar/` (compatibilidad con packs de un único avatar). Los
personajes **seleccionables** en el lobby se declaran en
`pack.config.json → avatars` (id, `label` localizado y `portrait` opcional);
un personaje presente en `avatar/` pero no listado ahí (como el maniquí de
reserva) sigue empaquetándose y animándose, pero no aparece como opción.

### Fuentes admitidas

Se aceptan `.svg` y `.png` (los PNG, tal cual, sin aviso). **Los SVG se
rasterizan automáticamente** al tamaño de lienzo canónico de su frame
(`reference/pack-grafico-lista-assets.md`): suelo `64×32`, sprites a su talla,
`icon-*` `64×64`, `avatar-*` `64×96`, `fx-*` `64×64`. En SVG no hace falta fijar
el tamaño final: dibuja con el lienzo/proporción correctos (iso 2:1, base
abajo-centro, con padding transparente) y el script lo escala sin deformar.

## Generar atlas + manifest

```bash
pnpm pack:build medieval-v1                 # genera atlas + manifest (un pack incompleto NO falla)
pnpm pack:build medieval-v1 --check         # valida sin escribir
pnpm pack:build medieval-v1 --strict        # falla si falta algún frame (chequeo final)
pnpm pack:build --pack <ruta> --room <json> # otra carpeta / otro RoomPackage
```

- **Pack incompleto = normal.** Mientras vas soltando assets, `pack:build` **genera
  igual** y termina con éxito; resume _"Pack incompleto: N entregados, M por cubrir"_.
  Lo que falta se ve con **placeholder** en la preview. Solo abortan los errores
  reales (SVG/atlas/manifiesto roto).
- **`--strict`** es para el chequeo final: exige todos los frames del `RoomPackage`.
- `tiles` se rasterizan/pintan a la **escala de entrega** (`PACK_SCALE = 2` →
  celda 128×64); el runtime los escala al tamaño lógico, así que la sala se ve
  igual con arte a 1× o 2×.

`pack:build` (`packages/game-runtime/scripts/build-pack.ts`):

1. Lee y decodifica los PNG por frame (códec PNG propio) y **rasteriza los SVG**
   al lienzo canónico (`sharp`), reencuadrando al bbox si el `viewBox` no es 2:1.
2. Empaqueta un atlas por carpeta (`atlas-tiles`, `atlas-sprites`, `atlas-icons`,
   `atlas-avatar`, `atlas-fx`) con su JSON en formato Phaser (`trim: false`,
   `rotation: false`, padding).
3. Construye `manifest.json` (`specs/26` §6) y lo valida con el esquema Zod y
   contra el `RoomPackage`: exige un frame por sprite/icono, una entrada
   `tiles` con `collides` explícito por cada `tileId` no nulo, y **80 frames**
   por cada personaje declarado en `pack.config.json → avatars` (error si la
   entrega es parcial; aviso, no bloqueante, si el personaje aún no tiene
   ningún frame).

`pack.config.json` es opcional; sirve para declarar `collides` por `tileId`
(obligatorio para que la colisión sea correcta), la versión del pack, la
proyección o animaciones explícitas.

> Sin pack (o con un manifiesto que no valida), la previsualización dibuja
> **placeholders procedurales** con el nombre de cada frame. Al añadir el pack,
> los frames se resuelven desde el atlas sin tocar código.

## `manifest.json`/`atlas-*` no se comitean — ni CI ni producción los generan hoy

`manifest.json` y `atlas-*.{png,json}` están en `.gitignore` (son artefactos
derivados, no fuente): cada persona que quiera ver el pack real en local corre
`pnpm pack:build medieval-v1` una vez. **Ni el `verify` de CI ni el build de
producción corren `pack:build`**: un clon limpio o un deploy siempre pintan
`RoomScene` con placeholders procedurales (recuadros isométricos con el nombre
del frame), para todo el pack — tiles, sprites, iconos del mundo y avatares
por igual. Esto es así desde antes de los avatares seleccionables, no algo que
cambien ellos.

Lo que **no** depende de `pack:build`: los iconos de inventario que pinta
`ItemIcon` (`icons/<frame>.png`, servidos directos por Next desde este mismo
directorio, sin pasar por el atlas) y cualquier fichero suelto de `public/`;
esos se ven bien en cualquier entorno con solo el checkout.

Lo que **sí** depende de `pack:build`: el sprite real de cada personaje y el
resto del tilemap dentro de Phaser (usan el atlas). El servidor de Colyseus
**no** depende de él en absoluto: la lista de personajes seleccionables
(`manifest.avatars`) la lee directamente de `pack.config.json` — fuente
versionada de la que `build-pack.ts` deriva `manifest.avatars` — precisamente
para que la unicidad de personaje (A1) funcione igual con o sin pack
compilado (`packages/colyseus-server/src/game/avatar-pack.ts`).

Publicar el pack real de verdad (más allá del placeholder de dev) es la vía
de `specs/26` §9: subirlo a R2 con versión inmutable; ese cableado (que el
build o el deploy publiquen ahí, y que el runtime lo resuelva desde R2 en vez
de `public/packs/`) sigue pendiente y es una tarea aparte, no de esta PR.
