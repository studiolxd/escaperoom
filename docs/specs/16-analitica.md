# 16 — Analítica

Depende de `11-protocolo-multijugador.md` (§10, puntos de instrumentación) y
`14-modelo-de-datos-sql.md` (§8, `analyticsEvent`).

---

## 1. Principio

**Nada de analítica solo en cliente:** sesgos y ad-blockers. Los eventos se emiten desde el
servidor (Colyseus y Next API) a un endpoint de colección → cola Redis → worker → tabla
`analyticsEvent` (append-only). Nunca bloquea el game loop: si la cola cae, se pierde
analítica, nunca gameplay.

Agregaciones en BI ligero (Metabase) o ClickHouse si escala.

## 2. Taxonomía de eventos

### 2.1 Jugador y sesión

```
user_registered
onboarding_step                  { step }
room_playtest_started
session_started
player_joined                    { room_id, session_id, player_n, via: purchase|key|invite }
session_ended                    { result: victory|timeout|abandon, duration_sec, puzzles_solved, hints_used }
```

### 2.2 Gameplay (cada puzzle)

```
puzzle_available                 { puzzle_id, type, room_id }
puzzle_attempted                 { puzzle_id, attempt_n }
puzzle_solved                    { puzzle_id, type, duration_since_available, attempts, hints_used_before }
puzzle_failed                    { puzzle_id, reason: attempts|timeout }
hint_viewed                      { puzzle_id, tier }
item_granted                     { item_id, source: puzzle|recipe|world }
item_combined                    { inputs, output, success }
dialog_read                      { dialog_id }
```

### 2.3 Claves y eventos

```
event_created                    { n_sessions, n_keys, price_total }
key_sent                         { via: email|bulk|print }
key_confirmed
key_redeemed                     { assigned_session }
key_expired_unused
session_group_assigned           { mode: specific|random|free }
organizer_panel_viewed
```

### 2.4 Negocio

```
room_published                   { n_puzzles, n_rooms }
room_version_published           { version }
purchase_completed               { type: room|room_license|event|credits, amount, revenue_split }
credit_purchased                 { pack }
credit_spent                     { service: elevenlabs, units }
review_submitted                 { rating }
```

## 3. Funnels clave

| Funnel | Pasos |
|---|---|
| Adquisición creador | visita → registro → wizard iniciado → sala creada → publicada |
| Adquisición jugador | visita catálogo → sala vista → compra/evento → primera partida → segunda partida |
| Eventos B2B | organizador registrado → evento creado → claves enviadas → % confirmadas → % canjeadas → % jugadas → repetición |

## 4. Métricas norte

- **Salas publicadas / creador / mes.**
- **% de sesiones completadas.**
- **Tiempo medio por puzzle** — con **alerta automática**: si un puzzle concreto de una sala
  tiene tasa de abandono > 40 %, se genera un report automático al creador (`puzzle_solved` vs
  `puzzle_attempted`/`puzzle_failed`).
- **ARPU de evento.**
- **% de claves confirmadas.**

## 5. Implementación

- Punto de colección: endpoint server-side que recibe lotes desde Colyseus y Next API.
- `analyticsEvent` particionada por mes desde el día uno (ver `specs/14-modelo-de-datos-sql.md` §8).
- Retención: 24 meses en detalle; agregados anonimizados sin límite después. **Job de purga
  pendiente** (Fase 6).
- Instrumentar desde la Fase 1 (eventos de gameplay) aunque los dashboards lleguen en Fase 5–6 —
  cambiar analítica a posteriori cuesta carísimo.

## 6. Métricas de la propia estrategia de contenido

Distintas de las de producto (ver `specs/25-estrategia-de-contenido-y-lanzamiento.md` §4):
salas oficiales publicadas, tráfico orgánico, tasa de conversión organizador→creador, referidos.

## 7. Dependencias

- `specs/11-protocolo-multijugador.md` §10 — dónde se emite cada evento.
- `specs/14-modelo-de-datos-sql.md` §8 — tabla y particiones.
