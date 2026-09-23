# 22 — Plan de pruebas y QA

Depende de `08-formato-roompackage.md`, `09-editor-de-salas.md` (§5) y
`reference/roompackage-rey-aldric.v1.json`.

Formaliza tres cosas: el **algoritmo** del test de solvabilidad, la **estrategia E2E** con
Playwright y el **protocolo de playtest humano** para la beta cerrada.

---

## 1. Pirámide de testing

```
                    ▲  Playtest humano (manual, pre-beta, no en CI)
                   ╱ ╲
                  ╱   ╲  E2E Playwright (full-stack, navegador real)
                 ╱─────╲
                ╱       ╲  Test de solvabilidad (algorítmico, por RoomPackage)
               ╱─────────╲
              ╱           ╲  Integración (Colyseus rooms, rutas API — sin navegador)
             ╱─────────────╲
            ╱               ╲  Unitario (motor de reglas, cada plantilla, ledger, pricing)
           ╱─────────────────╲
```

### 1.1 Qué cubre cada nivel

| Nivel | Qué prueba | Dónde vive | Cuándo corre |
|---|---|---|---|
| Unitario | Motor de reglas (`conditions`/`actions`), cada plantilla en aislado, `applyCreditMovement`, cálculo de tramos de precio, `expiryRules` | `packages/*/__tests__` (Vitest) | Cada commit, local y CI |
| Integración | `GameRoom` con clientes de test (sin navegador), rutas API contra Postgres/Redis efímeros | `packages/colyseus-server/__tests__`, `packages/web/__tests__/api` | Cada PR |
| Solvabilidad | Un `RoomPackage` es completable — hard check bloqueante para `publish()` | `packages/shared/validator` (mismo código que `POST /validate`) | Cada `publish()`, en CI contra el Rey Aldric y cada fixture |
| E2E Playwright | Flujos completos por la UI real, multi-navegador | `packages/e2e` | PR (subset) + nightly (suite completa) |
| Playtest humano | Experiencia real, diversión, confusión, ritmo | fuera de CI | Antes de abrir la beta, y en cada salto de fase mayor |

## 2. Test de solvabilidad automático

### 2.1 El problema

Dado un `RoomPackage`, comprobar que **existe al menos una secuencia de acciones que lleva del
estado inicial a la condición de victoria**, para cada tamaño de grupo dentro de
`players.min`–`players.max` (una sala con objeto-puente debe ser solvable también en solitario).

No es un test de UI ni de red: es un test **sobre los datos**, igual que corre en
`POST /api/rooms/:roomId/validate` antes de publicar.

### 2.2 Algoritmo: cierre por encadenamiento hacia delante

El creador define el estado correcto de cada puzzle como parte de sus datos (código del candado,
disposición del mural, parejas…), así que el validador **tiene acceso a la solución** — no tiene
que descubrirla como un jugador. Es un problema de **forward chaining**:

1. Partir del estado inicial (items en 0, objetos en su estado por defecto, flags a `false`).
2. Repetir hasta punto fijo: para cada puzzle **disponible** (sus condiciones de activación se
   cumplen) y **no resuelto**, comprobar si es solvable en ese estado (§2.3) — si lo es, marcarlo
   resuelto y aplicar sus `grantsItems`/efectos; para cada regla cuyo trigger y condiciones se
   cumplen, aplicarla.
3. Si se cumple la condición de victoria (regla final / `on_all_players_in_zone` del altar…) →
   **solvable**.
4. Si se alcanza un punto fijo sin victoria → **no solvable**; el informe indica qué
   puzzles/objetos quedaron bloqueados y con qué precondición sin cumplir (mismo estilo de error
   accionable del MCP: *"el objeto 'salida-bodega' no existe. Disponibles: [...]"*).

Determinista y rápido: el espacio de estados de una sala típica (decenas de puzzles/flags) cierra
en milisegundos, a diferencia de una búsqueda de fuerza bruta.

### 2.3 Oráculo de solvabilidad por plantilla

Cada plantilla implementa `isSolvableGiven(state): boolean` que el validador usa en el paso 2:

