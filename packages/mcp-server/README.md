# MCP del creador (`@escaperoom/mcp-server`)

Servidor MCP con el que un agente IA (Claude Desktop, el chat web de 4.6) construye y edita salas
en borrador (`docs/specs/10-mcp-del-creador.md`). Sus tools **no tienen lógica propia**: llaman a los
mismos servicios de dominio de `@escaperoom/shared/services` que el tRPC del editor y la REST, con
un `actor` como única diferencia (ADR-010/022).

## Toolset (tickets 4.1–4.4)

El toolset completo de specs/10 §2 está registrado con su nombre, descripción, anotaciones y
esquema de entrada (Zod de `@escaperoom/shared/schemas` → JSON Schema). Todas las tools que operan
sobre un draft reciben `roomId` (el mismo `:roomId` de `/api/rooms/:roomId/draft`).

| Fase | Tool | Estado |
| --- | --- | --- |
| A — Estructura | `create_room`, `set_map`, `paint_tiles`, `define_subrooms` | **implementadas** (4.2) |
| B — Contenido | `add_object`, `define_item`, `add_puzzle`, `add_dialog`, `add_hint` | **implementadas** (4.2) |
| C — Lógica | `add_rule`, `get_room_graph` | **implementadas** (4.3) |
| D — Verificación | `validate` | **implementada** (validador de 2.9) |
| D — Verificación | `preview`, `publish` | esqueleto (4.5) |
| E — Consulta | `get_room` | **implementada** (draft de 3.2) |
| E — Consulta | `get_template_catalog` | **implementada** (4.2), pública |
| E — Consulta | `get_puzzle`, `get_rules_for` | **implementadas** (4.3), vistas filtradas |
| — | `get_featured_room` | ejemplo de 0.10 (paridad tRPC/REST/MCP), pública |

Una tool del esqueleto responde con `isError: true`, el texto
`❌ <tool>: no implementado todavía (ticket 4.x)…` y `structuredContent.error.code = "NOT_IMPLEMENTED"`.
El resto de errores usan los mismos códigos (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`INVALID_DRAFT`, `INVALID_INPUT`, `VALIDATION_FAILED`, `NOT_AVAILABLE`, `INTERNAL`); los de una
referencia inexistente llevan además `reason` y los ids `available` (specs/10 §3).

`get_room`/`validate` leen el draft con `RoomDraftService.loadDraft` (misma autorización que el
editor: solo el autor) y lo convierten a `RoomPackage` con `roomDocToPackage`, la conversión doc
Yjs → RoomPackage del ticket 3.1, **inyectada**. Mientras no se cablee, responden `NOT_AVAILABLE`.

## Escritura en el draft (ticket 4.2)

Cada tool que muta (`src/draft-writer.ts`, `mutateDraft`) pasa por el mismo pipeline (specs/10 §3,
ticket 4.4):

1. valida la entrada con los esquemas Zod de `@escaperoom/shared/schemas` (lo hace el SDK antes de
   llamar a la tool; un error sale como `Input validation error: …`);
2. **dry-run:** reconstruye el doc Yjs del draft con `RoomDraftService.loadDraft` (autorización:
   solo el autor) —una copia en memoria; el doc real es el del canal del editor— y aplica **una
   transacción** con los comandos de la sala de `@escaperoom/editor/room-doc`, los mismos del editor
   (`paintTiles`, `addObject`, `defineSubRooms`, `addPuzzle`…). Si no cambia nada, termina aquí;
3. **validador incremental** (`src/mutation-validation.ts`): serializa el doc resultante **una vez**
   (`roomDocToPackage` → esquema → `validateRoomPackage`) y lo compara con la foto de antes
   (`compareValidationReports` de `@escaperoom/shared/validator`);
4. si la mutación **introduce** ❌ nuevos, no escribe y devuelve `VALIDATION_FAILED` con un mensaje
   accionable: qué hallazgos nuevos hay, qué hacer y el informe resumido (y en `structuredContent`
   `introducedErrors`, `lostSolvability`, `preexistingErrors` y los checks). Si solo introduce 🟡,
   escribe y los devuelve como avisos;
5. pasa por `deps.beforeCommit` (enganche extra opcional) y confirma el update de la transacción.

**`dryRun: true`** (todas las tools de mutación, incluida `create_room`): recorre el pipeline entero
y devuelve el mismo resultado —`🧪 <tool> (dry-run) — …` con el veredicto, o el mismo error
`VALIDATION_FAILED` marcado `(dry-run)`— sin escribir nada.

### Criterio "¿empeora el draft?" (4.4)

Un draft a medio construir tiene errores (sin regla de victoria no es solvable). **Los errores que el
draft ya tenía no bloquean** una mutación que no los empeora:

