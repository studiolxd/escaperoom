# MCP del creador (`@escaperoom/mcp-server`)

Servidor MCP con el que un agente IA (Claude Desktop, el chat web de 4.6) construye y edita salas
en borrador (`docs/specs/10-mcp-del-creador.md`). Sus tools **no tienen lógica propia**: llaman a los
mismos servicios de dominio de `@escaperoom/shared/services` que el tRPC del editor y la REST, con
un `actor` como única diferencia (ADR-010/022).

## Toolset (tickets 4.1–4.5)

El toolset completo de specs/10 §2 está registrado con su nombre, descripción, anotaciones y
esquema de entrada (Zod de `@escaperoom/shared/schemas` → JSON Schema). Todas las tools que operan
sobre un draft reciben `roomId` (el mismo `:roomId` de `/api/rooms/:roomId/draft`).

| Fase | Tool | Estado |
| --- | --- | --- |
| A — Estructura | `create_room`, `set_map`, `paint_tiles`, `define_subrooms` | **implementadas** (4.2) |
| B — Contenido | `add_object`, `define_item`, `add_puzzle`, `add_dialog`, `add_hint` | **implementadas** (4.2) |
| B — Contenido | `decorate_subroom` | **implementada** (paridad de 4.8): decoración e iluminación por habitación |
| C — Lógica | `add_rule`, `get_room_graph` | **implementadas** (4.3) |
| D — Verificación | `validate` | **implementada** (validador de 2.9; checklist de publicación en 4.5) |
| D — Verificación | `preview`, `publish` | **implementadas** (4.5): playtest de 3.8 y publicación con confirmación humana |
| E — Consulta | `get_room` | **implementada** (draft de 3.2) |
| E — Consulta | `get_template_catalog` | **implementada** (4.2), pública |
| E — Consulta | `get_puzzle`, `get_rules_for` | **implementadas** (4.3), vistas filtradas |
| — | `get_featured_room` | ejemplo de 0.10 (paridad tRPC/REST/MCP), pública |

Con 4.5 todo el toolset está implementado; una tool sin `run` respondería con `isError: true`, el
texto `❌ <tool>: no implementado todavía (ticket 4.x)…` y `structuredContent.error.code =
"NOT_IMPLEMENTED"`. Los errores usan los mismos códigos (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`INVALID_DRAFT`, `INVALID_INPUT`, `VALIDATION_FAILED`, `NOT_PUBLISHABLE`, `RESPONSE_TOO_LARGE`,
`NOT_AVAILABLE`, `INTERNAL`); los de una referencia inexistente llevan además `reason` y los ids `available` (specs/10 §3).

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

**Decoración e iluminación.** `decorate_subroom({ subroomId, decorations?, lighting? })` fija
`SubRoom.decorations` (sprites sin interacción en celdas de la habitación) y `SubRoom.lighting`
(antorchas `{type: 'torch', x, y, objectId?}` y luz ambiente `{type: 'ambient', color: '#rrggbb',
intensity: 0–1}`) con los mismos comandos de `room-doc` que las herramientas «Decorar»/«Antorcha» y
el panel de la habitación del editor (`setDecorations`, `setLighting` de `room-doc/decor.ts`). Es
declarativa: cada lista enviada sustituye a la actual en ese orden (el formato no da id a estas
entradas, así que el agente no razona con índices) y la omitida no se toca. Va en la fase B y no en
`define_subrooms` porque una antorcha gobernada por un objeto necesita que el objeto exista.

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

## Verificación y publicación (ticket 4.5)

- **`validate({ roomId, playerCounts? })`** — la **checklist obligatoria de publicación**
  (`src/publish-checklist.ts`) y debajo el informe completo del validador de 2.9:

  ```
  📋 Checklist de publicación — 0 errores · 2 avisos
  ✅ Publicable: llama a publish({ roomId: "…", versionNotes }) para pedir la confirmación del creador.
  Estimación: ~52 min (rango 42–62).
  Avisos (no bloquean; revísalos con el creador):
    🟡 …
  ```

  En `structuredContent`: `ok`, `publishable`, `errors` (`check`, `code`, `message`, `ids`),
  `warnings` (`check`, `summary`, `issues`), `estimate` y los `checks`.
