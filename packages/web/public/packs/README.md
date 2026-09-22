# Packs gráficos (`public/packs/<packId>`)

Aquí viven los packs gráficos que consume la previsualización del runtime
(`/[locale]/room-preview`) y, más adelante, el juego. Un pack se identifica por
el `map.tileset` del `RoomPackage` (p. ej. `medieval-v1`).

## Estructura

```
public/packs/<packId>/
  pack.config.json          # opcional: collides, version, proyección…
  tiles/    tile-1.png, tile-2.png, tile-3.png, tile-10.png, …   # tiles del mapa
  sprites/  cuadro-rey.png, arca-cerrada.png, columna.png, …     # objetos, estados y decoración
  icons/    icon-llave-bronce.png, …                             # iconos de inventario
  avatar/   avatar-n-idle-1.png, avatar-n-walk-1.png, …          # atlas de avatar
  fx/       fx-spark-1.png, …                                    # brillo reutilizable
```

El **nombre del archivo debe ser exactamente el frame** del `RoomPackage`
(`specs/26` §3.3): `WorldObject.sprite`, cada estado, `Decoration.sprite`,
`ItemDef.icon`, `tile-<id>` y los frames `avatar-<dir>-<acción>-<n>`.

### Fuentes admitidas

Se aceptan `.svg` y `.png` (los PNG, tal cual, sin aviso). **Los SVG se
rasterizan automáticamente** al tamaño de lienzo canónico de su frame
(`reference/pack-grafico-lista-assets.md`): suelo `64×32`, sprites a su talla,
`icon-*` `64×64`, `avatar-*` `64×96`, `fx-*` `64×64`. En SVG no hace falta fijar
el tamaño final: dibuja con el lienzo/proporción correctos (iso 2:1, base
abajo-centro, con padding transparente) y el script lo escala sin deformar.

## Generar atlas + manifest

```bash
pnpm pack:build medieval-v1                 # lee public/packs/medieval-v1 y escribe atlas-*.png/json + manifest.json
pnpm pack:build medieval-v1 --check         # valida sin escribir
pnpm pack:build --pack <ruta> --room <json> # otra carpeta / otro RoomPackage
```

`pack:build` (`packages/game-runtime/scripts/build-pack.ts`):

1. Lee y decodifica los PNG por frame (códec PNG propio, sin dependencias).
2. Empaqueta un atlas por carpeta (`atlas-tiles`, `atlas-sprites`, `atlas-icons`,
   `atlas-avatar`, `atlas-fx`) con su JSON en formato Phaser (`trim: false`,
   `rotation: false`, padding).
3. Construye `manifest.json` (`specs/26` §6) y lo valida con el esquema Zod y
   contra el `RoomPackage`: exige un frame por sprite/icono y una entrada
   `tiles` con `collides` explícito por cada `tileId` no nulo.

`pack.config.json` es opcional; sirve para declarar `collides` por `tileId`
(obligatorio para que la colisión sea correcta), la versión del pack, la
proyección o animaciones explícitas.

> Sin pack (o con un manifiesto que no valida), la previsualización dibuja
> **placeholders procedurales** con el nombre de cada frame. Al añadir el pack,
> los frames se resuelven desde el atlas sin tocar código.
