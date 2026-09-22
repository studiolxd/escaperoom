# EscapeRoom Creator — Roadmap de desarrollo y tickets

Acompaña a `especificaciones-escape-room-creator-v1.0.md`. Cada fase termina con un hito demostrable. Prioridad: validar el núcleo (runtime + 8 plantillas) lo antes posible.

---

## Fase 0 — Cimientos (semana 1–2)

Objetivo: monorepo listo y "Hola mundo" isométrico multijugador.

| # | Ticket | Detalle |
|---|---|---|
| 0.1 | Monorepo + tooling | pnpm workspaces + Turborepo; `packages/{web, game-runtime, colyseus-server, shared}`; TS estricto, ESLint/Prettier, GH Actions (lint+test+build) |
| 0.2 | Infra local | Docker Compose: PostgreSQL, Redis, MinIO (S3 local); migraciones (Drizzle o Prisma) |
| 0.3 | Auth | Auth.js: email mágico + Google; tabla `users`, roles básicos |
| 0.4 | Canvas híbrido | Next.js monta Phaser en `<GameCanvas>`; overlay React con `pointer-events`; store Zustand compartido |
| 0.5 | Movimiento multijugador | Colyseus room `lobby_test`: 2 clientes mueven avatares isométricos y se ven en tiempo real |

**Hito 0:** dos navegadores mueven avatares en un tilemap isométrico sincronizado.

---

## Fase 1 — Runtime de juego (semana 3–6)

Objetivo: una sala estática jugable de principio a fin.

| # | Ticket | Detalle |
|---|---|---|
| 1.1 | RoomPackage loader | Definir schemas Zod en `shared` (meta, map, objects, items, dialogs); descarga y validación |
| 1.2 | Tilemap isométrico | 1 tileset medieval de referencia; cámara, depth-sort, colisiones |
| 1.3 | Objetos interactuables | Sistema `WorldObject` con estados, brillo al pasar cursor, diálogos de inspección |
| 1.4 | Plantilla 1: llave escondida | Escondites + reveal + otorgar item |
| 1.5 | Plantilla 2: candado numérico | `<CodeLockPuzzle>` React + validación en servidor + intentos/lockout |
| 1.6 | Plantilla 4: combinar objetos | Inventario React + recetas en servidor |
| 1.7 | Motor de reglas v1 | Trigger/condition/action (vocabulario MVP); evaluación en Colyseus server |
| 1.8 | Fin de partida | Cronómetro, resolución final, pantalla de resultados |
| 1.9 | Rey Aldric vertical | Construir la Sala 1 completa a mano en JSON como prueba |

**Hito 1:** la Sala 1 del Rey Aldric jugable 1–4 jugadores, con llave, candado, combinación y placas.

---

## Fase 2 — Comunicación y cooperativo (semana 7–9)

| # | Ticket | Detalle |
|---|---|---|
| 2.1 | Chat en partida | Mensajes por el WS de Colyseus |
| 2.2 | LiveKit | Room de medios vinculada a room de partida; tiles de webcam/mic en overlay |
| 2.3 | Plantilla 3: botones simultáneos | Ventana temporal en servidor + objeto-puente |
| 2.4 | Plantilla 6: memoria | Asignación de símbolos por servidor, turnos |
| 2.5 | Plantilla 7: pista dividida | Visión por posición (occlusión Phaser) + entrada React |
| 2.6 | Plantilla 5: deslizante | Panel React, mezcla resoluble |
| 2.7 | Plantilla 8: tuberías | Flood fill en servidor; flujo de agua en Phaser |
| 2.8 | Rey Aldric completo | Las 3 salas, 8 plantillas, código final |

**Hito 2:** el escape room de referencia completo, 4 jugadores con voz y webcam. Demo grabable.

---

## Fase 3 — Editor visual (semana 10–14)

| # | Ticket | Detalle |
|---|---|---|
| 3.1 | Runtime modo edición | Flag `mode:'edit'`: selección, drag, palette de tiles y objetos |
| 3.2 | Yjs backend | Persistencia de updates en PostgreSQL, snapshots, API de doc |
| 3.3 | Colaboración | Awareness (cursores), autosave, reconexión offline |
| 3.4 | Inspector de propiedades | Panel contextual de objetos/puzzles |
| 3.5 | Configuradores de plantillas | Los 8 puzzles configurables con sus componentes React |
| 3.6 | Grafo de reglas | Vista nodo trigger→condición→acción |
| 3.7 | Validador | Objetos huérfanos, dead ends, pistas, estimación de duración |
| 3.8 | Playtest | Room temporal desde el editor + link de prueba |
| 3.9 | Publicación | Draft vs. versiones, empaquetado de assets a R2/MinIO |

