# Fase 3 — Editor visual (semanas 10–14)

**Objetivo:** editor visual colaborativo con validador y publicación.
**Depende de:** Fase 2 (runtime + validador probados). **Hito:** un creador sin ayuda construye una
sala de 1–2 habitaciones y la publica.

Referencias: `specs/09-editor-de-salas.md`, `specs/08-formato-roompackage.md`,
`specs/13-api-rest.md` §4, `specs/15-audio-y-creditos-ia.md`.

---

| # | Ticket | Detalle | Spec | Criterio de aceptación |
|---|---|---|---|---|
| 3.1 | **Runtime modo edición** | Flag `mode: 'edit'`: selección, drag, palette de tiles y objetos | `09` §1, §3 | Se pinta una sala y se colocan objetos desde la palette sobre el runtime real |
| 3.2 | **Yjs backend** | Persistencia de updates en `room_updates`, snapshots (`room_snapshots`), API de draft | `09` §2, `13` §4 | Al reabrir el editor el doc se reconstruye exactamente |
| 3.3 | **Colaboración** | Awareness (cursores, quién edita qué), autosave, reconexión offline, historial/restauración | `09` §2 | Dos pestañas coeditan y convergen; desconectar y reconectar mergea sin conflictos |
| 3.4 | **Inspector de propiedades** | Panel contextual de objetos/puzzles/reglas dirigido por tipo | `09` §4.1 | Click en un objeto muestra y edita sus propiedades |
| 3.5 | **Configuradores de plantillas** | Los 8 puzzles configurables con **los mismos componentes React que en juego** | `09` §1, `06` | Configurar un candado en el editor se ve idéntico a jugarlo |
| 3.6 | **Grafo de reglas (React Flow)** | Vista nodo `trigger → condiciones → acciones`; crear/editar/conectar | `09` §4.2 | Se crea la regla del brasero arrastrando nodos |
| 3.7 | **Validador en el editor** | Resaltado de nodos con problemas, warnings y estimación de duración en vivo | `09` §5, `22` §2 | El editor marca un objeto huérfano y un dead end |
| 3.8 | **Playtest** | Room temporal de Colyseus desde el editor + link de prueba para un amigo | `09` §3 | "Jugar" abre la sala en modo play sin publicar; el link funciona |
| 3.9 | **Publicación** | Draft vs. versiones (`room_versions`), empaquetado de assets a R2, `assets_hash`, `packageFormat` | `08` §5–6, `13` §4 | Publicar congela la versión; `validate` se repite server-side |
| 3.10 | **Multidioma del editor** | `languages`/`defaultLanguage` + selector de idioma por campo de texto (`LocalizedText`) | `08` §2.2 | Un diálogo tiene texto en `es` y `en` y el catálogo filtra por idioma |
| 3.11 | **Audio: biblioteca + subida propia** | Campos de audio en diálogos/pistas/efectos; biblioteca incluida; subida con moderación previa | `15` §1, `17` §1 | Se añade música de biblioteca y un MP3 propio (pasa por cola humana antes de usarse) |
| 3.12 | **Admin: settings y pricing** | `GET/PATCH /api/admin/settings/:key` y `/api/admin/pricing-tiers` | `13` §10, `02` §3.2 | Se cambia `max_players_per_room` y una fila de tramo sin romper histórico |

## Hito 3

Un creador sin ayuda construye una sala de 1–2 habitaciones con puzzles y reglas, la prueba y la
publica; aparece en el catálogo.

## Paralelizable

- **Moderación previa de assets (3.11):** aunque la cola humana completa llega en Fase 6, la subida
  con revisión básica se necesita aquí.
- **Precios y settings (3.12):** puede adelantarse antes si la Fase 5 va en paralelo.
