# Fase 2 — Cooperativo y comunicación (semanas 7–9)

**Objetivo:** las 8 plantillas + voz/webcam + chat; el escape room de referencia completo.
**Depende de:** Fase 1. **Hito:** el Rey Aldric completo, 4 jugadores con voz y webcam (demo grabable).

Referencias: `specs/06-plantillas-puzzle-mvp.md`, `specs/11-protocolo-multijugador.md`,
`specs/12-voz-y-webcam-livekit.md`, `specs/22-qa-y-pruebas.md`.

---

| # | Ticket | Detalle | Spec | Criterio de aceptación |
|---|---|---|---|---|
| 2.1 | **Chat en partida** | Mensajes por el WS de Colyseus, ventana móvil de 50, rate limit 2/s, filtro de lenguaje básico | `11` §4.4, `17` §3 | Dos jugadores chatean y ven el historial; el filtro marca un mensaje tóxico |
| 2.2 | **LiveKit + coturn** | Room de medios por `GameRoom`; firma de token en el join; tiles de webcam/mic en el overlay | `12` §1–4, `11` §8 | 4 jugadores se ven y oyen; el observador entra en solo-suscripción |
| 2.3 | **Plantilla `simultaneous_plates`** | Ventana temporal en servidor + objeto-puente (`cáliz`) para solitario | `06` §2.3 | Dos jugadores abren la puerta; con el cáliz, un jugador solo también |
| 2.4 | **Plantilla `memory`** | Asignación de símbolos por servidor + turnos | `06` §2.6 | Los 3 pares se resuelven; el cliente no conoce los símbolos antes de voltear |
| 2.5 | **Plantilla `split_clue`** | Oclusión/visión en Phaser + entrada React; espejo como puente | `06` §2.7 | Dos mirillas requieren dos jugadores; con el espejo, un jugador solo resuelve |
| 2.6 | **Plantilla `sliding_puzzle`** | Panel React + mezcla resoluble (paridad) + `fixed_seed` | `06` §2.5 | El mural 3×3 termina en orden; `seed 812` reproduce el mismo desorden |
| 2.7 | **Plantilla `pipes`** | Flood fill en servidor; flujo de agua animado en Phaser; `blockedCells` con `llave-oro` | `06` §2.8 | El agua llega al altar; sin `llave-oro`, la compuerta bloquea |
| 2.8 | **Rey Aldric completo** | Las 3 salas, 8 plantillas, código final `4538`, doble candado (canal + altar) | `reference/rey-aldric-notas-diseno.md` | Un grupo completa la sala en victoria siguiendo la ruta crítica de 14 pasos |
| 2.9 | **Validador + test de solvabilidad** | Forward chaining, oráculos por plantilla, warnings 🟡, estimación de ruta y duración | `22` §2 | El validador sobre el Rey Aldric reproduce el informe esperado; detecta un dead end artificial |
| 2.10 | **Modo solitario verificado** | Cada mecánica cooperativa con `soloBridgeItemId` se completa con 1 jugador | `22` §2.1 | Test de solvabilidad para `players.min = 1` pasa |
| 2.11 | **Prueba LiveKit Cloud vs. self-hosted** | Tráfico real entre móvil, wifi doméstica y red corporativa simulada; decidir con el criterio de `specs/12` §2.2 | `12` §2.2 | Informe con tasa de fallo de conexión; decisión documentada |
| 2.12 | **E2E del Rey Aldric (protocolo)** | `e2e.reyaldric.spec.ts`: 2 clientes de test completan la ruta y hacen assert de victoria | `22` §3.1 | Corre en cada PR y bloquea el merge si falla |

## Hito 2

El escape room de referencia completo, 4 jugadores con voz y webcam. Demo grabable. El validador
está en verde sobre el Rey Aldric y el test de solvabilidad pasa.

## Riesgo vigilado

LiveKit self-hosted vs. Cloud se decide **en esta fase**, no al final (ticket 2.11) — es el riesgo
técnico con más probabilidad de dolor en redes educativas/corporativas.
