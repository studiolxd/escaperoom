# 09 — Editor de salas

Depende de `08-formato-roompackage.md` y `03-arquitectura-y-stack.md` (§3). El validador
compartido se detalla en `specs/22-qa-y-pruebas.md` §2; la API de edición, en `specs/13-api-rest.md` §4.

---

## 1. Decisión de arquitectura: el editor ES el runtime

**El editor no es un programa aparte del juego — es el propio runtime en "modo edición".**

```
Mismo Phaser, mismo código de render, mismos componentes React de puzzle.
La única diferencia: en edición hay herramientas (selección, arrastre, palette)
y los cambios se escriben en el documento Yjs en vez de leerse.
```

- **WYSIWYG absoluto:** lo que el creador ve es *exactamente* lo que el jugador jugará —
  mismas animaciones, luces y componentes de puzzle.
- **Los componentes de puzzle son los mismos:** `<MemoryPuzzle>` se monta en modo demo dentro
  del editor para configurarlo.
- **Un solo código que mantener:** desaparece el riesgo "en el editor se ve bien y en el juego
  falla".
- Consecuencia: el editor es una página de Next.js (`/editor/[roomId]`) que carga el runtime de
  Phaser con flag `mode: 'edit'`.

## 2. Modelo de datos de edición: Yjs

El documento de la sala **es un Yjs doc** — la fuente de verdad en memoria, con PostgreSQL como
persistencia:

```
Yjs Doc  ←──(updates binarios, incremental)──→  PostgreSQL (room_updates)
   │                                                   │
   ├── meta / mapa (tiles)                             └── snapshots (room_snapshots)
   ├── objetos                                              cada N updates (squash)
   ├── puzzles
   ├── rules
   └── Yjs Awareness (cursores, selección, quién edita qué)
```

- **Cada cambio** (pintar un tile, mover un objeto) es una transacción Yjs → update binario → se
  persiste. Sin "guardar" manual: **autosave continuo**.
- **Awareness** muestra cursores de colaboradores ("María está editando el puzzle del brasero").
- **Offline:** el creador puede trabajar sin conexión; al reconectar, Yjs mergea (CRDT, sin
  "último gana"). Un profe prepara la sala en el tren y sincroniza al llegar.
- **Historial:** como se guardan todos los updates, hay versionado gratis → "restaurar a como
  estaba ayer a las 18:00".

Persistencia y API:

```
GET  /api/rooms/:id/draft       → último snapshot + updates posteriores (bootstrap del editor)
POST /api/rooms/:id/update      → append de update binario (auth + permiso de edición)
GET  /api/rooms/:id/history     → lista de snapshots (restauración)
```

El canal de sincronización en vivo es un **WebSocket de edición** propio (análogo pero distinto
al de Colyseus), que persiste incrementalmente en `room_updates` (ver `specs/14-modelo-de-datos-sql.md` §5).

## 3. Flujo de creación (UX)

```
PASO 1 · ESCENARIO      PASO 2 · OBJETOS        PASO 3 · PUZZLES       PASO 4 · LÓGICA        PASO 5 · PROBAR Y PUBLICAR
┌───────────────┐      ┌───────────────┐      ┌───────────────┐      ┌───────────────┐      ┌──────────────────┐
│ Pintar tiles  │      │ Colocar       │      │ Insertar      │      │ Grafo de      │      │ Playtest en vivo │
│ con palette   │  →   │ puertas,      │  →   │ plantillas,   │  →   │ reglas (vista │  →   │ (botón "Jugar"   │
│ (brush, fill, │      │ cajones,      │      │ configurar    │      │ nodo): conec. │      │ sin salir del    │
│ borrador)     │      │ placas.       │      │ cada una      │      │ trigger→      │      │ editor)          │
│ Layers: suelo │      │ Renombrar IDs │      │ (mismo comp.  │      │ acción        │      │ Checklist auto:  │
│ /pared/decor. │      │               │      │ que en juego) │      │ arrastrando   │      │ solvable? dead   │
└───────────────┘      └───────────────┘      └───────────────┘      └───────────────┘      │ ends? → PUBLICAR │
                                                                                             └──────────────────┘
```

Detalles de UX:

- **IDs legibles por humanos:** al colocar el arca, el editor propone `id: "arca-trono"`
  (editable). Los textos de pistas referencian estos IDs — es lo que hace mantenible una sala grande.
- **Panel de propiedades contextual:** click en objeto → inspector a la derecha (posición,
  sprite, estado inicial, reglas que lo tocan).
- **Validador automático** que corre en cada cambio (ver §5).
- **Playtest:** botón que crea una room de Colyseus temporal con el borrador; se puede jugar sin
  publicar y compartir borrador con link de prueba (no aparece en el catálogo).

## 4. Componentes del editor

### 4.1 Las tres regiones

El editor es una sola página con tres regiones que comparten un único estado — el **doc de Yjs**,
no tres estados sincronizados a mano:

| Región | Responsabilidad | No hace |
|---|---|---|
| **Palette** | Catálogo arrastrable de objetos del tema activo y de plantillas de puzzle | No conoce el estado de la sala; es un catálogo estático + contador de "cuántos hay colocados" (derivado) |
| **Canvas / grafo** | Dos pestañas sobre el mismo espacio: **WYSIWYG** (runtime Phaser en `mode:'edit'`) y **grafo de reglas** (vista de nodos) | El canvas WYSIWYG nunca edita reglas; el grafo nunca pinta tiles — cada pestaña edita su porción del RoomPackage |
| **Inspector** | Panel de propiedades del elemento seleccionado (objeto, puzzle o regla) | Panel genérico dirigido por el tipo del elemento, no un componente por tipo |

### 4.2 Por qué React Flow para el grafo de reglas

- Los nodos son exactamente `trigger → conditions → actions`; React Flow modela nodos y aristas
  tipadas de forma nativa.
- El **validador incremental** necesita resaltar nodos con problemas (objeto huérfano, dead end);
  React Flow permite estilos por nodo dirigidos por datos.
- El **MCP edita el mismo grafo** que el editor visual: al ser datos (nodos/aristas en el doc Yjs),
  una mutación del MCP se refleja sin lógica de sincronización adicional.

### 4.3 Árbol de componentes (orientativo)

```
<EditorPage>                         (/editor/[roomId])
 ├── <EditorHeader>                  título, playtest, validate(), publish()
 ├── <EditorBody>
 │    ├── <Palette>
 │    │    ├── <ObjectPaletteItem>   × N (arrastrables)
 │    │    └── <PuzzleTemplateItem>  × N
 │    ├── <CanvasArea>
 │    │    ├── <WysiwygTab>          embebe <PhaserRuntime mode="edit">
 │    │    └── <RuleGraphTab>        React Flow: <RuleNode>, <TriggerEdge>
 │    └── <Inspector>
 │         ├── <ObjectInspector>
 │         ├── <PuzzleInspector>     — mismos componentes de puzzle que en juego
 │         └── <RuleInspector>
 └── <ValidationPanel>               resultados de validate()
```

**Nota:** `<EditorHeader>` y `<ValidationPanel>` son cabecera y pie, no regiones de contenido.

### 4.4 Estado compartido: Yjs doc + Zustand

- El doc de Yjs es la fuente de verdad (persiste en `room_updates`, se reconstruye de
  `room_snapshots`).
- Un **store de Zustand** conectado al doc de Yjs (mismo patrón que la partida con Colyseus) es lo
  que consumen los componentes React: ni Palette, ni Canvas, ni Inspector tocan la API de Yjs
  directamente.
- Los cambios del **MCP** llegan por el mismo canal (el agente es un colaborador más); el store
  no distingue si una mutación vino de un clic humano o de una tool call.

## 5. Validador automático

Corre de forma continua (y en `POST /api/rooms/:roomId/validate`, y en `publish()` server-side):

- 🔴 **Objetos/puzzles huérfanos:** "El puzzle `candado-arca` requiere `llave-bronce`, pero
  ninguna regla lo otorga."
- 🔴 **Dead ends:** "La puerta `salida-bodega` no se abre nunca."
- 🟡 **Puzzles sin pista asociada:** "Ninguna pista referencia el código del candado."
- 🟡 **Ítems con `consumeInputs: true` usados en más de una receta** (posible soft-lock).
- 🟡 **Dificultad declarada vs. estimación** (nº de puzzles, profundidad del grafo).
- 🟡 **Assets referenciados que no existen en el manifest.**
- 🟢 **Estimación de ruta de solución y duración** (simulador simple de ruta crítica).

**El mismo validador corrige al editor humano y al agente MCP.** El algoritmo formal de
solvabilidad está en `specs/22-qa-y-pruebas.md` §2.

## 6. Draft vs. publicado

- `room_drafts` / `room_updates` / `room_snapshots`: doc Yjs vivo, mutable, colaborativo.
- `room_versions`: inmutable, una fila por versión publicada; assets empaquetados en R2 con hash.
  Los parches crean versiones nuevas; los eventos vendidos pueden fijar versión.
- Publicar = congelar JSON + validar + subir assets + crear `room_versions` (ver
  `specs/08-formato-roompackage.md` §5 y `specs/13-api-rest.md` §4).

## 7. Checklist del editor: MVP vs. v2

| | MVP | v2 |
|---|---|---|
| Tiles y mapa | ✅ Brush + fill + layers | Plantillas de salas, autotiling |
| Objetos | ✅ Colocar + estados | Animaciones custom, scripts visuales |
| Puzzles | ✅ 8 plantillas | Plantillas v2 (15) + plugin system |
| Reglas | ✅ Trigger/condición/acción fijo | Condiciones anidadas (AND/OR), variables |
| Colaboración | ✅ Yjs en tiempo real + offline | Comentarios en el mapa (tipo Figma) |
| Assets | Tileset temático incluido (medieval) | Subida de assets propios |
| Playtest | ✅ Solo + link de prueba | Playtest con amigos (room temporal) |
| Validador | ✅ Reglas básicas + dead ends | Simulador de solvabilidad completo |

## 8. Dependencias

- `specs/10-mcp-del-creador.md` — paridad editor/MCP.
- `specs/22-qa-y-pruebas.md` — validador y test de solvabilidad.
- `specs/13-api-rest.md` §4 — endpoints de gestión/publicación.