- **`preview({ roomId })`** — el MISMO playtest de 3.8 que el botón «Jugar» del editor: serializa el
  draft (solo el autor), lo congela en una room temporal de Colyseus con el `PlaytestLauncher` de
  web (puerto `deps.playtests`) y devuelve la URL del link de prueba
  (`{appUrl}/{idioma de la sala}/playtest/{token}`), su caducidad y el `playtestId`.
- **`publish({ roomId, versionNotes })`** — **no publica**. Publicar es irreversible (specs/10 §5):
  1. comprueba lo mismo que la publicación de 3.9 sin escribir nada (`checkPublishable`: autor,
     `packageFormat`, validador — ❌ ⇒ `VALIDATION_FAILED` con la checklist —, audios moderados);
  2. crea una **solicitud pendiente**: un token firmado y devuelve el enlace
     `{appUrl}/{idioma}/publish-confirm?token=…` con `status: "pending_confirmation"`,
     `published: false`, la versión que se creará y los avisos;
  3. el creador abre el enlace **con su sesión** en la web, revisa sala, versión, notas y avisos, y
     pulsa «Publicar ahora» (`POST /api/publish-confirm`). Solo entonces se llama a `publish` de 3.9
     y se crea la `roomVersion`.

### Mecanismo de confirmación

`@escaperoom/shared/services` → `publish-confirmation.ts`. Token **sin estado** (HMAC-SHA256 con
`PUBLISH_CONFIRM_SECRET`, como el `joinToken` de 5.8), sin tabla ni migración. Liga:

| Claim | Garantía |
| --- | --- |
| `rid`, `sub` | Sala y autor que la pidió: solo esa cuenta, con sesión, puede confirmar (`FORBIDDEN` / `UNAUTHORIZED`). |
| `ph` = `computePackageHash(RoomPackage)` | SHA-256 del JSON canónico del draft validado. Si el draft cambia tras pedirla, `publish` de 3.9 falla con `DRAFT_CHANGED` (409): se publica exactamente lo aprobado. |
| `base` = última versión publicada | Se comprueba **dentro del lock de la sala**: tras la primera publicación (o si se publica desde el editor) el token falla con `VERSION_CHANGED`. **Un solo uso**, también con dos confirmaciones simultáneas. |
| `notes`, `exp` | Notas de versión (≤ 1000 caracteres) y caducidad (`PUBLISH_CONFIRM_TTL_SECONDS`, 30 min por defecto, máx. 24 h): `EXPIRED`. |

La publicación de 3.9 solo gana, de forma aditiva, `checkPublishable` y un `guard` opcional
(`{ packageHash, latestSemver }`) en `publish`; sin guard se comporta igual que antes. La web usa la
cookie de sesión (`SameSite=Lax`) y además rechaza `Sec-Fetch-Site` distinto de `same-origin`.

Configuración: `PUBLISH_CONFIRM_SECRET` (mismo valor en web y en el MCP por stdio; en desarrollo hay
uno fijo; en producción sin él `publish` responde `NOT_AVAILABLE`) y el origen de la web para los
enlaces (`siteUrl()` en la ruta de Next; `ESCAPEROOM_APP_URL` por stdio, por defecto
`http://localhost:3000`). Por stdio `preview` responde `NOT_AVAILABLE` (el lanzador del playtest
vive en web): el creador usa «Jugar» en el editor.

## Estructura

```
src/
├── server.ts             createCreatorMcpServer(deps): registra el toolset y la política común
├── tools/                un módulo por tool (esquema Zod + handler); index.ts = CREATOR_TOOLSET
├── room-draft-reader.ts  draft (3.2) → doc Yjs (readDraftDoc) → RoomPackage validado
├── room-graph.ts         buildRoomGraph: grafo compacto de get_room_graph (4.3)
├── draft-writer.ts       mutateDraft: pipeline de mutación (dry-run → validador → commit por liveSync)
├── mutation-validation.ts  fotos del draft, caché y veredicto del validador incremental (4.4)
├── publish-checklist.ts  checklist de publicación de validate/publish (4.5)
├── links.ts              enlaces a la web (preview, confirmación) y puerto del playtest (4.5)
├── auth.ts               identidad: actorFromEnv (stdio), HttpAuthenticator y 401 del HTTP (4.7)
├── oauth/                servidor de autorización OAuth 2.1 (4.7): provider, store, bearer
├── rate-limit.ts         límite de llamadas a tools por token (4.7)
├── transports/stdio.ts   runStdioServer(deps)
├── transports/http.ts    handleCreatorMcpRequest (Next /mcp/creator) y startHttpServer (Node)
└── bin/stdio.ts          punto de entrada stdio para Claude Desktop (servicios sobre Postgres)
```

