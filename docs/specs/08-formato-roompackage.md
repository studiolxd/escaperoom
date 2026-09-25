# 08 — Formato RoomPackage

Depende de `04-runtime-juego-y-mundo.md`, `05-motor-de-reglas-y-estado.md` y
`06-plantillas-puzzle-mvp.md`. El contrato ejecutable completo está en
`reference/roompackage-rey-aldric.v1.json`.

---

## 1. Principio: un único contrato declarativo

Todo lo que define una sala es **un solo documento JSON**. Es exactamente lo que el runtime del
jugador descarga y es el contrato entre **editor, API, base de datos, MCP y runtime**. Mismo
formato en edición, en BD y en juego.

**El JSON es declarativo:** el runtime no ejecuta scripts del creador — ejecuta datos. Esto da
validación, seguridad (sin código arbitrario) y permite que el servidor (Colyseus) evalúe reglas
con la misma definición, sin confiar en el cliente.

## 2. Interface `RoomPackage`

```typescript
interface RoomPackage {
  meta: {
    id: string;
    title: string;
    authorId: string;
    version: string;              // semver "1.2.0" — versionado para parches
    packageFormat: string;        // versión del formato; ver §6 ("roompackage/v1")
    theme: string;                // "medieval", "scifi"…
    description: string;
    languages: string[];          // ["es","en"] — multidioma desde el diseño
    defaultLanguage: string;      // "es"
    estimatedMinutes: number;
    difficulty: 1 | 2 | 3;
    players: { min: number; max: number };
    assetsManifest: string;       // referencia a R2 (tileset, sprites, audio)
  };

  map: {
    tileset: string;              // referencia a assets
    rooms: SubRoom[];             // divisiones internas (Salón, Bodega, Catacumbas)
  };

  objects: WorldObject[];         // interactuables del escenario
  items: ItemDef[];               // catálogo de objetos (llaves, cáliz, yesquero…)
  puzzles: PuzzleDefinition[];    // las plantillas (MVP + v2)
  rules: Rule[];                  // lógica declarativa SI/ENTONCES
  dialogs: DialogDef[];           // textos localizados (i18n)
  hints: HintDef[];               // sistema de pistas
}
```

### 2.1 `SubRoom`

```typescript
interface SubRoom {
  id: string;
  name: string;
  grid: { cols: number; rows: number };
  layers: TileLayer[];            // { name, rle: number[] }
  decorations: Decoration[];      // { sprite, x, y } — bake-ables
  spawnPoints: SpawnPoint[];      // uno por jugador + observador
  lighting: LightConfig[];        // torches ligadas a objectId + ambient
}
```

### 2.2 Multidioma y texto localizado

```typescript
type LocalizedText = Record<string /* locale, ej. 'es','en' */, {
  text: string;
  audioUrl?: string;              // audio opcional POR idioma
}>;
```

- `dialogs` y `hints` usan `LocalizedText`: cada entrada trae texto y, opcionalmente, audio por
  idioma (el narrador en español y en inglés puede no sonar igual ni generarse a la vez).
- El **catálogo** filtra por "la sala incluye este idioma" (`languages @> ARRAY[...]`).
- El **editor** necesita un selector de idioma activo por campo de texto.
- El crédito de generación de audio se traza por locale: `reference_id = {dialogId|hintId}:{locale}`
  (ver `specs/15-audio-y-creditos-ia.md`).

### 2.3 `DialogDef` y `HintDef`

```typescript
interface DialogDef {
  id: string;
  text: LocalizedText;
  conditions?: RuleCondition[];   // opcional: diálogo condicionado por flags/estado
}
interface HintDef {
  id: string;
  puzzleId: string;
  tier: number;                   // 1..N — escalonado
  text: LocalizedText;
  cost: number;                   // pistas restantes que consume
}
```

### 2.4 `ItemDef`

```typescript
interface ItemDef {
  id: string;
  name: LocalizedText;
  icon: string;
}
```

## 3. Estado inicial y runtime

- La **definición** es estática y se descarga una vez; la **instancia** viva (puzzles,
  inventario, posiciones, flags) se sincroniza como patches desde Colyseus.
