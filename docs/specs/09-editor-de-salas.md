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
al de Colyseus), que persiste incrementalmente en `roomUpdate` (ver `specs/14-modelo-de-datos-sql.md` §5).

**Implementación (ticket 3.3):**

- **Dónde vive:** proceso propio `pnpm dev:editor-sync` (puerto `EDITOR_SYNC_PORT`, 2568 por
  defecto), con punto de entrada en `packages/web/src/server/editor-sync/`. Los route handlers de
  Next no admiten `upgrade` de WebSocket y Colyseus es otro dominio (partida); vivir en `web`
  permite reutilizar tal cual la sesión de Better Auth y el `RoomDraftService` de las rutas REST.
  El núcleo (`createEditorSyncServer`) está en `@escaperoom/editor/sync-server` y es agnóstico
  del proceso: se engancha al `upgrade` de cualquier `http.Server`.
- **Protocolo:** `ws(s)://…/rooms/:roomId`, trama de y-websocket con `y-protocols` (sync step
  1/2 + update, awareness, query-awareness) más un mensaje propio de restauración (`4`).
- **Auth:** en el handshake HTTP, con la misma resolución de actor que REST (cookie de sesión o
  `Authorization: Bearer`) y el mismo permiso (`checkAccess`: hoy, solo el autor). Rechazo con
  401/403/404 antes de abrir el socket; `Origin` limitado a `EDITOR_SYNC_ALLOWED_ORIGINS`.
- **Persistencia:** cada update integrado en el doc vivo se persiste en orden con
  `appendUpdate` (autoría = usuario de la conexión). Si falla, la sala se descarta y los clientes
  reconectan; su sync step 2 reenvía lo no persistido. Al irse el último editor se compacta.
- **Awareness:** se retransmite y nunca se persiste; se limpia al cerrar la conexión.
- **Restaurar:** `restoreDraft`/`planRestore` reconstruyen el doc en el punto elegido
  (snapshot o `roomUpdate.id`) y generan un update nuevo que deshace lo posterior; la historia no
  se reescribe y la restauración es a su vez restaurable.
- **Cliente:** `EditorSyncProvider` (`@escaperoom/editor`), headless: autosave, offline con
  merge CRDT al reconectar, reconexión con backoff y `restore()`.

**Sincronización entre procesos (ADR-029).** El MCP (stdio o HTTP) y
`POST /api/rooms/:id/update` escriben el draft con `RoomDraftService.appendUpdate` directamente,
sin pasar por `editor-sync`; lo mismo pasaría entre dos instancias de `editor-sync` si se escala.
Para que un editor con WebSocket abierto vea esos cambios EN VIVO (sin recargar):

- `RoomDraftService` publica cada update aplicado (`appendUpdate`/`restoreDraft`) en un canal
  Redis pub/sub — `@escaperoom/kit/room-sync`, el mismo patrón y la misma conexión que
  `@escaperoom/kit/events` — con el `roomId`, el update Yjs y el id del proceso que lo produjo.
- Cada proceso `editor-sync` se suscribe a ese canal. Si la sala del evento está cargada en su
  memoria, aplica el update al doc vivo (se reenvía a sus clientes por WebSocket igual que uno
  propio) SIN volver a persistirlo ni a republicarlo — evita el bucle de reenvío.
- **Sin `REDIS_URL` (o con Redis caído): degradación, no rotura.** El draft se sigue
  persistiendo con normalidad (`publish` falla en silencio) y cada `editor-sync` sigue sirviendo a
  sus propios clientes conectados; lo único que se pierde es la propagación EN VIVO entre
  procesos — un cambio hecho en el MCP o en otra instancia se ve al recargar, como antes de esto.

Detalle de diseño (canal, formato del mensaje, por qué no hay ack) en ADR-029
(`docs/reference/registro-de-decisiones.md`).

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

- El doc de Yjs es la fuente de verdad (persiste en `roomUpdate`, se reconstruye de
  `roomSnapshot`).
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

- `room_drafts` / `roomUpdate` / `roomSnapshot`: doc Yjs vivo, mutable, colaborativo.
- `roomVersion`: inmutable, una fila por versión publicada; assets empaquetados en R2 con hash.
  Los parches crean versiones nuevas; los eventos vendidos pueden fijar versión.
- Publicar = congelar JSON + validar + subir assets + crear `roomVersion` (ver
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

## 8. Lobby e introducción

Encargo lobby-diseño (specs/04 §7, specs/08 §2.1, specs/11 §4.1). Botón **«Lobby e
introducción»** de la cabecera del editor (`room-lobby-intro-dialog.tsx`); todo escribe con los
comandos de `room-doc/lobby-intro.ts`, los mismos que usa el MCP (`define_subrooms` con `kind`,
`set_room_intro`).

**Sala de espera (lobby).** Es una habitación más del mapa con `kind: "lobby"` (en el doc Yjs,
la clave `kind` de su entrada en `subrooms`):

- **Diseñado:** el creador la crea con su tamaño (`addLobbyRoom`: suelo y muros de la habitación
  inicial, muros arriba e izquierda, luz ambiente y un punto de aparición por jugador) o marca una
  habitación existente (`setSubRoomKind`). Aparece en la navegación de habitaciones con la marca
  «lobby» y se pinta (suelo/muros) y decora con los assets del pack en el propio lienzo, como
  cualquier otra. Solo decoración: el validador (`checkLobbyRoom`) rechaza pruebas, puertas
  (`leadsTo` desde o hacia ella), objetos que den ítems y reglas que la usen, con mensajes
  accionables. Como mucho una (los comandos rechazan la segunda con `LOBBY_CONFLICT`) y nunca la
  única habitación. «Quitar tipo lobby» la devuelve a habitación normal.
- **Por defecto:** sin lobby diseñado (todas las salas anteriores, Rey Aldric incluido) la
  partida usa el generado por `withLobbyRoom`/`buildDefaultLobbyRoom`; no se guarda en la sala.
- **Previsualización:** «Previsualizar lobby» pinta con el runtime de la previsualización
  (`toRuntimeModel(withLobbyRoom(sala))`) el lobby diseñado o el generado.

**Introducción** (`meta.intro`, en el doc `meta.intro: Y.Map`): ninguna, **texto** multiidioma
(un `YLocalizedText` como el de diálogos, editado con el campo localizado del editor; hasta
`MAX_INTRO_TEXT_LENGTH` caracteres por idioma) o **vídeo** mp4/webm (≤ 200 MB) con subtítulos
WebVTT opcionales por idioma declarado (≤ 512 KB; `subtitles: Y.Map<idioma, ref>`, un idioma no
pisa a otro). El vídeo se sube directo al bucket con PUT presignado y barra de progreso
(`POST /api/rooms/:roomId/intro-media/video` → PUT → `…/video/:assetId/complete` → `{ref}`); los
subtítulos con `POST …/intro-media/subtitles?lang=xx`; la vista previa usa `<video>` nativo sin
autoplay con un `<track>` por idioma (URLs firmadas de `GET …/intro-media/url?ref=`). Cambiar de
tipo sustituye la introducción entera. Como los demás textos, lo de un idioma retirado se queda en
el borrador pero no se empaqueta. En el modo local (sin servidor) la subida está deshabilitada.

## 9. Dependencias

- `specs/10-mcp-del-creador.md` — paridad editor/MCP.
- `specs/22-qa-y-pruebas.md` — validador y test de solvabilidad.
- `specs/13-api-rest.md` §4 — endpoints de gestión/publicación.
