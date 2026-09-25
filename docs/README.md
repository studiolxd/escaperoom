# EscapeRoom Creator — Documentación de producto y desarrollo

Repositorio de especificaciones y plan de implementación del SaaS de creación y juego de
escape rooms online 2D isométricos cooperativos (1–N jugadores), desde navegador.

Este `README` es el **punto de entrada**. Los documentos de la conversación de diseño original se
consolidaron por completo en `docs/specs/`, `docs/reference/` y `docs/plan/`; el archivo histórico
`docs/_archive/` se eliminó (el contenido vive ya en los documentos consolidados).

---

## Estructura

```
docs/
├── README.md                  ← este índice
├── specs/                     ← especificaciones consolidadas (fuente de verdad)
├── plan/                      ← plan de implementación por fases y tickets
├── reference/                 ← material de referencia (fixture, catálogos, ADR, reutilización SLXD)
└── notas/                     ← notas de trabajo fechadas (sesiones, decisiones pendientes de revisar)
```

Regla de oro del repositorio: **`docs/specs/` es la única fuente de verdad.** Si algo no está
en `specs/`, no existe para desarrollo. Cualquier cambio de diseño se refleja primero aquí y
después en código.

---

## Índice de especificaciones (`docs/specs/`)

| # | Documento | Contenido |
|---|---|---|
| 01 | [Visión y alcance](specs/01-vision-y-alcance.md) | Problema, propuesta de valor, actores y roles, alcance v1 / fuera de alcance, sala de referencia |
| 02 | [Modelo de negocio](specs/02-modelo-de-negocio.md) | Venta B2C (una partida), eventos B2B/Edu, claves, licencias entre creadores, créditos IA, tramos de precio, panel del organizador |
| 03 | [Arquitectura y stack](specs/03-arquitectura-y-stack.md) | Stack, monorepo, arquitectura híbrida Phaser/React, infraestructura y entornos |
| 04 | [Runtime de juego y mundo](specs/04-runtime-juego-y-mundo.md) | Tilemap isométrico, avatares, cámara, objetos del mundo, interacciones, fases de partida y fin de juego |
| 05 | [Motor de reglas y estado](specs/05-motor-de-reglas-y-estado.md) | `GameState`, flags, prioridad, transaccionalidad, delays, timers, idempotencia |
| 06 | [Plantillas de puzzle (MVP)](specs/06-plantillas-puzzle-mvp.md) | Las 8 plantillas del MVP, esquemas, estados y validación en servidor |
| 07 | [Plantillas de puzzle (v2)](specs/07-plantillas-puzzle-v2.md) | Las 15 plantillas ampliadas, oráculos de solvabilidad y anti-trampa |
| 08 | [Formato RoomPackage](specs/08-formato-roompackage.md) | Contrato único editor/API/BD/MCP/runtime, multidioma, vocabulario de reglas, versionado |
| 09 | [Editor de salas](specs/09-editor-de-salas.md) | Arquitectura, Yjs, draft vs publicado, validador, componentes React y React Flow |
| 10 | [MCP del creador](specs/10-mcp-del-creador.md) | Toolset completo, transporte, auth, dry-run, errores accionables, paridad con el editor |
| 11 | [Protocolo multijugador](specs/11-protocolo-multijugador.md) | Rooms de Colyseus, fases, mensajes, errores, join, reconexión, rate limiting, permisos, analítica embebida |
| 12 | [Voz y webcam (LiveKit)](specs/12-voz-y-webcam-livekit.md) | Topología de rooms, despliegue, ancho de banda, cámara por defecto, grabación y consentimiento |
| 13 | [API REST](specs/13-api-rest.md) | Superficie REST pública (catálogo, checkout, eventos/claves, PDF, webhooks, moderación); la UI usa tRPC y el MCP comparte servicios (ADR-022) |
| 14 | [Modelo de datos SQL](specs/14-modelo-de-datos-sql.md) | DDL completo y migraciones (usuarios/orgs, créditos, salas/Yjs, eventos/claves, compras, progreso, moderación) |
| 15 | [Audio y créditos IA](specs/15-audio-y-creditos-ia.md) | Biblioteca, subida propia, ElevenLabs, ledger de créditos, moderación de audio |
| 16 | [Analítica](specs/16-analitica.md) | Taxonomía de eventos, funnels, métricas norte, implementación server-side |
| 17 | [Moderación de contenido](specs/17-moderacion-de-contenido.md) | Pre-check automático, cola humana, SLA por severidad, strikes, apelaciones, menores |
| 18 | [Legal, RGPD y menores](specs/18-legal-rgpd-y-menores.md) | TOS, licencia UGC, RGPD/LOPDGDD, protección de menores, checklist previo a producción |
| 19 | [UX de pantallas clave](specs/19-ux-pantallas-clave.md) | Lobby, panel del organizador en vivo, canje de clave del invitado |
| 20 | [Onboarding del creador](specs/20-onboarding-del-creador.md) | Wizard de 5 pasos, sala de ejemplo, ayuda contextual, medición |
| 21 | [Ranking y clasificaciones](specs/21-ranking-y-clasificaciones.md) | Ranking por sala, categorías, modo clasificación, anti-cheat |
| 22 | [QA y pruebas](specs/22-qa-y-pruebas.md) | Pirámide de tests, test de solvabilidad, E2E Playwright, playtest humano |
| 23 | [Motor v2, marketplace y API pública](specs/23-motor-v2-marketplace-y-api-publica.md) | Ambición post-MVP, licencias de salas, API pública/webhooks (puntos 9–12) |
| 24 | [Operaciones y escalabilidad](specs/24-operaciones-y-escalabilidad.md) | Dos tipos de pico, cuellos de botella, señales de escalado, observabilidad |
| 25 | [Estrategia de contenido y lanzamiento](specs/25-estrategia-de-contenido-y-lanzamiento.md) | Salas oficiales semilla, calendario de marketing, comunidad de creadores |
| 26 | [Pack gráfico v1](specs/26-pack-grafico-v1.md) | Brief y contrato de entrega del pack `medieval-v1` (tileset, sprites, avatar, FX, manifiesto) |