## Chat del creador en la web (ticket 4.6)

`packages/web` → `/[locale]/creator/chat` (opcional `?roomId=` para abrirlo sobre un draft) y
`POST /api/creator-chat` (stream NDJSON). El orquestador (`src/server/creator-chat/`) es un cliente
MCP más: lista y llama a las tools de ESTE servidor por el transporte HTTP streamable de
`/mcp/creator`, con la cookie de sesión del creador (sin lógica paralela). Por defecto la petición
HTTP se entrega al handler de la ruta en el mismo proceso; con `CREATOR_CHAT_MCP_URL`, por red.

- El modelo va detrás de `ChatModelProvider`: `createAnthropicChatProvider` (Messages API en
  streaming, `claude-sonnet-5` por defecto, `CREATOR_CHAT_MODEL`, clave `ANTHROPIC_API_KEY`; sin
  ella la página dice que el chat no está configurado) y `createScriptedChatProvider`, un guion
  para tests sin red.
- Topes por conversación (`CREATOR_CHAT_MAX_TURNS`, `CREATOR_CHAT_MAX_TOKENS`) y por respuesta
  (`CREATOR_CHAT_MAX_OUTPUT_TOKENS`); los resultados de tool se recortan para el modelo
  (`CREATOR_CHAT_TOOL_RESULT_MAX_CHARS`) remitiendo a las vistas filtradas. `get_featured_room` no
  se ofrece al modelo.
- `publish` sigue sin publicar: la UI muestra el enlace de confirmación de 4.5 como botón.

## Identidad y auth (ticket 4.7)

- **stdio (solo desarrollo):** la identidad sale del entorno. **No apto para producción**: quien
  lanza el proceso decide con qué usuario actúa el agente, sin login ni consentimiento. Sin
  identidad, el servidor arranca, avisa por stderr y cada tool del creador responde `UNAUTHORIZED`.

  | Variable | Uso |
  | --- | --- |
  | `ESCAPEROOM_MCP_USER_ID` | Id del usuario (Better Auth) con el que actúa el agente. **Obligatoria.** |
  | `ESCAPEROOM_MCP_ORGANIZATION_ID` | Organización activa (opcional). |
  | `ESCAPEROOM_APP_URL` | Origen de la web para el enlace de confirmación de `publish` (por defecto `http://localhost:3000`). |
  | `PUBLISH_CONFIRM_SECRET` | Secreto de la confirmación de `publish`: el mismo que en web (opcional en desarrollo). |
  | `DATABASE_URL` | Postgres de la app (el mismo que `packages/web`). |

- **HTTP (`/mcp/creator` en `packages/web`):** OAuth 2.1 según la especificación de autorización
  de MCP (`src/oauth`, equivalente de `@slxd/mcp-auth` con librerías estándar), o la cookie de
  sesión de Better Auth para el chat web integrado. Con `Authorization: Bearer` solo vale el access
  token OAuth (A-24) — un token de **sesión** obtenido del plugin `bearer` de Better Auth (el que
  usan otras superficies con `Authorization: Bearer <token-de-sesión>`) NO sirve aquí: en cuanto la
  petición trae `Authorization`, `/mcp/creator` la valida SOLO como token OAuth
  (`authenticateOAuthBearer`) y responde 401 `error="invalid_token"`, aunque el token de sesión sea
  válido para el resto de la web. Para el chat web integrado, no mandes `Authorization`: la cookie
  de sesión basta.

### OAuth 2.1 para clientes MCP remotos

`createOAuthProvider({ store, issuer, resource })` es framework-agnóstico (`Request`/`Response`); la
web lo sirve así:

| Endpoint                                                               | Qué                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-protected-resource/mcp/creator` (y en la raíz) | Metadata del recurso protegido (RFC 9728): `resource`, `authorization_servers`, `scopes_supported: ["mcp:creator"]`.                                                                               |
| `GET /.well-known/oauth-authorization-server`                          | Metadata del servidor de autorización (RFC 8414).                                                                                                                                                  |
| `POST /api/mcp/oauth/register`                                         | Registro dinámico de clientes (RFC 7591), limitado por IP. Públicos (`none`) o confidenciales (`client_secret_post`/`_basic`). `redirect_uri`: https, http solo loopback, o esquema de app nativa. |
| `GET /api/mcp/oauth/authorize`                                         | Valida la petición y lleva a `/{locale}/oauth/consent`: login con Better Auth (Google o enlace mágico) y consentimiento (next-intl, 6 idiomas).                                                    |
| `POST /api/mcp/oauth/authorize`                                        | Decisión del formulario (misma sesión + mismo origen): `code` o `access_denied` por la `redirect_uri`, con `state` e `iss`.                                                                        |
| `POST /api/mcp/oauth/token`                                            | `authorization_code` con **PKCE S256 obligatorio** y `refresh_token` con **rotación**.                                                                                                             |
| `POST /api/mcp/oauth/revoke`                                           | Revocación (RFC 7009): revoca la autorización entera (access + refresh).                                                                                                                           |

- **El token representa al creador**, siempre con rol `member`: las tools aplican la misma
  autorización que el editor (`RoomDraftService`: solo el autor lee o escribe su draft; otro draft
  → `FORBIDDEN` por tool). El token está ligado al recurso (RFC 8707) y no vale para otro.
- **Caducidad:** access token 1 h, refresh 30 días (rota en cada uso), código 5 min y de un solo
  uso, cliente registrado 1 año.
- **Sin credenciales, token caducado, revocado o desconocido** → 401 con
  `WWW-Authenticate: Bearer realm=…, resource_metadata="<origen>/.well-known/oauth-protected-resource/mcp/creator", scope="mcp:creator"`
  (y `error="invalid_token"` si se presentó un token): el cliente MCP descubre desde ahí el
  servidor de autorización y empieza el flujo.
- **Confirmar una publicación o dar el consentimiento es cosa de un humano:** `POST
  /api/publish-confirm` (4.5), su página y el formulario de consentimiento solo aceptan la cookie de
  sesión del navegador; cualquier cabecera `Authorization` (el token OAuth del MCP) se rechaza con
  403, así el agente no puede confirmar su propia publicación.
- **Almacenamiento** (`OAuthStore`, clave → JSON con caducidad): en la web, la tabla
  `verification` de Better Auth (prefijo `mcp-oauth:`, sin migración); códigos y tokens solo por su
  hash SHA-256. En tests, `createInMemoryOAuthStore`.

### Límites de coste

- **Rate limit por token** (`createRateLimiter`, ventana deslizante en memoria del proceso): 60
  llamadas a tools por minuto por autorización OAuth (o por usuario con sesión web). Al superarlo,
  429 con `Retry-After` y un error JSON-RPC legible (`Límite de uso del MCP superado: máximo 60
