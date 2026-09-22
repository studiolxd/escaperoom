# 10 — MCP del creador

Depende de `08-formato-roompackage.md`, `09-editor-de-salas.md` y `13-api-rest.md`. Es la vía
conversacional de creación: un agente IA construye y edita salas.

---

## 1. Filosofía de diseño: el MCP no es una vía aparte

```
            ┌──────────────────────────────────────────────┐
            │     Servicios de dominio (shared/services)     │
            │  única lógica: salas, objetos, puzzles, reglas │
            └───┬───────────────┬───────────────┬───────────┘
                │               │               │
        ┌───────┴───┐   ┌───────┴───────┐  ┌────┴──────────┐
        │ tRPC (UI) │   │ REST /api/*   │  │ MCP           │
        │ editor+web│   │ público       │  │ /mcp/creator  │
        └───────────┘   └───────────────┘  └────┬──────────┘
                                                │
                                     ┌──────────┴───────┐
                                     │  Chat con agente │
                                     │  (Claude, etc.)  │
                                     └──────────────────┘
```

**Principio rector:** *todo lo que el editor visual puede hacer, el MCP puede hacerlo, y
viceversa.* No se comparte un contrato: **se comparte la lógica** (ADR-010/022). Las tools del MCP
llaman a los mismos **servicios de dominio** que el router tRPC del editor y las rutas REST públicas,
con un `actor` como única diferencia — el patrón de SLXD (`specs/04` § "Mutar por MCP"). Misma
validación, mismo draft, mismo playtest. El agente es "otro par de manos" en el editor — con Yjs
pueden co-editar agente y humano a la vez (el agente aparece como colaborador).

### 1.1 Transporte, autenticación y pipeline

Se copia el patrón de SLXD (ADR-017/022):

- **Servidor:** `@slxd/mcp-server` adaptado — pipeline de petición, registro de herramientas, gate de
  confirmación y meta-tools (`find_tools`, `tool_schema`, `run_tool`, `upload`).
- **Transporte:** HTTP streamable en `/mcp/creator` (chat web) y **stdio** (Claude Desktop).
- **Auth:** `@slxd/mcp-auth` adaptado — OAuth 2.1 con PKCE + DCR; el login se resuelve contra la
  sesión de **Better Auth** (no hay plano de control aparte). El token de un creador no puede tocar
  salas ajenas.
- **Mutuaciones:** `destructiveHint: true` → el pipeline exige `confirm: true` o devuelve vista
  previa; `publish` es irreversible y lleva confirmación humana explícita.
- **La costura:** cada tool llama a un **servicio de dominio** con un `actor`; no reimplementa el
  router tRPC (ADR-010).

## 2. Toolset

Organizado por fase de creación, con esquemas Zod (compartidos desde `packages/shared/schemas`).

### Fase A — Estructura

| Tool | Descripción |
|---|---|
| `create_room(meta)` | Crea draft: título, tema, idioma, dificultad, nº jugadores |
| `set_map({tileset, size, layers})` | Define dimensiones y tileset |
| `paint_tiles({layer, cells})` | Pinta celdas (el "brush" del agente) |
| `define_subrooms([{id, name, bounds}])` | Habitaciones internas (Salón, Bodega, Catacumbas) |

### Fase B — Contenido

| Tool | Descripción |
|---|---|
| `add_object({id, type, position, sprite, initialState})` | Puertas, cajones, estatuas, placas, escondites |
| `define_item({id, name, icon})` | Catálogo de objetos |
| `add_puzzle({id, type, config})` | Las plantillas con su config (code, recetas, placas…) |
| `add_dialog({id, text, conditions?})` | Textos narrativos |
| `add_hint({puzzleId, tier, text, cost})` | Sistema de pistas |

### Fase C — Lógica

| Tool | Descripción |
|---|---|
| `add_rule({trigger, conditions, actions})` | Lógica SI/ENTONCES |
| `get_room_graph()` | Devuelve el grafo (puzzles, objetos, reglas) para que el agente razone |

### Fase D — Verificación y publicación

| Tool | Descripción |
|---|---|
| `validate()` | Corre el validador: dead ends, huérfanos, solvabilidad. Devuelve errores/avisos legibles |
| `preview()` | Devuelve URL de previsualización en modo playtest |
| `publish({versionNotes})` | Congela versión (con checklist superada) |

### Fase E — Consulta (contexto para el agente)

| Tool | Descripción |
|---|---|
| `get_room()` | Estado completo del draft como JSON |
| `get_template_catalog()` | Catálogo de plantillas con sus esquemas (configs válidas) |
| Vistas filtradas | `get_puzzle(id)`, `get_rules_for(objectId)` — ahorran tokens |

## 3. Patrón clave: validación + dry-run en cada tool

Cada tool que muta (`add_puzzle`, `add_rule`…) hace:

```
1. Valida el input contra el esquema de la plantilla (Zod)
2. Ejecuta en modo dry-run → genera el JSON resultante
3. Corre el validador incremental
4. Si hay errores → los devuelve al agente con mensaje accionable:
   "❌ add_rule falló: el objeto 'salida-bodega' no existe.
    Objetos disponibles: [...]"
5. Si es válido → commit al Yjs doc (¡mismo canal que el editor visual!)
```