| Plantilla | Qué comprueba el oráculo |
|---|---|
| `code_lock` | El código está definido (siempre true salvo dato faltante) |
| `sliding_puzzle` | La mezcla inicial es alcanzable por movimientos válidos (invariante de paridad) — se comprueba **al guardar el puzzle**, no solo en publish |
| `pipes` | Existe al menos un camino start→end (flood fill) |
| `split_clue` | Para el tamaño de grupo evaluado, existe asignación de jugadores a fragmentos cuya unión cubre la pista (con jugador único: exige el objeto-puente) |
| `combine_items` | La receta es alcanzable: cada input tiene una fuente (otro puzzle, `grantsItems`, u objeto inicial) |
| `memory`, `simultaneous_plates` (con puente), resto | Análogas: solvable si las precondiciones de datos están completas; el caso interesante es "¿es *alcanzable* dado el resto del grafo?", que resuelve el cierre del §2.2 |

### 2.4 Qué NO cubre el hard check (warning 🟡, no bloquea publish)

El cierre encuentra *una* secuencia válida, pero un jugador real puede tomar un camino peor (el
caso del cáliz con doble uso del Rey Aldric). Heurísticos adicionales no bloqueantes:

- **Ítems con `consumeInputs: true` usados como input en más de una receta/regla** → 🟡 posible
  soft-lock si se gastan en la receta "equivocada" primero (el validador avisa, no exige la
  solución; en el Rey Aldric estaba resuelto con una regla de recuperación).
- **Puzzles sin pista asociada** (ya en el validador del editor).
- **Dificultad declarada vs. estimación** (nº de puzzles, profundidad del grafo) fuera de rango.
- **Assets referenciados que no existen en el manifest** (rompe la sala igual; se comprueba en la
  misma pasada).

### 2.5 Estimación de duración y ruta crítica

La secuencia encontrada en §2.2 (la más corta por BFS) es la **ruta crítica** reportada — el
formato ya usado en el informe de validación del Rey Aldric. La estimación de minutos combina
longitud de la ruta crítica × tiempo medio por tipo de acción (constantes calibradas con los datos
de playtest de §4, revisadas al acumular sesiones reales).

## 3. Estrategia de tests E2E (Playwright)

### 3.1 Dos capas de "E2E", a propósito distintas

- **`packages/game-runtime/__tests__/e2e.*.spec.ts`**: cliente de test de Colyseus hablando el
  protocolo directamente, **sin navegador**. Rápido (segundos); corre en cada PR contra el Rey
  Aldric como suite de regresión del motor de reglas.
  > **Ubicación real (ticket 2.12):** `packages/colyseus-server/test/e2e.reyaldric.spec.ts`, junto
  > al servidor (`GameRoom`) y sus dependencias de test (`@colyseus/testing`, puerto libre).
- **`packages/e2e/*.spec.ts`** (Playwright): navegador real, UI real; valida que lo anterior
  funciona **a través de la aplicación** (clics, WebSocket real, checkout Stripe test mode, emails
  simulados). Más lento; subset en PR, completo en nightly.

Ambas existen porque un fallo puede estar en el motor (capa 1) o en cómo la UI lo conecta (capa 2).

### 3.2 Entorno

- `docker-compose.e2e.yml`: web, colyseus, PostgreSQL, Redis, LiveKit local, efímero en CI.
- Stripe en **test mode** (tarjeta `4242…`); el webhook se dispara con `stripe listen
  --forward-to` (no se mockea) para probar el contrato real de firma/idempotencia.
- Emails: Resend/Postmark en **modo sandbox** (captura el envío; el test lee el "email" para
  extraer el link de confirmación de clave).
- Seed: el mismo `pnpm db:seed` que desarrollo (admin, creador de ejemplo, Rey Aldric publicado) —
  un solo fixture para desarrollo y CI evita que diverjan.

### 3.3 Suites

| Spec | Qué recorre |
|---|---|
| `game.reyaldric.spec.ts` | 2 `BrowserContext` (2 jugadores reales) se unen a la misma sesión y ejecutan la secuencia de 14 pasos por clics reales, assert `game_ended {result: 'victory'}` visible. Contraparte UI del fixture de `game-runtime` |
| `purchase-flow.spec.ts` | Catálogo → detalle → checkout Stripe test → retorno → acceso concedido → jugar la primera sala sin clave |
| `event-flow.spec.ts` | Organizador crea evento → claves en lote → exporta PDF → un contexto "sin cuenta" canjea una clave del sandbox de email → juega parcialmente → el panel del organizador (otro contexto) refleja el progreso en vivo |
| `editor-publish.spec.ts` | Crear sala, 2 pestañas coeditando (verifica que Yjs converge en UI), `validate()` en verde, `publish()`, la sala aparece en catálogo |
| `mcp-parity.spec.ts` *(nightly)* | Construye una sala equivalente al Rey Aldric **vía MCP** (sin UI) y corre el test de solvabilidad sobre el resultado — comprobación continua de "todo lo que el editor visual puede hacer, el MCP puede hacerlo" |

