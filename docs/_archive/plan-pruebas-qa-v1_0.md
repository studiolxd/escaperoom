# Plan de pruebas y QA

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§10.3), `roompackage-rey-aldric-v1.0.md` (informe de validación y fixture) y `protocolo-mensajes-colyseus.md`.

Este documento formaliza tres cosas que hasta ahora estaban solo esbozadas: el **algoritmo** del test de solvabilidad (el validador de §10.3 decía *qué* comprueba, no *cómo*), la **estrategia E2E** con Playwright, y el **protocolo de playtest humano** para la beta cerrada.

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
           ╱───────────────── ╲
```

Cuanto más abajo, más rápido y más barato de mantener — cuanto más arriba, más cerca de lo que de verdad experimenta el usuario. El test de solvabilidad es la pieza más específica de este dominio (no es un patrón de testing genérico) y por eso se detalla aparte en la sección 2.

### 1.1 Qué cubre cada nivel

| Nivel | Qué prueba | Dónde vive | Cuándo corre |
|---|---|---|---|
| Unitario | Motor de reglas (evaluación de `conditions`/`actions`), cada plantilla de puzzle en aislado, ledger de créditos (`apply_credit_movement`), cálculo de tramos de precio de eventos, `expiryRules` | `packages/*/  __tests__` (Vitest) | En cada commit, local y CI |
| Integración | `GameRoom` de Colyseus con clientes de test (sin navegador, `colyseus.js` en modo test), rutas API con cliente HTTP de test contra Postgres/Redis efímeros | `packages/colyseus-server/__tests__`, `packages/web/__tests__/api` | En cada PR |
| Solvabilidad | Un `RoomPackage` dado es completable — hard check bloqueante para `publish()` | `packages/shared/validator` (mismo código que corre en `POST /api/rooms/:roomId/validate`) | En cada `publish()`, en CI contra el Rey Aldric y cada sala de fixture |
| E2E Playwright | Flujos completos a través de la UI real, multi-navegador | `packages/e2e` | PR (subset rápido) + nightly (suite completa) |
| Playtest humano | Experiencia real, diversión, confusión, ritmo | fuera de CI | antes de abrir la beta cerrada, y en cada salto de fase mayor |

---

## 2. Test de solvabilidad automático

### 2.1 El problema

Dado un `RoomPackage` (objetos, items, puzzles, reglas — `especificaciones-escape-room-creator-v1.0.md` §9), comprobar que **existe al menos una secuencia de acciones que lleva del estado inicial a la condición de victoria**, para cada tamaño de grupo dentro de `players.min`–`players.max` declarado (una sala con objeto-puente debe ser solvable también en solitario).

No es un test de UI ni de red: es un test **sobre los datos** de la sala, igual que corre en `POST /api/rooms/:roomId/validate` antes de publicar.

### 2.2 Por qué no hace falta "jugar" para comprobarlo

El creador define el estado correcto de cada puzzle como parte de sus propios datos (el código del candado, la disposición del mural, las parejas de memoria...) — el validador **tiene acceso a la solución**, no tiene que descubrirla como un jugador. Esto convierte la solvabilidad en un problema de **cierre por encadenamiento hacia delante** (forward chaining), no de búsqueda ciega:

1. Parte del estado inicial (items en 0, objetos en su estado por defecto, flags a `false`).
2. Repite hasta punto fijo: para cada puzzle **disponible** (sus condiciones de activación se cumplen en el estado actual) y **no resuelto**, comprueba si es solvable en ese estado (ver §2.3, depende de la plantilla) — si lo es, márcalo resuelto y aplica sus `grantsItems`/efectos; para cada regla cuyo trigger y condiciones se cumplen, aplícala.
3. Si en algún punto se cumple la condición de victoria (regla final / `on_all_players_in_zone` del altar, etc.) → **solvable**.
4. Si se alcanza un punto fijo (nada más progresa) sin haber llegado a victoria → **no solvable**; el informe indica exactamente qué puzzles/objetos quedaron bloqueados y con qué precondición sin cumplir (mismo estilo de error accionable que usa el MCP, §11 de especificaciones: *"el objeto 'salida-bodega' no existe. Disponibles: [...]"*).

Esto es determinista y rápido (el espacio de estados de una sala típica —decenas de puzzles/flags, no miles— cierra en milisegundos), a diferencia de una búsqueda de fuerza bruta sobre todas las combinaciones de acciones de un jugador.

### 2.3 Oráculo de solvabilidad por plantilla

Cada plantilla de puzzle (las 8 del MVP + 15 de v2, `plantillas-puzzle-v2-especificacion.md`) implementa una función `isSolvableGiven(state): boolean` que el validador usa en el paso 2 — porque "solvable" no significa lo mismo para cada tipo:

| Plantilla | Qué comprueba el oráculo |
|---|---|
| `code_lock` | El código está definido en los datos del puzzle (siempre true salvo dato faltante) |
| `sliding_puzzle` | La mezcla inicial es alcanzable desde el estado resuelto por movimientos válidos (invariante de paridad del 15-puzzle) — se comprueba **al guardar el puzzle en el editor**, no solo en publish, para dar feedback inmediato |
| `pipes` | Existe al menos un camino start→end en la rejilla declarada (flood fill) — admite múltiples soluciones válidas, el oráculo solo necesita que exista una |
| `split_clue` | Para el tamaño de grupo evaluado, existe una asignación de jugadores a fragmentos tal que la unión de lo visible cubre la pista completa (con jugador único: exige el objeto-puente, p. ej. el espejo del Rey Aldric) |
| `combine_items` | La receta es alcanzable: cada input tiene una fuente (otro puzzle, `grantsItems` de una regla, u objeto inicial) |
| `memory`, `simultaneous_plates` (con objeto-puente), resto | Análogas: siempre solvable si sus precondiciones de datos están completas; el caso interesante no es "¿tiene solución?" sino "¿es *alcanzable* dado el resto del grafo?", que es justo lo que resuelve el cierre del §2.2 |

### 2.4 Qué NO cubre el hard check (y pasa a warning 🟡, no bloquea publish)

El cierre del §2.2 encuentra *una* secuencia válida, pero un jugador real puede tomar un camino distinto y peor. El caso ya documentado en el Rey Aldric (el cáliz con doble uso) es la clase de problema que el hard check no puede ver por sí solo porque en la ruta que él elige nunca se produce el conflicto. Chequeos heurísticos adicionales, no bloqueantes:

- **Ítems con `consumeInputs: true` usados como input en más de una receta/regla** → 🟡 posible soft-lock si el jugador los gasta en la receta "equivocada" primero. (Así se marcó el cáliz; ahí estaba resuelto explícitamente con una regla de recuperación — el validador no exige la solución, solo avisa.)
- **Puzzles sin pista asociada** (ya en §10.3 de especificaciones).
- **Dificultad declarada vs. estimación** (número de puzzles, profundidad del grafo de dependencias) fuera de rango esperado.
- **Assets referenciados que no existen en el manifest** — no es solvabilidad de gameplay, pero rompe la sala igual; se comprueba en la misma pasada por conveniencia.

### 2.5 Estimación de duración y ruta crítica

La secuencia encontrada en el paso 2.2 (la más corta por BFS, no una cualquiera) es la que se reporta como "ruta crítica" — exactamente el formato ya usado en el Rey Aldric (§"Secuencia de solución verificada"). La estimación de minutos combina longitud de la ruta crítica × tiempo medio por tipo de acción (constantes calibradas con los datos de playtest de §4, revisadas cada vez que se acumulan sesiones reales).

---

## 3. Estrategia de tests E2E (Playwright)

### 3.1 Dos capas de "E2E", a propósito distintas

- **`packages/game-runtime/__tests__/e2e.*.spec.ts`** (ya referenciado como fixture en el RoomPackage): cliente de test de Colyseus hablando el protocolo directamente, **sin navegador**. Es rápido (segundos) y es el que corre en cada PR contra el Rey Aldric como suite de regresión del motor de reglas.
- **`packages/e2e/*.spec.ts`** (Playwright, esta sección): navegador real, UI real, valida que lo anterior también funciona **a través de la aplicación** — clics, WebSocket real del navegador, checkout de Stripe real (en test mode), emails simulados. Más lento, corre en subset en PR y completo en nightly.

Las dos existen porque un fallo puede estar en el motor (capa 1) o en cómo la UI lo conecta (capa 2) — mezclar ambas en una sola suite dificulta saber cuál es cuál cuando algo rompe.

### 3.2 Entorno

- `docker-compose.e2e.yml`: web, colyseus, PostgreSQL, Redis, LiveKit (modo local, sin SFU externo), levantado efímero en CI (mismo patrón que el smoke test de migraciones de `esquema-sql-migraciones-v1.0.md` §12).
- Stripe en **test mode**: tarjeta `4242 4242 4242 4242`; el webhook se dispara con `stripe listen --forward-to` durante el test (Stripe CLI) en vez de mockearlo, para probar el contrato real de firma/idempotencia de `api-rest-backend-v1.0.md` §7.
- Emails: Resend/Postmark en modo sandbox (capturan el envío sin entregarlo; el test lee el "email" desde la API de sandbox para extraer el link de confirmación de clave).
- Seed: el mismo `pnpm db:seed` del entorno de desarrollo (usuario admin, creador de ejemplo, Rey Aldric publicado) — un solo fixture para desarrollo y CI evita que diverjan.

### 3.3 Suites

| Spec | Qué recorre |
|---|---|
| `game.reyaldric.spec.ts` | 2 `BrowserContext` de Playwright (2 "jugadores" reales), se unen a la misma sesión, ejecutan la secuencia de 14 pasos del Rey Aldric a través de clics reales en el juego, assert `game_ended {result: 'victory'}` visible en UI. Contraparte de UI del fixture de `game-runtime` |
| `purchase-flow.spec.ts` | Catálogo → detalle de sala → checkout Stripe test → retorno → assert acceso concedido → jugar la primera sala sin clave |
| `event-flow.spec.ts` | Organizador crea evento → genera claves en lote → exporta PDF → un contexto de navegador "sin cuenta" canjea una clave del sandbox de email → juega parcialmente → el panel del organizador (otro contexto, rol organizador) refleja el progreso en tiempo real |
| `editor-publish.spec.ts` | Crear sala nueva, 2 pestañas coeditando (verifica que Yjs converge en UI, no solo en el backend), `validate()` en verde, `publish()`, la sala aparece en catálogo |
| `mcp-parity.spec.ts` *(nightly, no en cada PR — más lento)* | Construye una sala equivalente al Rey Aldric **vía MCP** (llamando a las tools, sin UI) y corre el mismo test de solvabilidad del §2 sobre el resultado — es la comprobación continua de la promesa "todo lo que el editor visual puede hacer, el MCP puede hacerlo" (§11 de especificaciones), no solo un caso de aceptación puntual |

### 3.4 En CI

- **Por PR:** `game.reyaldric.spec.ts` + `purchase-flow.spec.ts` (los dos más baratos y los que más frecuentemente rompen con cambios de protocolo/pagos).
- **Nightly (rama principal):** suite completa + `mcp-parity.spec.ts`.
- Un fallo en `game.reyaldric.spec.ts` bloquea el merge; un fallo nightly abre un ticket automático, no bloquea retroactivamente PRs ya mergeados.

---

## 4. Protocolo de playtest humano (beta cerrada)

El test de solvabilidad garantiza que la sala **se puede** completar; no dice si es **divertida, comprensible o si el ritmo es el esperado**. Eso solo se ve con personas.

### 4.1 Cuándo

Antes de abrir la beta cerrada, y en cada salto de fase mayor del roadmap. Requisito previo: el validador (§2) y la suite E2E (§3) en verde sobre el Rey Aldric y al menos 2–3 salas creadas por early creators reales (no solo staff) — el playtest humano es caro en tiempo de las personas, no se gasta en bugs que el automático ya habría cazado.

### 4.2 Muestra

- **5–8 grupos** de 2–4 jugadores (la regla de usabilidad de "5 usuarios encuentran ~80 % de los problemas" aplica igual de bien a un escape room que a una UI).
- Mezcla deliberada de perfiles: jugadores habituales de escape rooms físicos, profesores/organizadores potenciales (público objetivo real de los eventos), y personas que nunca han jugado uno — los tres ven problemas distintos.
- Reclutamiento inicial: red de contactos de Studio LXD (clientes docentes) + la propia comunidad de creadores de la beta.

### 4.3 Sesión

1. Consentimiento explícito de grabación (la sesión usa LiveKit igual que un evento real — doble uso: es dogfooding del propio producto de eventos).
2. El moderador se une como **organizador en modo observador** (`SpectatorRoom`, `protocolo-mensajes-colyseus.md` §1) — la misma feature que un profesor real usaría, no una herramienta de testing aparte.
3. Sin *think-aloud* forzado (rompe la cooperación real entre jugadores, que es justo lo que se quiere observar); el moderador toma notas de: momentos de silencio largo, repetición de intentos fallidos, cambios de estrategia, quién lidera vs. quién se queda fuera.
4. Entrevista corta post-partida (5–10 min): qué puzzle recuerdan con más cariño, cuál les frustró, si algo se sintió injusto (vs. "difícil pero justo").
5. Cuestionario breve (SUS o similar adaptado) — cuantifica lo cualitativo para comparar entre sesiones y entre salas.

### 4.4 Métricas capturadas

- **Tiempo real por puzzle vs. estimación del validador** (§2.5) — alimenta la calibración de las constantes de estimación.
- **Pistas usadas por puzzle** (de `progress_events`, ya instrumentado — el playtest reutiliza la analítica de producción, no un sistema aparte).
- **Señal de frustración automática**: ≥3 `puzzle_attempted` fallidos al mismo puzzle en <2 min → se marca la sesión para revisión aunque el moderador no lo anotara.
- **Abandono / desconexión.**
- Nº de veces que un jugador tuvo que ser "arrastrado" por el resto sin entender qué pasaba (nota cualitativa del moderador — señal de que una mecánica cooperativa no se explica sola).

### 4.5 Reporte y criterio de salida a beta

Cada hallazgo se etiqueta **bug** (algo no funciona como está diseñado → vuelve al backlog normal) o **diseño** (funciona como está diseñado, pero no funciona para el jugador → vuelve al creador de la sala o a la plantilla).

Criterios orientativos para pasar a beta cerrada:
- ≥ 80 % de los grupos completan la sala sin intervención del moderador más allá del sistema de pistas normal.
- El tiempo real medio cae dentro de ±30 % de `estimatedMinutes`.
- Cero soft-locks reales encontrados (si aparece uno, es bug bloqueante — el 🟡 del validador debería haberlo anticipado; si no lo hizo, es también un bug del validador).
- Ninguna mecánica cooperativa obligatoria dejó a un jugador completamente pasivo en más de un grupo.

---

## 5. Resumen de responsabilidades

| Capa | Bloquea `publish()` | Bloquea merge de PR | Bloquea apertura de beta |
|---|---|---|---|
| Unitario / integración | — | ✅ | — |
| Solvabilidad (hard check) | ✅ | ✅ (fixture Rey Aldric) | — |
| Solvabilidad (warnings 🟡) | ❌ (solo aviso) | — | — |
| E2E Playwright (PR subset) | — | ✅ | — |
| E2E Playwright (nightly completo) | — | ❌ (abre ticket) | ✅ debe estar en verde |
| Playtest humano | — | — | ✅ criterios de §4.5 |