Esto hace al agente **fiable**: no escribe JSON a ciegas; cada paso tiene feedback estructurado, y
el validador que corrige al editor humano es el mismo que corrige al agente.

## 4. Ejemplo real: crear el Rey Aldric desde el chat

```
Usuario:  Crea una escape room medieval de 3 salas para 4 jugadores:
          "La Maldición del Rey Aldric". Aquí va el diseño [pega narrativa]

Agente:   ✅ create_room(meta) — draft creado: #room_812
          ✅ set_map — castillo 40×30, tileset medieval, 3 subrooms
          ✅ add_object × 12 — trono, 4 retratos, armario, 2 estatuas,
             brasero, arca, puerta-bodega…
          ✅ define_item × 6 — llave-bronce, mechero, vela, antorcha,
             cáliz-real, llave-oro
          ✅ add_puzzle × 8 — (hidden_key, code_lock×2, simultaneous_plates,
             sliding_puzzle, memory, split_clue, pipes)
          ✅ add_dialog × 5 — profecía, pergamino bodega, inscripciones…
          ✅ add_rule × 14 — brasero, placas simultáneas, cáliz en ranura,
             reja con mirillas, canal de agua…

Agente:   ⚠️ validate() — 2 avisos:
          1. Ninguna pista referencia el 3er dígito del sello final
          2. La receta "mechero+vela→antorcha" no se otorga a ninguna regla

Usuario:  Añade una pista en el brasero y deja que la receta se descubra
          por prueba y error

Agente:   ✅ add_hint → vinculada a candado-arca, tier 2
          ✅ publish({versionNotes: "v1.0 — sala inicial"})
          → Sala publicada. URL de playtest: https://…/play/812/test
```

Media hora de conversación ≈ el escape room completo y jugable. El profe sin conocimientos
técnicos describe su clase al chat y obtiene una sala funcional que luego puede retocar en el
editor o seguir iterando por chat.

## 5. Implementación técnica

```
packages/
├── mcp-server/          ← @slxd/mcp-server adaptado (pipeline, registry, gate; OAuth con @slxd/mcp-auth)
│   ├── tools/           ← un módulo por tool (schema Zod + handler)
│   ├── lib/validator.ts ← validador compartido (importado del monorepo)
│   └── index.ts         ← server setup (stdio + streamable HTTP en /mcp/creator)
├── editor/              ← Next.js (editor visual)
├── game-runtime/        ← runtime Phaser
└── shared/
    ├── services/        ← servicios de dominio que invocan las tools (ADR-022)
    ├── schemas/         ← Zod: PuzzleDefinition, Rule, RoomPackage…
    └── templates/       ← catálogo de plantillas con sus configs
```

Decisiones:

- **Comparte los esquemas Zod** entre editor, API y MCP (`packages/shared`). El MCP nunca define
  sus propios tipos — importa los mismos `PuzzleDefinition` que el runtime. Cero deriva.
- **Transporte:** stdio (desarrollo con Claude Desktop) + HTTP streamable en `/mcp/creator` (chat del
  creador integrado en Next.js).
- **Auth por OAuth 2.1** (`@slxd/mcp-auth`): el login se resuelve contra la sesión de **Better Auth**;
  el agente actúa con los permisos del creador autenticado y no puede tocar salas ajenas.
- **Límites de seguridad:** el agente solo opera sobre *drafts*. `publish()` exige validación en
  verde y confirmación humana explícita (el humano aprueba el "git push" de la sala).
- **Coste de tokens:** `get_room()` puede devolver salas grandes. Vistas filtradas
  (`get_puzzle(id)`, `get_rules_for(objectId)`) para que el agente no cargue todo en cada paso.
- **Sin lógica paralela:** las tools llaman a los **servicios de dominio** (ADR-010/022), no a una API
  HTTP intermedia, y escriben en el mismo canal Yjs que el editor (ver `specs/13-api-rest.md` §12).

## 6. Por qué construirlo desde el primer momento

1. **Fuerza a formalizar el contrato temprano:** si el editor visual tolerara estados
   inconsistentes, el MCP se rompería. Hacerlo primero obliga a que esquemas y validador estén bien.
2. **Es el test E2E perpetuo:** crear el Rey Aldric por chat es el test de aceptación de toda la
   plataforma.
3. **Diferenciador comercial:** "crea tu escape room describiéndolo a la IA".
4. **Las salas de ejemplo se fabrican solas** (marketing, tutoriales, plantillas temáticas).
5. **El grafo se vuelve consultable:** `get_room_graph()` abre la puerta a agentes que analizan
   dificultad, equilibrio y tiempos, o que adaptan salas ("haz esta sala más fácil para 12 años").

## 7. Dependencias

- `specs/08-formato-roompackage.md` — el contrato sobre el que opera.
- `specs/09-editor-de-salas.md` — mismo doc Yjs y mismo validador.
- `specs/22-qa-y-pruebas.md` §3.3 — `mcp-parity.spec.ts` como comprobación continua.