### 3.4 En CI

- **Por PR:** `game.reyaldric.spec.ts` + `purchase-flow.spec.ts` (los más baratos y los que más
  rompen con cambios de protocolo/pagos).
- **Nightly (rama principal):** suite completa + `mcp-parity.spec.ts`.
- Un fallo de `game.reyaldric.spec.ts` **bloquea el merge**; un fallo nightly abre ticket
  automático, no bloquea retroactivamente PRs ya mergeados.

## 4. Protocolo de playtest humano (beta cerrada)

El test de solvabilidad garantiza que la sala **se puede** completar; no dice si es **divertida,
comprensible o si el ritmo es el esperado**. Eso solo se ve con personas.

### 4.1 Cuándo

Antes de abrir la beta cerrada y en cada salto de fase mayor. Requisito previo: validador y suite
E2E en verde sobre el Rey Aldric y 2–3 salas creadas por early creators reales (no solo staff).
El playtest humano es caro en tiempo de personas: no se gasta en bugs que el automático ya cazaría.

### 4.2 Muestra

- **5–8 grupos** de 2–4 jugadores (la regla "5 usuarios encuentran ~80 % de los problemas" aplica).
- Mezcla deliberada: jugadores habituales de escape rooms físicos, profesores/organizadores
  potenciales y personas que nunca han jugado — los tres ven problemas distintos.
- Reclutamiento: red de contactos de Studio LXD (clientes docentes) + comunidad de la beta.

### 4.3 Sesión

1. Consentimiento explícito de grabación (usa LiveKit como un evento real — dogfooding).
2. El moderador se une como **organizador en modo observador** (`SpectatorRoom`) — la misma
   feature que un profesor real usaría.
3. Sin *think-aloud* forzado (rompe la cooperación real); el moderador toma notas de: silencios
   largos, repetición de intentos fallidos, cambios de estrategia, quién lidera y quién queda fuera.
4. Entrevista corta post-partida (5–10 min): puzzle favorito, cuál frustró, si algo se sintió
   injusto (vs. "difícil pero justo").
5. Cuestionario breve (SUS o similar) — cuantifica lo cualitativo para comparar sesiones y salas.

### 4.4 Métricas capturadas

- **Tiempo real por puzzle vs. estimación del validador** — alimenta la calibración de constantes.
- **Pistas usadas por puzzle** (de `progressEvent`, reutiliza la analítica de producción).
- **Señal de frustración automática:** ≥3 `puzzle_attempted` fallidos al mismo puzzle en <2 min →
  se marca la sesión para revisión.
- **Abandono / desconexión.**
- Nº de veces que un jugador tuvo que ser "arrastrado" sin entender qué pasaba (señal de mecánica
  cooperativa que no se explica sola).

### 4.5 Reporte y criterio de salida a beta

Cada hallazgo se etiqueta **bug** (no funciona como está diseñado → backlog) o **diseño** (funciona
como está diseñado pero no funciona para el jugador → vuelve al creador de la sala o a la plantilla).

Criterios orientativos:

- ≥ 80 % de los grupos completan la sala sin intervención del moderador más allá del sistema de
  pistas normal.
- Tiempo real medio dentro de ±30 % de `estimatedMinutes`.
- Cero soft-locks reales (si aparece uno, es bug bloqueante — y también bug del validador si no lo
  anticipó).
- Ninguna mecánica cooperativa obligatoria dejó a un jugador completamente pasivo en más de un grupo.

## 5. Resumen de responsabilidades

| Capa | Bloquea `publish()` | Bloquea merge de PR | Bloquea apertura de beta |
|---|---|---|---|
| Unitario / integración | — | ✅ | — |
| Solvabilidad (hard check) | ✅ | ✅ (fixture Rey Aldric) | — |
| Solvabilidad (warnings 🟡) | ❌ (solo aviso) | — | — |
| E2E Playwright (PR subset) | — | ✅ | — |
| E2E Playwright (nightly completo) | — | ❌ (abre ticket) | ✅ debe estar en verde |
| Playtest humano | — | — | ✅ criterios de §4.5 |

## 6. Dependencias

- `reference/roompackage-rey-aldric.v1.json` — fixture y secuencia de solución.
- `specs/09-editor-de-salas.md` §5 — validador del editor.
- `specs/13-api-rest.md` §4 — `POST /validate` y `POST /publish`.
