# MCP del creador (`@escaperoom/mcp-server`)

Servidor MCP con el que un agente IA (Claude Desktop, el chat web de 4.6) construye y edita salas
en borrador (`docs/specs/10-mcp-del-creador.md`). Sus tools **no tienen lógica propia**: llaman a los
mismos servicios de dominio de `@escaperoom/shared/services` que el tRPC del editor y la REST, con
un `actor` como única diferencia (ADR-010/022).

## Toolset (ticket 4.1)

El toolset completo de specs/10 §2 está registrado con su nombre, descripción, anotaciones y
esquema de entrada (Zod de `@escaperoom/shared/schemas` → JSON Schema). Todas las tools que operan
sobre un draft reciben `roomId` (el mismo `:roomId` de `/api/rooms/:roomId/draft`).

| Fase | Tool | Estado |
| --- | --- | --- |
| A — Estructura | `create_room`, `set_map`, `paint_tiles`, `define_subrooms` | esqueleto (4.2) |
| B — Contenido | `add_object`, `define_item`, `add_puzzle`, `add_dialog`, `add_hint` | esqueleto (4.2) |
| C — Lógica | `add_rule`, `get_room_graph` | esqueleto (4.3) |
| D — Verificación | `validate` | **implementada** (validador de 2.9) |
| D — Verificación | `preview`, `publish` | esqueleto (4.5) |
| E — Consulta | `get_room` | **implementada** (draft de 3.2) |
| E — Consulta | `get_template_catalog` (4.2), `get_puzzle`, `get_rules_for` (4.3) | esqueleto |
| — | `get_featured_room` | ejemplo de 0.10 (paridad tRPC/REST/MCP), pública |

Una tool del esqueleto responde con `isError: true`, el texto
`❌ <tool>: no implementado todavía (ticket 4.x)…` y `structuredContent.error.code = "NOT_IMPLEMENTED"`.
El resto de errores usan los mismos códigos (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`INVALID_DRAFT`, `NOT_AVAILABLE`, `INTERNAL`).

`get_room`/`validate` leen el draft con `RoomDraftService.loadDraft` (misma autorización que el
editor: solo el autor) y lo convierten a `RoomPackage` con `roomDocToPackage`, la conversión doc
Yjs → RoomPackage del ticket 3.1, **inyectada**. Mientras no se cablee, responden `NOT_AVAILABLE`.

## Estructura

```
src/
├── server.ts             createCreatorMcpServer(deps): registra el toolset y la política común
├── tools/                un módulo por tool (esquema Zod + handler); index.ts = CREATOR_TOOLSET
├── room-draft-reader.ts  draft (3.2) → doc Yjs → RoomPackage validado
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
