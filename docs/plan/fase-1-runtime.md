# Fase 1 — Runtime de juego (semanas 3–6)

**Objetivo:** una sala estática jugable de principio a fin.
**Depende de:** Fase 0. **Hito:** la Sala 1 del Rey Aldric jugable 1–4 jugadores, con llave,
candado, combinación e inventario.

Referencias: `specs/04-runtime-juego-y-mundo.md`, `specs/05-motor-de-reglas-y-estado.md`,
`specs/06-plantillas-puzzle-mvp.md`, `specs/08-formato-roompackage.md`.

---

| # | Ticket | Detalle | Spec | Criterio de aceptación |
|---|---|---|---|---|
| 1.1 | **RoomPackage loader** | Carga, valida y aplica el `RoomPackage` (meta, map, objects, items, dialogs) al runtime | `08` | El runtime carga el Rey Aldric y renderiza sus 3 habitaciones (aunque solo la 1 sea jugable) |
| 1.2 | **Tilemap isométrico + pack gráfico v1** | 1 tileset medieval de referencia; cámara, depth-sort, colisiones; **encargar el pack (~35 tiles + ~20 sprites + atlas de avatar)** | `04` §8 | Sala 1 renderizada con tiles, decoración y colisiones; avatares atraviesan puertas |
| 1.3 | **Objetos interactuables (`WorldObject`)** | Estados con sprite/animación, brillo al pasar el cursor, diálogos de inspección, objetos con inventario interno (`distribution`) | `04` §3 | Inspeccionar el cuadro/brasero muestra diálogo; el armario "contiene" items |
| 1.4 | **Motor de reglas v1** | `GameState`, flags, prioridad, transaccionalidad, `once`/`repeatable`, `delay`, timers, idempotencia y guías; vocabulario MVP | `05` | Las reglas del Rey Aldric del Salón disparan en orden y son idempotentes; test unitario del motor en verde |
| 1.5 | **Plantilla `hidden_key`** | Escondite + reveal + otorgar item | `06` §2.1 | El cuadro de Aurelio entrega `llave-bronce` con animación `shake` |
| 1.6 | **Plantilla `code_lock`** | `<CodeLockPuzzle>` + validación servidor + `maxAttempts`/`lockoutSec`; el código nunca viaja al cliente | `06` §2.2 | El candado `4732` abre; 5 fallos bloquean 30 s; inspeccionar el cliente no revela el código |
| 1.7 | **Plantilla `combine_items`** | `<InventoryPanel>` drag & drop + recetas en servidor | `06` §2.4 | `mechero+vela→antorcha`; `llave-plata→llave-oro` (sin consumir) |
| 1.8 | **Sistema de pistas y diálogos** | `hints` con tiers y coste, `hint_request`, `dialog_show`, `LocalizedText` en `es` | `05` §3, `08` §2.3 | Pedir pista descuenta del contador y muestra el texto del tier correcto |
| 1.9 | **Fin de partida** | Cronómetro (`start_timer`), `end_game` (victory/timeout), pantalla de resultados | `04` §6 | Un flujo de prueba termina en victoria/timeout y muestra stats |
| 1.10 | **Rey Aldric Sala 1 vertical** | Construir la Sala 1 completa a mano en JSON (llave, candado, combinación, placas pendientes o incluidas) | `reference/roompackage-rey-aldric.v1.json` | Un test de integración recorre la Sala 1 de principio a fin |
| 1.11 | **Analítica de gameplay** | Emitir `puzzle_available/attempted/solved/failed`, `hint_viewed`, `item_granted/combined`, `dialog_read` | `16` §2.2 | Los eventos aparecen en `analytics_events` durante una partida de prueba |

## Hito 1

La Sala 1 del Rey Aldric se juega de principio a fin con 1–4 jugadores: cuarto → llave → armario →
combinación → brasero → candado → cáliz, con pistas, diálogos y fin de partida.

## Paralelizable

- **Encargo del pack gráfico (1.2):** iniciar en la semana 1 (plazo externo).
- **Contenido narrativo** de las salas 2–3 (guion y diálogos) puede prepararse mientras se construye
  el runtime.
