# Wireframes y arquitectura de componentes del editor

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§6, §10) y `esquema-sql-migraciones-v1.0.md` (§5, `room_updates`/`room_snapshots`).

El diagrama estructural mostrado arriba fija la descomposición de más alto nivel del editor; este documento detalla qué vive dentro de cada región y resuelve la pregunta que quedó abierta desde la conversación original de diseño (*"vista nodo del grafo de reglas, ¿usamos React Flow?"*).

---

## 1. Las tres regiones y su responsabilidad

El editor es una sola página (`especificaciones-escape-room-creator-v1.0.md` §10.1, `/editor/[roomId]`) con tres regiones que comparten un único estado — el **doc de Yjs**, no tres estados sincronizados a mano:

| Región | Responsabilidad | No hace |
|---|---|---|
| **Palette** | Catálogo arrastrable de objetos del tema activo y de las plantillas de puzzle (`plantillas-puzzle-v2-especificacion.md`) | No conoce el estado de la sala — es un catálogo estático más un contador de "cuántos de este objeto ya hay colocados" (derivado, no propio) |
| **Canvas / grafo** | Dos pestañas sobre el mismo espacio: **WYSIWYG** (el propio runtime de Phaser en `mode: 'edit'`, §6 de especificaciones) y **grafo de reglas** (vista de nodos) | El canvas WYSIWYG nunca edita reglas directamente y el grafo nunca pinta tiles — cada pestaña edita su propia porción del RoomPackage, ambas contra el mismo doc de Yjs |
| **Inspector** | Panel de propiedades del elemento seleccionado (objeto, puzzle, regla — el que esté activo en cualquiera de las dos pestañas del canvas) | Es un panel genérico dirigido por el tipo del elemento seleccionado, no un componente distinto por cada tipo de objeto |

## 2. Por qué React Flow para el grafo de reglas

Se confirma la opción que ya se apuntaba como pregunta abierta: **React Flow**. Encaja mejor que dibujar el grafo a mano por tres razones concretas al vocabulario de reglas ya fijado (`especificaciones-escape-room-creator-v1.0.md` §9):

- Los nodos del grafo son exactamente `trigger → conditions → actions` — React Flow modela nodos y aristas tipadas de forma nativa, sin reinventar layout ni hit-testing de conexiones.
- El **validador incremental** (§10.3 de especificaciones, y el algoritmo formal de `plan-pruebas-qa-v1.0.md` §2) necesita resaltar nodos con problemas (objeto huérfano, dead end) — React Flow permite estilos por nodo dirigidos por datos, así que el resultado del validador se pinta directamente sobre el grafo sin una capa de renderizado paralela.
- El **MCP edita el mismo grafo** que el editor visual (`especificaciones-escape-room-creator-v1.0.md` §11) — al ser datos (nodos/aristas en el doc de Yjs) y no una estructura ad-hoc del lienzo, una mutación del MCP se refleja en el grafo visual sin lógica de sincronización adicional.

## 3. Árbol de componentes React (orientativo)

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
 │         │                            (`<CodeLockPuzzle>`, `<SlidingPuzzle>`...,
 │         │                            especificaciones §8)
 │         └── <RuleInspector>
 └── <ValidationPanel>               resultados de validate() (§10.3 / plan-pruebas §2)
```

**Nota:** `<EditorHeader>` y `<ValidationPanel>` no aparecen en el diagrama estructural (quedan fuera por el límite de regiones que mantiene el diagrama legible) — son cabecera y pie de la página, no regiones de contenido del mismo nivel que Palette/Canvas/Inspector.

## 4. Estado compartido: Yjs doc + Zustand

Ya establecido en especificaciones (§6, §10.1), aquí se detalla cómo lo consumen los tres componentes:

- El **doc de Yjs** es la fuente de verdad — persiste incrementalmente en `room_updates` y se reconstruye desde `room_snapshots` al abrir el editor (`esquema-sql-migraciones-v1.0.md` §5).
- Un **store de Zustand** conectado al doc de Yjs (mismo patrón que la partida en vivo usa para Colyseus, especificaciones §6) es lo que realmente consumen los componentes React — ni Palette, ni Canvas, ni Inspector tocan la API de Yjs directamente, todos leen del store.
- Cambios del **MCP** llegan por el mismo canal (el agente es un colaborador más del doc de Yjs, especificaciones §11) — el store no distingue si una mutación vino de un clic humano o de una tool call del MCP, y por eso ningún componente necesita lógica especial para uno u otro caso.

## 5. Relación con el playtest y la publicación

`<EditorHeader>` dispara `validate()` y `publish()` (`api-rest-backend-v1.0.md` §4) y el modo *"jugar como jugador"* (especificaciones §10.2, punto 5): este último no es un componente nuevo, es el mismo `<PhaserRuntime>` del `<WysiwygTab>` montado en `mode: 'play'` contra una room temporal de Colyseus — la reutilización de componentes entre editar y jugar (ya fijada como principio en especificaciones §8) se extiende también al playtest, no solo a los puzzles.