**Hito 3:** un creador sin ayuda construye una sala de 1–2 salas y la publica.

---

## Fase 4 — MCP del creador (semana 15–16)

| # | Ticket | Detalle |
|---|---|---|
| 4.1 | Servidor MCP | `@modelcontextprotocol/sdk`, stdio + HTTP streamable |
| 4.2 | Toolset estructura/contenido | create_room, set_map, paint_tiles, add_object, add_puzzle, add_dialog, add_hint |
| 4.3 | Toolset lógica/consulta | add_rule, get_room_graph, get_room + vistas filtradas |
| 4.4 | Dry-run + errores accionables | Validador incremental en cada mutación |
| 4.5 | validate/preview/publish | Checklist + confirmación humana |
| 4.6 | Chat en web | UI conversacional en Next.js contra el MCP por HTTP |
| 4.7 | Test E2E | Construir el Rey Aldric entero por chat (criterio de aceptación) |

**Hito 4:** "crea una escape room medieval de 3 salas" → sala jugable en <30 min de conversación.

---

## Fase 5 — Negocio: pagos y eventos (semana 17–20)

| # | Ticket | Detalle |
|---|---|---|
| 5.1 | Stripe | Checkout de sala (B2C) con Connect (reparto 70/30) |
| 5.2 | Catálogo | Listado, fichas, reseñas, SEO SSR |
| 5.3 | Eventos | Creación de evento, precios por tramos, hasta 10 sesiones |
| 5.4 | Claves | Generación individual/masiva/rotativa; estados y caducidades |
| 5.5 | Emails | Invitaciones (Resend/Postmark), confirmación opcional, reenvío |
| 5.6 | PDF tarjetas | Tarjetas imprimibles por lote |
| 5.7 | Canje y grupos | Canje de clave, asignación específica/aleatoria/libre |
| 5.8 | Panel organizador | Sesiones en vivo, progreso por grupo, ranking, gestión de claves |
| 5.9 | Modo observador/jugador del organizador | Espectador entre sesiones |

**Hito 5:** un profesor compra un evento de 30 claves, las reparte, confirma asistencias y supervisa las partidas en vivo. Primer cobro real end-to-end.

---

## Fase 6 — Endurecimiento y lanzamiento (semana 21–24)

| # | Ticket | Detalle |
|---|---|---|
| 6.1 | Moderación | Reportes, cola de revisión, retirada de salas |
| 6.2 | Rate limiting y seguridad | Redis, CSP, auditoría de endpoints |
| 6.3 | Observabilidad | Logs, métricas, alertas (p. ej. Uptime Kuma + Sentry) |
| 6.4 | Testing | E2E (Playwright): partida completa, flujo de compra, flujo de evento |
| 6.5 | i18n es/en | Extraer textos del web |
| 6.6 | Landing + onboarding creador | Tutorial guiado, plantillas de ejemplo |
| 6.7 | Beta cerrada | 5–10 creadores reales, feedback, iteración |
| 6.8 | Lanzamiento público | |

---

## Dependencias críticas (resumen)

```
Fase 0 ──> Fase 1 ──> Fase 2 ──> Fase 3 ──> Fase 4
                              └──> Fase 5 (puede ir en paralelo desde Fase 2)
Fase 2 + Fase 5 ──> Fase 6 (lanzamiento)
```

## Equipo estimado

Mínimo viable: 1 full-stack TS sénior (Fases 0–2), +1 (Fases 3–4), +1 (Fases 5–6). Con un solo desarrollador: 8–10 meses; con tres: el roadmap es realista en ~6 meses.

## Riesgos principales

| Riesgo | Mitigación |
|---|---|
| LiveKit self-hosted da problemas de red (NAT) | LiveKit Cloud como plan B; probar en Fase 2, no al final |
| El editor visual se dispara en esfuerzo | Construir primero el MCP y el formato JSON; el editor visual se apoya en ambos |
| Colyseus con 10 sesiones simultáneas | Prueba de carga en Fase 5; escalar con Redis adapter |
| Trampas en cliente | Regla inquebrantable: validación siempre en servidor (revisión de código obligatoria en PRs) |
