# Catálogo de plantillas (23)

Tabla comparativa de las **8 plantillas del MVP** (`specs/06-plantillas-puzzle-mvp.md`) y las
**15 de v2** (`specs/07-plantillas-puzzle-v2.md`).

## MVP (8)

| # | Tipo | Nombre | Capa | Validación en servidor | Multi-solución |
|---|---|---|---|---|---|
| 1 | `hidden_key` | Llave escondida | world (Phaser) | Click en escondite válido → otorga item | ❌ |
| 2 | `code_lock` | Candado numérico | panel (React) | Compara código (secreto solo en servidor); intentos + lockout | ❌ |
| 3 | `simultaneous_plates` | Botones simultáneos | world (Phaser) | Todas las placas activas dentro de `windowMs`; `soloBridgeItemId` fija una | — |
| 4 | `combine_items` | Combinar objetos | panel (React) | Recetas: valida posesión → consume/otorga | ✅ (varias recetas) |
| 5 | `sliding_puzzle` | Puzle deslizante | panel (React) | Orden de piezas; mezcla resoluble (paridad) | ❌ |
| 6 | `memory` | Memoria | panel (React) | Parejas y turnos; símbolos asignados por servidor | ❌ |
| 7 | `split_clue` | Pista dividida | híbrido | El servidor decide fragmentos visibles por posición; espejo como puente | ❌ |
| 8 | `pipes` | Tuberías | panel (React) | Flood fill start→end | ✅ |

## v2 (15)

| # | Tipo | Nombre | Capa | Validación en servidor | Multi-solución |
|---|---|---|---|---|---|
| A1 | `sequence_music` | Secuencia musical | React | Comparación de secuencia | ❌ |
| A2 | `balance_scale` | Pesas y balanza | React | Pesos secretos + comparación final | ❌ |
| A3 | `symbol_sudoku` | Sudoku de símbolos | React | Comparación / reglas parciales | ❌ |
| A4 | `timing_press` | Reflejos / timing | React | Timestamp corregido + patrón server-seeded | ❌ |
| A5 | `matchsticks` | Palillos | React | Parser de ecuación + alcanzabilidad | ✅ (parcial) |
| A6 | `word_search` | Sopa de letras | React | Generación por sesión, comparación de selección | ✅ (muchas) |
| A7 | `circuit_board` | Circuito | React | Flood fill eléctrico | ✅ |
| B1 | `relay_activation` | Relé de activación | Phaser + React | Ventana temporal de puerta | — |
| B2 | `mirror_copy` | Simetría | React ×2 roles | Comparación de rejilla por rol | ❌ |
| B3 | `split_clue_multi` | Info dividida N | Híbrido | Visión por jugador + código | ❌ |
| B4 | `team_split` | Desafío por equipos | React ×2 + Phaser | Agregación de sub-puzzles | — |
| C1 | `light_mirrors` | Luz y espejos | Phaser | Simulación de rayo (BFS) | ✅ |
| C2 | `multi_lock` | Multi-cerradura | Phaser | Secuencia + ventana | — |
| C3 | `gear_mechanism` | Engranajes | Phaser | Grafo de rotaciones | ❌ |
| C4 | `rising_water` | Agua que sube | Phaser + reglas | Timers del motor de reglas | — |

## Patrones transversales

1. **Sub-puzzle:** B4 (`teamPuzzles`) y C2 (`locks[]`) **referencian otras plantillas**. El
   validador comprueba referencias cruzadas.
2. **Simuladores compartidos:** C1 y C3 requieren simulación por pasos; A5 precomputa
   permutaciones. Viven en `packages/shared/simulators` y los reutilizan runtime, validador y MCP.
3. **Estado `failed`:** en A2, A4 y C4 puede ser final o recuperable
   (`failBehavior: 'permanent' | 'cooldown'`).
4. **Firma común de componentes React:** `{ definition, runtime, onSubmit, state }`.
5. **Prioridad de construcción post-MVP:** A7 → C1 → B4 → resto.