- El estado inicial de la partida deriva de la definición: items en 0, objetos en su
  `initialState`, flags a `false`, puzzles en `locked`/`available` según `requiresSolved`.

## 4. Vocabulario de reglas

Ver `specs/05-motor-de-reglas-y-estado.md` §3 para la tabla completa de triggers, condiciones y
acciones. Las reglas se serializan como:

```json
{
  "id": "rule-encender-brasero",
  "priority": 0,
  "once": true,
  "trigger": { "type": "on_interact", "objectId": "brasero" },
  "conditions": [{ "type": "item_in_inventory", "itemId": "antorcha", "consumed": true }],
  "actions": [
    { "type": "set_object_state", "objectId": "brasero", "state": "lit" },
    { "type": "set_flag", "flag": "digito3", "value": 3 },
    { "type": "show_dialog", "dialogId": "d-brasero" },
    { "type": "play_sound", "soundId": "fx-fuego" }
  ]
}
```

## 5. Draft vs. versión publicada

```
PostgreSQL
├── room_drafts / room_updates / room_snapshots  ← Yjs doc vivo (edición colaborativa, cambia siempre)
└── roomVersion                                 ← inmutable, una fila por versión publicada
     └── v1.0.0: RoomPackage JSONB congelado + assets empaquetados en R2 (assets_hash)
```

- **Publicar** = congelar el JSON, validarlo en servidor, subir assets a R2 con hash, crear fila
  en `roomVersion`. Lo que juega la gente nunca cambia en caliente.
- **Semver automático (ADR-035):** el autor ya no elige el semver de la nueva versión —
  `classifyRoomPackageChange` (`packages/shared/src/services/room-version-diff.ts`) compara el
  `RoomPackage` candidato con el de la última versión publicada y clasifica el cambio:
  - **MAJOR**: se añade o elimina algún `puzzles[]` (por `id`).
  - **MINOR**: mismo conjunto de puzzles, pero alguno cambia de contenido, o una regla de
    `rules[]` añadida/eliminada/modificada referencia un `puzzleId` presente en ambas versiones.
  - **PATCH**: cualquier otra diferencia (`objects`, `map`, `items`, `dialogs`, `hints`,
    `meta.assetsManifest`, otros campos de `meta`, o una regla sin referencia a ningún puzzle).
  - **Sin ningún cambio:** no se permite publicar una versión idéntica a la anterior — `publish`
    responde `NOTHING_TO_PUBLISH` (409). La primera publicación de una sala es siempre `1.0.0`.
- Los jugadores con sala comprada reciben la nueva versión; los eventos ya vendidos pueden
  **fijar la versión original** (flag en `Event`/sesión).
- El runtime del jugador descarga `roomVersion` → JSON → mismo contrato que en el editor.

## 6. Versionado del formato (`packageFormat`)

- `meta.packageFormat` fija la versión del formato del `RoomPackage`, independiente del `semver`
  de la sala.
- **Regla de oro:** cualquier cambio del formato que rompa el JSON del Rey Aldric es un **cambio
  breaking** y exige bump de `packageFormat`.
- Valor fijado: `"roompackage/v1"`. `SUPPORTED_PACKAGE_FORMATS` (packages/shared) exige este
  literal exacto al publicar; sin salas publicadas en producción, el bump se hizo sin periodo de
  compatibilidad hacia atrás (ver `docs/reference/registro-de-decisiones.md`).

## 7. Relación con el editor y el MCP

- El **editor visual** escribe en el doc Yjs que se materializa como este JSON al publicar.
- El **MCP** produce y muta el mismo JSON a través de la misma API (ver `specs/10-mcp-del-creador.md`).
- El **validador** opera sobre este formato (ver `specs/22-qa-y-pruebas.md` §2).

## 8. Dependencias

- `reference/roompackage-rey-aldric.v1.json` — implementación completa y jugable del formato.
- `specs/05-motor-de-reglas-y-estado.md`, `06-plantillas-puzzle-mvp.md`, `07-plantillas-puzzle-v2.md`.
- `specs/09-editor-de-salas.md` — cómo se produce y publica.