llamadas a tools cada 60 s por token. Reintenta en N s…`, `data.code = "RATE_LIMITED"`). Solo
  cuentan los `tools/call`.
- **Tope de tamaño de respuesta** (`DEFAULT_MAX_TOOL_RESPONSE_BYTES` = 64 KB de texto ≈ 16k
  tokens; `deps.maxToolResponseBytes` lo cambia): por encima, la tool responde `RESPONSE_TOO_LARGE`
  con un mensaje accionable —usar `get_room_graph`, `get_puzzle({ roomId, puzzleId })` y
  `get_rules_for({ roomId, objectId })`— y, si es `get_room`, los ids de puzzles y objetos de la
  sala. Aplica a todos los transportes. El Rey Aldric (~25 KB) cabe.

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

`test/verification-toolset.test.ts` (4.5) usa los servicios reales en memoria (draft, publicación de
3.9, confirmación): la checklist de `validate` en verde y en rojo; `preview` devuelve la URL del
link de prueba y solo para el autor; `publish` falla con el informe si el validador no está en
verde, en verde **no publica** hasta confirmar (y tras confirmar crea la `roomVersion`, de un solo
uso), y si el draft cambia entre la solicitud y la confirmación, la confirmación se rechaza.

`test/oauth.test.ts` (4.7) hace el flujo OAuth completo con el cliente del SDK de MCP
(`StreamableHTTPClientTransport` + `authProvider`: 401 → metadata → DCR → PKCE → consentimiento →
token) contra `startHttpServer` con los endpoints OAuth montados como en la web, y comprueba que el
token funciona en `/mcp/creator`, que un creador no lee ni modifica el draft de otro (`FORBIDDEN`
por tool), 401 con token caducado/revocado/inventado o sin token, rotación del refresh, PKCE,
`redirect_uri`, rate limit y el aviso de `get_room` en una sala grande.

`test/logic-toolset.test.ts` (4.3) siembra el Rey Aldric con `roomPackageToDoc`: el agente obtiene
el grafo, añade una regla que aparece en `get_rules_for`, `get_room` y `roomDocToPackage`, y se
comprueban los errores accionables (objeto, item, diálogo, puzzle o habitación inexistentes; ids
repetidos) y que las vistas filtradas ocupan menos que `get_room`.

### Paridad editor ↔ MCP (ticket 4.8)

`test/mcp-parity.spec.ts` (specs/22 §3.3) es la prueba determinista de "todo lo que el editor visual
puede hacer, el MCP puede hacerlo": un cliente del SDK construye **el Rey Aldric entero** solo con el
toolset (`create_room`, `define_subrooms`, `set_map`, `paint_tiles`, `define_item`, `add_dialog`,
`add_object`, `add_puzzle`, `add_hint`, `add_rule`, `decorate_subroom`), siguiendo el guion de
`test/fixtures/aldric-script.ts`, que envía cada entidad tal cual está en
`docs/reference/roompackage-rey-aldric.v1.json`. Después comprueba que `validate` está en verde y
publicable, que el validador da la sala solvable para 1–4 jugadores con **la misma ruta crítica** (16
pasos) que el fixture y que el RoomPackage del draft es equivalente al fixture. Corre en memoria, sin
red, en cada PR (~2 s).

Cómo construye el agente (lo que el validador incremental de 4.4 obliga a hacer):

- **En orden de juego** (Salón → Bodega → Catacumbas): nada puede referenciar lo que aún no existe
  ni quedar inalcanzable.
- **Altas en dos pasos para las referencias mutuas**: el puzzle que `unlocks` una puerta y la puerta
  con `lockedBy` ese puzzle (placas ↔ puerta de la Bodega, candado ↔ arca, mirillas ↔ reja, sello ↔
  relicario); el `code_lock` que lista sus `hints` y cada pista con su `puzzleId`. Se da de alta el
  puzzle sin la referencia y, cuando existe la otra entidad, se sustituye con `replace: true` (que
  conserva su posición).
- `p-combina` entra primero con la receta cuyos ingredientes ya se obtienen (yesquero + vela) y se
  completa en las Catacumbas, cuando ya hay llave de plata y compuerta de oro.

Diferencias no semánticas que el test normaliza (y comprueba aparte):

| Campo | Por qué difiere |
| --- | --- |
| `meta.id`, `meta.authorId`, `meta.version` | Los asigna la plataforma (id del draft, actor de `create_room`, semver de la publicación). |
| Orden de `objects`, `items`, `puzzles`, `rules`, `dialogs`, `hints` | El doc conserva el orden de alta (el de juego). Se compara por id; el único orden con semántica —el desempate por posición entre reglas del mismo disparador y prioridad (`r-caliz-en-ranura` antes que `r-recoger-caliz`)— se comprueba explícitamente. |

`map.rooms[].decorations` y `map.rooms[].lighting` ya **no** se normalizan: el guion los construye con
`decorate_subroom` (al final, cuando existen los objetos que gobiernan antorchas, como el `brasero`) y
se comparan byte a byte y en orden con el fixture.

**Variante por chat con un LLM real (nightly, no determinista).** La fila 4.8 del plan pide también
construir la sala "por chat". Esa variante necesita el proveedor del chat web (4.6), que aún no está
en main, así que queda documentada y no implementada: cuando 4.6 esté, un job nightly opcional
(`schedule` en `.github/workflows/`, detrás de `ANTHROPIC_API_KEY` y saltado si falta) debe darle al
proveedor de 4.6 el mismo toolset (cliente MCP en memoria como aquí), pedirle el Rey Aldric a partir
de la descripción de la sala y aplicar las MISMAS comprobaciones de este spec salvo la igualdad de
entidades (el LLM elige ids y textos): `validate` en verde y ruta crítica solvable para 1–4 jugadores.
Nunca en el CI de PR (sin llamadas reales a APIs).