| Antes → después | Veredicto |
| --- | --- |
| RoomPackage → RoomPackage | Se rechaza si aparecen ❌ **nuevos**. Cada hallazgo tiene la huella `check\|code\|ids` (sin el texto, que cita listas de disponibles) y se comparan como multiconjunto. La no-solvabilidad solo es nueva si un tamaño de grupo que **era** solvable deja de serlo. |
| RoomPackage → fuera del esquema | Se rechaza. |
| Fuera del esquema → fuera del esquema | Se rechaza solo si aparecen problemas de esquema nuevos (ruta con el id de la entidad en vez del índice + mensaje). |
| Fuera del esquema → RoomPackage | Se acepta: sin informe previo no se pueden atribuir los ❌, que se devuelven como pendientes. |
| Sin `roomDocToPackage` inyectado | No se valida. |

Una respuesta de éxito lleva `structuredContent.validation` (`status`, `ok`, `newWarnings`,
`pendingErrors`, `resolvedErrors`, `schemaProblems`) y el texto añade los avisos nuevos, los errores
resueltos y los pendientes. Consecuencia práctica para el agente: **se construye de la fuente al
sumidero** — primero el puzzle que abre una puerta y después la puerta con su `lockedBy`.

**Rendimiento.** La foto "después" de cada commit se guarda en una caché LRU
(`DraftSnapshotCache`, por defecto una por proceso; clave = hash del estado Yjs completo) y es la
foto "antes" de la siguiente mutación sobre la sala: una construcción paso a paso serializa y valida
una sola vez por llamada. Solo si falla la caché (primera mutación, o el draft cambió por otra vía)
se reconstruye aparte el doc de antes para fotografiarlo.

Los errores de los comandos se traducen a mensajes accionables: `No existe la habitación "bodega".
Habitaciones disponibles: [laboratorio, cripta]`, `Ya existe el id "x". Usa otro id o replace: true…`,
celdas fuera de la rejilla, idiomas no declarados en la sala… Las tools de alta aceptan
`replace: true` para sustituir una entrada (el agente puede corregir lo que ya creó).

**Editores conectados.** El update se entrega por el puerto `deps.liveSync`
(`EditorSyncServer.applyUpdate`, 3.3) cuando el servidor del WebSocket de edición vive en el mismo
proceso: se integra en el doc vivo, los editores lo ven al instante y se persiste por la misma cola
que sus updates. Sin `liveSync` (stdio y la ruta de Next, que hoy corren en otro proceso que el
WebSocket) se persiste con `RoomDraftService.appendUpdate`, como `POST /api/rooms/:roomId/update`: un
editor con la sala abierta lo recibe al reconectar (los updates Yjs conmutan; no se pierde nada).

**Modelo del mapa.** En el RoomPackage cada habitación interna tiene su rejilla y sus capas, y las
coordenadas de objetos y tiles son locales a ella. `define_subrooms` crea/redimensiona habitaciones
(`bounds.w × bounds.h`; `bounds.x/y` no se guardan) y `set_map` fija el tileset y, opcionalmente,
tamaño y capas (RLE) de las habitaciones indicadas (por defecto, todas las definidas).

`create_room` da de alta la sala con `RoomDraftService.createDraft` (fila `room` en `draft` del
creador + update inicial con la metadata).

## Lógica y consulta (ticket 4.3)

- **`add_rule({ roomId, rule, replace? })`** — escribe en el mapa `rules` del doc con el MISMO
  modelo que el grafo de reglas del editor (3.6, `setRule` de `rules-graph/yjs-rules.ts`), vía el
  comando `addRule` de `@escaperoom/editor/room-doc`. `id`, `priority` (0) y `once` (`true`) son
  opcionales: sin `id` se propone uno legible a partir del trigger (`r-brasero`,
  `r-candado-arca-resuelto`). Antes de escribir comprueba que existen las habitaciones, objetos,
  puzzles, items y diálogos referenciados (`ruleReferences` del validador, la misma lista que su
  check de referencias): `No existe el objeto "salida-bodega" (en actions[0].objectId). Objetos
  disponibles: [...]`.
- **`get_room_graph({ roomId })`** — grafo compacto (`src/room-graph.ts`): habitaciones, items,
  objetos (estados, `lockedBy`, `leadsTo`), puzzles (`requires`, `unlocks`, `grants`, recetas),
  reglas como `when`/`if`/`then` (una línea por pieza) y aristas `[origen, relación, destino]`
  (`requiere`, `desbloquea`, `otorga`, `lleva_a`, `dispara`, `condiciona`, `afecta`). Sin tiles,
  sprites ni textos: una fracción de `get_room`.
- **`get_puzzle({ roomId, puzzleId })`** — el puzzle, sus pistas y las reglas que lo referencian.
- **`get_rules_for({ roomId, objectId })`** — reglas que disparan con el objeto, lo usan en una
  condición o actúan sobre él: la consulta «reglas que lo tocan» del inspector (3.4,
  `findRulesTouching`), la misma que ve el creador en el editor.

