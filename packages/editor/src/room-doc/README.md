# Sala en el doc Yjs (ticket 3.1)

Forma del mapa y los objetos en el doc Yjs, serialización pura doc ⇄ `RoomPackage` y capa de
comandos de las herramientas del modo edición (`docs/specs/09-editor-de-salas.md` §1–§3).

| Fichero               | Qué hace                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `doc-model.ts`        | Claves raíz del doc, capas del editor y utilidades de entradas `Y.Map` por id.                       |
| `tiles.ts`            | RLE por filas ⇄ rejilla y claves de celda (`"capa\|x,y"`).                                           |
| `serialize.ts`        | `roomPackageToDoc`, `roomDocToPackage` (puras) y `observeRoomDoc` (un aviso por transacción).        |
| `commands.ts`         | `paintTiles`, `fillTiles`, `eraseTiles`, `placeObject`, `addObject`, `moveObject`, `renameObject`, `writeRoomMeta`, `initRoomDoc`… |
| `content.ts`          | Estructura y contenido (4.2, MCP): `defineSubRooms`, `setSubRoomGrid`, `setTileset`, `defineItem`, `addPuzzle`, `addDialog`, `addHint`. |
| `logic.ts`            | Lógica (4.3, MCP): `addRule` (referencias comprobadas, sobre el mapa `rules` de 3.6), `proposeRuleId`. |
| `tool-controller.ts`  | `EditToolController`: eventos de puntero del runtime (`mode: 'edit'`) → comandos sobre el doc.       |
| `use-room-package.ts` | `useRoomPackage(doc)`: la sala como `RoomPackage` en estado React.                                   |

## Modelo en el doc Yjs

```
meta      Y.Map   id, title, authorId, version, packageFormat, theme, description,
                  estimatedMinutes, difficulty, players, assetsManifest,
                  languages (Y.Array) + defaultLanguage            ← 3.10
map       Y.Map   tileset
subrooms  Y.Map<roomId, Y.Map>
            id, name, order, cols, rows
            layerNames  Y.Array<string>            (ground, walls, decor…)
            tiles       Y.Map<"capa|x,y", tileId>  disperso: celda vacía = sin clave
            decorations / spawnPoints / lighting   Y.Array<JSON>
objects   Y.Map<id, Y.Map>   una propiedad del WorldObject por clave + order
items     Y.Map<id, Y.Map>   id, name (YLocalizedText), icon, order        ← 3.10
puzzles   Y.Map<id, Y.Map>   una propiedad de la definición por clave + order
rules     (ver rules-graph/)                                             ← 3.6
dialogs   Y.Map<id, Y.Map>   id, text (YLocalizedText), conditions?, order ← 3.10
hints     Y.Map<id, Y.Map>   id, puzzleId, tier, cost, text, order         ← 3.10
```

- `order` conserva el orden de los arrays del RoomPackage y no se exporta; una entrada sin
  `order` (creada p. ej. desde 3.10) va al final, por id.
- Las celdas van en un mapa disperso y no en un `Y.Array` denso: dos pestañas pintando la misma
  celda convergen a un valor en lugar de desplazar la fila.
- Al exportar, cada capa se codifica en **RLE por filas** (una racha no cruza el final de fila), la
  forma del fixture: la ida y vuelta del Rey Aldric es idéntica byte a byte.

## Herramientas

`EditToolController` recibe `{ phase, cell, objectId? }` (lo emite `RoomRuntime` en
`mode: 'edit'` con `onEditEvent`). Pincel y borrador pintan en trazo (interpolando celdas),
relleno es 4-conexo sobre la capa activa, colocar propone un id legible (`arca-trono`) y arrastrar
solo toca el doc al soltar (mientras tanto el runtime pinta una previsualización). Renombrar un
objeto referenciado por reglas o puzzles se rechaza (`REFERENCED_ID`): para eso está
`renameElement` del inspector (3.4, `inspector/rename.ts`), que reescribe todas las referencias en
la misma transacción.