## Índice del plan (`docs/plan/`)

| Documento | Contenido |
|---|---|
| [Plan maestro](plan/00-plan-maestro.md) | Fases, dependencias, equipo, estimación, riesgos y criterios de hito |
| [Fase 0 — Cimientos](plan/fase-0-cimientos.md) | Monorepo, infra local, auth, canvas híbrido, movimiento multijugador |
| [Fase 1 — Runtime de juego](plan/fase-1-runtime.md) | RoomPackage, tilemap, objetos, motor de reglas, primeras plantillas, Rey Aldric Sala 1 |
| [Fase 2 — Cooperativo y comunicación](plan/fase-2-cooperativo.md) | Chat, LiveKit, plantillas restantes, Rey Aldric completo |
| [Fase 3 — Editor visual](plan/fase-3-editor.md) | Modo edición, Yjs, inspector, grafo de reglas, validador, publicación |
| [Fase 4 — MCP del creador](plan/fase-4-mcp.md) | Servidor MCP, toolset, dry-run, chat en web, test E2E por conversación |
| [Fase 5 — Negocio](plan/fase-5-negocio.md) | Stripe, catálogo, eventos, claves, emails, PDF, panel, licencias |
| [Fase 6 — Endurecimiento y lanzamiento](plan/fase-6-endurecimiento-y-lanzamiento.md) | Moderación, seguridad, analítica, legal, i18n, beta, lanzamiento |
| [Trazabilidad](plan/00-trazabilidad.md) | Matriz spec ↔ ticket ↔ hito, y correspondencia con los documentos archivados |

## Índice de referencia (`docs/reference/`)

| Documento | Contenido |
|---|---|
| [Registro de decisiones (ADR)](reference/registro-de-decisiones.md) | Por qué cada tecnología y cada alternativa descartada |
| [Reutilización de SLXD](reference/reutilizacion-slxd.md) | Qué se copia/adapta de SLXD, qué se descarta y la poda del compose |
| [RoomPackage Rey Aldric (JSON)](reference/roompackage-rey-aldric.v1.json) | Fixture jugable de referencia (contrato del runtime y de los tests) |
| [Notas de diseño del Rey Aldric](reference/rey-aldric-notas-diseno.md) | Decisiones finas, informe de validación esperado, uso como fixture |
| [Catálogo de plantillas](reference/catalogo-plantillas.md) | Tabla comparativa de las 23 plantillas (8 MVP + 15 v2) |
| [Catálogo de ideas de puzzles](reference/catalogo-ideas-puzzles.md) | Repertorio original de minijuegos y puzzles (fuente de futuras plantillas) |
| [Seguridad](reference/seguridad.md) | Rate limiting (tabla por ruta y por mensaje de partida), CSP y cabeceras, auditoría de admin (ticket 6.3) |
| [Rotación de secretos](reference/rotacion-de-secretos.md) | Procedimiento y efecto de rotar cada secreto (join token, playtest, confirmación, OAuth…) |

## Notas de trabajo (`docs/notas/`)

Notas fechadas de sesiones de trabajo. No son fuente de verdad: lo que se decida en ellas se lleva a
`specs/`, `plan/` o al registro de decisiones.

| Nota | Contenido |
|---|---|
| [Noche 2026-09-23](notas/2026-09-23-noche-decisiones.md) | Sesión autónoma de agentes: PR integrados, decisiones tomadas por el coordinador y pendientes para revisar |
| [Auditoría 2026-09-24](notas/2026-09-24-auditoria-seguridad-y-calidad.md) | Auditoría de seguridad, completitud, malas prácticas y rendimiento de todo el monorepo: hallazgos por área con fichero:línea, prioridades y plan de PRs para el agente que corrija |

---

## Convenciones de lectura

- Los tipos TypeScript de los esquemas se escriben como **especificación de contrato**; su
  implementación real son esquemas Zod en `packages/shared`.
- Los identificadores de puzzles, objetos e items son **IDs legibles** (`arca-trono`,
  `p-llave-cuadro`). Se referencian tal cual en specs y código.
- Toda validación de juego ocurre **en el servidor**. Cuando una spec describe una validación
  de cliente es solo UX; la verdad está siempre en `specs/11-protocolo-multijugador.md`.
- Los documentos numerados se pueden leer en orden, pero cada uno es autónomo y declara sus
  dependencias al inicio.

## Decisiones pendientes abiertas

Estas quedan explícitamente sin cerrar y se listan para no perderlas de vista:

| Tema | Dónde se resolverá |
|---|---|
| Titularidad del audio ElevenLabs, plazos fiscales, plantilla de DPA | Asesoría legal; ver `specs/18-legal-rgpd-y-menores.md` |
| Job de purga de `analyticsEvent` | Fase 6; ver `specs/14-modelo-de-datos-sql.md` |