Las consultas leen el doc del draft (`readDraftDoc`, misma autorización) con la serialización de
3.1 y no exigen que el draft sea ya un RoomPackage completo; un id inexistente lista los
disponibles.

## Estructura

```
src/
├── server.ts             createCreatorMcpServer(deps): registra el toolset y la política común
├── tools/                un módulo por tool (esquema Zod + handler); index.ts = CREATOR_TOOLSET
├── room-draft-reader.ts  draft (3.2) → doc Yjs (readDraftDoc) → RoomPackage validado
├── room-graph.ts         buildRoomGraph: grafo compacto de get_room_graph (4.3)
├── draft-writer.ts       mutateDraft: pipeline de mutación (dry-run → validador → commit por liveSync)
├── mutation-validation.ts  fotos del draft, caché y veredicto del validador incremental (4.4)
├── auth.ts               identidad: actorFromEnv (stdio), HttpAuthenticator (HTTP, enganche de 4.7)
├── transports/stdio.ts   runStdioServer(deps)
├── transports/http.ts    handleCreatorMcpRequest (Next /mcp/creator) y startHttpServer (Node)
└── bin/stdio.ts          punto de entrada stdio para Claude Desktop (servicios sobre Postgres)
```

## Identidad y auth

El OAuth 2.1 (`@slxd/mcp-auth` sobre Better Auth) llega en **4.7**. Hasta entonces:

- **stdio (desarrollo):** la identidad sale del entorno. Sin ella el servidor arranca, avisa por
  stderr y cada tool del creador responde `UNAUTHORIZED`.

  | Variable | Uso |
  | --- | --- |
  | `ESCAPEROOM_MCP_USER_ID` | Id del usuario (Better Auth) con el que actúa el agente. **Obligatoria.** |
  | `ESCAPEROOM_MCP_ORGANIZATION_ID` | Organización activa (opcional). |
  | `DATABASE_URL` | Postgres de la app (el mismo que `packages/web`). |

- **HTTP (`/mcp/creator` en `packages/web`):** la sesión de Better Auth de la petición. Sin sesión,
  401 con `WWW-Authenticate: Bearer`, antes de tocar el protocolo. En 4.7 el `authenticate` de
  `handleCreatorMcpRequest` validará el Bearer de OAuth y devolverá el mismo `Actor`.

## Conectar desde Claude Desktop

Requisitos: `pnpm install` en la raíz, `pnpm --filter @escaperoom/shared db:generate` (cliente
Prisma) y la base de datos de desarrollo en marcha (`scripts/dev-env.sh`).

Añade el servidor a `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`), con rutas absolutas a tu clon:

```json
{
  "mcpServers": {
    "escaperoom-creator": {
      "command": "/ruta/a/escaperoom/packages/mcp-server/node_modules/.bin/tsx",
      "args": ["/ruta/a/escaperoom/packages/mcp-server/src/bin/stdio.ts"],
      "env": {
        "ESCAPEROOM_MCP_USER_ID": "<id de tu usuario en la app>",
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/escaperoom"
      }
    }
  }
}
```

Reinicia Claude Desktop: el conector `escaperoom-creator` lista el toolset. Para probarlo sin Claude
Desktop, usa el MCP Inspector con el mismo comando y entorno
(`npx @modelcontextprotocol/inspector <command> <args>`). stdout es el canal del protocolo (los logs
van a stderr): lanza `tsx` directamente, no a través de `pnpm run`, que escribe su cabecera en stdout.

## Tests

`pnpm --filter @escaperoom/mcp-server test`: el mismo contrato (toolset completo con esquemas,
`get_room`/`validate` sobre un draft de test, error de no implementado) se comprueba con un cliente
MCP del SDK en memoria, por **stdio** (proceso hijo, como Claude Desktop) y por **HTTP** (puerto
libre), más los casos de auth (sin identidad → `UNAUTHORIZED` / 401). Los drafts de test usan un
sustituto de la conversión de 3.1 que guarda el RoomPackage como JSON en el doc Yjs.

`test/content-toolset.test.ts` (4.2) construye con el toolset una sala pequeña de 2 habitaciones
(`test/fixtures/small-room.ts`) desde un cliente MCP del SDK —en memoria y por HTTP— y comprueba que
`roomDocToPackage` del draft resultante es un `RoomPackage` válido por esquema; además, los errores
legibles, que un creador no toca el draft de otro, el enganche previo al commit y que un editor
conectado al WebSocket de edición (3.3) ve la mutación al instante.

`test/logic-toolset.test.ts` (4.3) siembra el Rey Aldric con `roomPackageToDoc`: el agente obtiene
el grafo, añade una regla que aparece en `get_rules_for`, `get_room` y `roomDocToPackage`, y se
comprueban los errores accionables (objeto, item, diálogo, puzzle o habitación inexistentes; ids
repetidos) y que las vistas filtradas ocupan menos que `get_room`.
