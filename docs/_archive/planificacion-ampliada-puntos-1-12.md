# EscapeRoom Creator — Planificación ampliada (puntos 1–12)

Complementa `especificaciones-escape-room-creator-v1.0.md` y `roadmap-desarrollo-tickets.md`. Estado: propuesta de planificación cerrada, lista para incorporar a desarrollo.

---

## 1. Motor de reglas y estado global

El motor de reglas es el corazón del runtime. Se evalúa **siempre en el servidor** (Colyseus) sobre el estado de partida. Decisiones de diseño:

### 1.1 Variables y flags de partida

Cada partida tiene un `GameState` con:

```typescript
interface GameState {
  flags: Map<string, boolean | number | string>;   // flags genéricas del creador
  puzzleStates: Map<string, PuzzleRuntime>;          // de la spec base
  inventory: Map<playerId, string[]>;                // inventarios
  objectStates: Map<string, string>;                 // estado de cada WorldObject
  timers: Map<string, TimerState>;                   // timers activos
  hintsUsed: Map<puzzleId, number>;                  // pistas consumidas por puzzle
  startedAt: number;
  timeLimitSec?: number;
}
```

- Los flags son **libres**: el creador los nombra (`brasero_encendido`, `fase_final`). Las reglas los leen y escriben.
- Flags reservadas del sistema: `game_started`, `game_ended`, `time_remaining`.

### 1.2 Orden de evaluación y prioridad

- Las reglas se evalúan tras cada evento (trigger) en orden de prioridad (campo `priority: number`, default 0; mayor primero; empate = orden de creación).
- **Transaccionalidad:** si un trigger dispara N reglas, todas se evalúan sobre el estado resultante de aplicar las anteriores, en el mismo tick. Si una acción falla (p. ej. `consume_item` de un item que no existe), la regla aborta y se registra; no se aplica a medias.
- Una regla puede encadenar otra (acción → nuevo evento interno → nuevas reglas). Límite de recursión: 32 saltos (protección contra bucles infinitos de diseño).

### 1.3 Reglas con retraso y temporizadores

```typescript
{ type: "delay", seconds: 3, actions: [...] }        // dentro de actions
{ type: "start_timer", id: "luces", durationSec: 30 } // disparable y cancelable
```

- Los timers viven en el servidor y se persisten en `GameState.timers`.
- Caso de uso canónico: "al abrir la puerta → esperar 3s → apagar luces + sonido" (scare). Otro: "si nadie resuelve el mural en 10 min → nueva pista gratis".

### 1.4 Idempotencia y guardas

- Cada regla lleva `id` y, al disparar, registra `firedAt` + contador. Por defecto una regla **dispara una sola vez** por partida (`once: true` por defecto; `repeatable: true` para reglas tipo contador).
- El validador del editor advierte de reglas `repeatable` sin condición de corte (bucles de regalos infinitos: "al recoger la llave, dar la llave" → inventario infinito).

### 1.5 Ejemplo integrado (Rey Aldric)

```json
{
  "id": "rule-sello-final",
  "priority": 10,
  "trigger": { "type": "on_puzzle_solved", "puzzleId": "candado-final" },
  "conditions": [
    { "type": "puzzle_state_is", "puzzleId": "canal-tuberias", "state": "solved" }
  ],
  "actions": [
    { "type": "set_object_state", "objectId": "relicario", "state": "open" },
    { "type": "play_sound", "soundId": "victoria-real" },
    { "type": "delay", "seconds": 4, "actions": [
      { "type": "end_game", "result": "victory" }
    ]}
  ]
}
```

---

## 2. Sistema de objetos del mundo (`WorldObject`)

### 2.1 Catálogo de estados

Todo objeto tiene un conjunto de estados declarado en su definición:

```typescript
interface WorldObject {
  id: string;                     // "arca-trono"
  type: string;                   // puerta | cajon | estatua | placa | escondite | mecanismo | decorativo
  position: { x, y };
  sprite: string;
  states: Record<string, SpriteState>;  // "closed" → spriteA, "open" → spriteB + animación
  initialState: string;
  inventory?: string[];           // items que contiene (cajones, arcas)
  lockedBy?: string;              // puzzle que lo bloquea
  interactable: boolean;
}
```

- Los estados son **strings arbitrarios definidos por el creador** (`lit`, `broken`, `rotated_90`), con sprite/animación asociado. El sistema no impone un vocabulario cerrado: el runtime solo sabe pintar el estado actual.
- Estados con animación de transición (`animation: "slide_up"`), opcional.

### 2.2 Objetos con inventario interno

Cajones, arcas, cofres: `inventory: ["llave-bronce"]`. Al abrirse (regla o puzzle), el contenido pasa a la zona de "descubrimiento" del jugador que interactuó. Comportamiento configurable:

- `distribution: "first_click" | "all_players" | "assigned"` (en cooperativo: ¿solo quien abre recoge, o todos ven el contenido?).

### 2.3 Animados vs. estáticos

- **Estáticos:** decoración pura (alfombras, cuadros sin interacción) — se bake-an en la capa de decoración del tilemap, no son entidades.
- **Animados/entidades:** todo lo que cambia de estado o se puede inspeccionar. Viven como entidades con estado sincronizado en Colyseus (solo estos viajan por la red).
- Regla de oro del rendimiento: **máximo ~200 entidades animadas por sala**; el resto se bake-a. El editor advierte si el creador se pasa.

### 2.4 Representación en el tilemap

Las entidades referencian celda (x, y) + `layer` de colisión. Depth-sort por coordenada isométrica (y del sprite, no de la celda) para que los avatares pasen "delante/detras" correctamente. Los escondites son entidades con `hidingSpot: true` y sprite de cobertura.

---

## 3. Sistema de audio

### 3.1 Tres fuentes de audio para el creador

| Fuente | Descripción |
|---|---|
| **Biblioteca incluida** | Librería de la plataforma: música ambiental por tema, efectos (puertas, mecanismos, aciertos, fallos), voces del narrador base. Sin coste, sin problemas de licencia. |
| **Subida propia** | El creador sube sus MP3/OGG (música, efectos, voces). Moderación obligatoria antes de publicar. Límite de tamaño por sala (p. ej. 50 MB). |
| **Generación IA (ElevenLabs)** | Voces narradas, diálogos de NPC y textos generados con la API de ElevenLabs directamente desde el editor. |

### 3.2 Créditos y tokens (uso de la IA)

- La app vende **créditos** que los creadores gastan en generaciones IA (ElevenLabs y futuros servicios: imágenes, música).
- Los créditos son **a nivel de plataforma**: un pool de tokens internos (no créditos ElevenLabs directos) que la plataforma canjea en su cuenta global de ElevenLabs. Margen: compra de tokens al por mayor vs. venta por unidad.
- **Todo el subsistema de usuarios, organizaciones y ledger de créditos YA ESTÁ DESARROLLADO en SLXD** → se copia/adapta tal cual: cuentas personales y de organización ilimitadas, saldo, histórico de movimientos, compra de créditos, consumo por uso.
- Coste contable por generación: nº caracteres × tarifa ElevenLabs → conversión a créditos internos (redondeo a la unidad, mínimo 1 crédito por generación).

### 3.3 Integración en el editor

- En cualquier campo de audio (diálogo, pista, efecto): botón "Generar con IA" → texto → previsualización → confirmar (se descuentan créditos al confirmar, no al previsualizar).
- El audio generado queda asociado a la **organización** (no solo al usuario): cualquier miembro puede reutilizarlo en sus salas.

### 3.4 Moderación de audio

Subidas y generaciones pasan por el mismo pipeline de moderación que el resto de contenido (flag automático + cola humana). Los TOS prohíben voces de terceros sin consentimiento.

---

## 4. Onboarding y tutorial del primer creador

Embudo diseñado: **registro → primera sala publicada en <30 minutos**.

- **Wizard de 5 pasos:** (1) elige tema medieval → (2) pinta tu primera sala con plantilla pre-rellena → (3) coloca 1 puzzle guiado → (4) playtest → (5) publicar (o guardar borrador).
- **Modo "sala de ejemplo":** al registrarse, cada creador recibe una copia del Rey Aldric como sala de referencia desmontable ("mira cómo está hecha").
- **Ayuda contextual:** el primer uso de cada herramienta del editor muestra un tooltip corto + enlace a video de 60s.
- **Medición:** el wizard registra el paso de abandono (analítica `onboarding_step`).

---

## 5. Catálogo expandido de plantillas (v2)

Cada plantilla = schema en `shared` + componente React (+ entidad Phaser si es world-layer). Diseñadas para encajar en el motor de reglas del punto 1:

### Puzzles individuales (panel React)
1. **Secuencia musical** — repetir melodía con campanas/telas (variante memoria con orden).
2. **Pesas y balanza** — equilibrar objetos de peso desconocido; el servidor valida combinaciones.
3. **Sudoku de símbolos** — rejilla con restricciones; validación de solución única o por comprobación.
4. **Reflejos / timing** — pulsar en el instante exacto (luz que cruza un punto).
5. **Palillos / coincidencias** — quitar/mover N elementos para corregir una ecuación visual.
6. **Sopa de letras / palabra oculta** — el servidor valida la palabra objetivo.
7. **Circuito** — cerrar circuito rotando piezas (variante de tuberías con reglas de flujo eléctrico).

### Puzzles cooperativos (forzan 2+)
8. **Relé de activación** — A abre la puerta X segundos para que pase B (timer de reglas).
9. **Simetría** — un jugador describe un patrón, otro lo replica (validación por servidor del resultado final).
10. **Información dividida expandida** — 3+ fragmentos repartidos entre jugadores (generaliza split_clue).
11. **Desafío por equipos** — cada mitad resuelve su parte; la caja central solo abre con ambas.

### Puzzles de mundo (Phaser)
12. **Luz y espejos** — alinear espejos para dirigir un rayo (grid de rotaciones, flood-fill de luz en servidor).
13. **Caja fuerte con múltiples cerraduras** — 3 mecanismos distintos deben resolverse y activarse en ventana temporal.
14. **Mecanismo de engranajes** — alinear ruedas dentadas (grafo de rotaciones).
15. **Agua que sube** — puzzle con timer físico (se apoya en timers del motor de reglas).

---

## 6. Alcance gráfico mínimo para el escape room de prueba (v1)

Solo lo imprescindible para construir y demo del Rey Aldric. Ampliación diferida a v2.

### Tileset (1 único pack: medieval)
- Suelo: 4–6 baldosas (piedra, loseta, alfombra roja).
- Paredes: 4 variantes + 2 con decoración (antorcha, tapiz).
- Transiciones: puerta de madera (cerrada/abierta), arco, escalera.
- Decoración bake-able: columna, estandarte, cuadro (2), alfombra, barril, cajas, sarcófago, altar, mural.

### Avatares
- **1 solo sprite base** por jugador con tintado por color (4 colores = 4 jugadores) + animaciones mínimas: idle (2 frames), andar (4 direcciones × 4 frames), interactuar (1). Sin personalización en v1.

### Objetos de puzzle (sprites sueltos)
- Llave (bronce/plata/oro como tintados), candado, cáliz, mechero, vela, antorcha, espejo, palanca, placa de presión, copa ×6, azulejo de mural, pieza de tubería ×4 tipos, relicario.

### Efectos
- Partícula única reutilizable (brillo dorado) para reveals, aciertos y magia.
- Transición de fade entre salas.

### UI
- HUD mínimo: cronómetro, contador de pistas, icono de inventario.
- Panel de inventario: grid 3×4 + zona de combinación.
- Avatares en el chat/voz: círculo con color + inicial.

**Total estimado: ~35 tiles + ~20 sprites + 1 atlas de avatar.** Todo puede encargarse en un pack único de Fiverr/asset store y dura todo el MVP.

---

## 7. Analítica y eventos

### 7.1 Taxonomía de eventos

**Jugador y sesión:**
```
user_registered | onboarding_step | room_playtest_started | session_started
player_joined {room_id, session_id, player_n, via: purchase|key|invite}
session_ended {result: victory|timeout|abandon, duration_sec, puzzles_solved, hints_used}
```

**Gameplay (cada puzzle):**
```
puzzle_available {puzzle_id, type, room_id}
puzzle_attempted {puzzle_id, attempt_n}
puzzle_solved {puzzle_id, type, duration_since_available, attempts, hints_used_before}
puzzle_failed {puzzle_id, reason: attempts|timeout}
hint_viewed {puzzle_id, tier}
item_granted {item_id, source: puzzle|recipe|world}
item_combined {inputs, output, success}
dialog_read {dialog_id}
```

**Claves y eventos:**
```
event_created {n_sessions, n_keys, price_total}
key_sent {via: email|bulk|print} | key_confirmed | key_redeemed {assigned_session}
key_expired_unused | session_group_assigned {mode: specific|random|free}
organizer_panel_viewed
```

**Negocio:**
```
room_published {n_puzzles, n_rooms} | room_version_published {version}
purchase_completed {type: room|event|credits, amount, revenue_split}
credit_purchased {pack} | credit_spent {service: elevenlabs, units}
review_submitted {rating}
```

### 7.2 Métricas y funnels clave

| Funnel | Pasos |
|---|---|
| Adquisición creador | visita → registro → wizard iniciado → sala creada → publicada |
| Adquisición jugador | visita catálogo → sala vista → compra/evento → primera partida → segunda partida |
| Eventos B2B | organizador registrado → evento creado → claves enviadas → % confirmadas → % canjeadas → % jugadas → repetición |

**Métricas norte:** sala publicada/creador/mes · % sesiones completadas · tiempo medio por puzzle (alerta si un puzzle de una sala concreta tiene tasa de abandono >40 % — report automático al creador) · ARPU evento · % claves confirmadas.

### 7.3 Implementación

- Eventos enviados desde el servidor (Colyseus/next API) a un endpoint de colección → tabla `analytics_events` (append-only) → agregaciones en BI ligero (Metabase) o ClickHouse si escala.
- Nada de analítica solo en cliente: sesgos y ad-blockers.

---

## 8. Business plan (detalle)

### 8.1 Fuentes de ingreso

| Fuente | Modelo | Reparto |
|---|---|---|
| Venta de salas (B2C) | Precio fijo 0,99–4,99 € | 70 % creador / 30 % plataforma |
| Eventos (B2B/Edu) | ~1 €/jugador, tramos con descuento | 100 % plataforma (salvo sala de tercero: licencia al creador, ver punto 10) |
| Créditos IA | Packs de créditos (p. ej. 5/10/25 €) | 100 % plataforma (margen sobre coste ElevenLabs) |
| Marketplace (v2) | Comisión sobre licencias entre creadores | 20–30 % plataforma |

### 8.2 Costes principales

- Infra: 20–60 €/mes (VPS + R2 + LiveKit) hasta ~1.000 CCU.
- ElevenLabs: coste variable cubierto por créditos (margen objetivo ≥ 50 %).
- Stripe: 1,5 % + 0,25 € por transacción europea (a cargo del vendedor/organizador según caso; en ventas de sala lo asume el reparto).
- Moderación: tiempo humano (cola de revisión).
- LiveKit Cloud (si se usa en vez de self-hosted): €/minuto de media — monitorizar en Fase 2.

### 8.3 Palancas de crecimiento

- SEO del catálogo (Next.js SSR) → "escape room online de historia/matemáticas".
- El profe que organiza un evento ES un creador potencial (onboarding a wizard tras su primer evento).
- Salas de ejemplo temáticas por asignatura (hechas con el propio MCP) como contenido de marketing.
- Programa de referidos: créditos gratis por organizador referido.

### 8.4 Riesgo fiscal/legal a resolver

- Stripe Connect + repartos multi-país (retenciones, KYC de creadores).
- Facturación B2B para institutos/empresas (IVA, factura con datos).
- RGPD: voz y webcam de menores en aulas → consentimiento del organizador + modo "sin cámara por defecto en eventos educativos" (solo voz opcional, apagada por defecto).

---

## 9. Motor de juego v2 (ambición detallada)

- **Niebla de guerra / zonas ocultas:** salas parcialmente ocultas hasta que se exploran (estado por jugador, no por grupo — replay value).
- **Ciclo día/noche y clima:** estados de sala que cambian reglas activas (los puzzles de luz funcionan solo de noche).
- **NPCs con diálogos ramificados:** árbol de conversación en el editor; condiciones por flags; NPCs que mienten (misterio de asesinato). Reutiliza el motor de reglas: los nodos de diálogo son reglas con `show_dialog` encadenadas.
- **Física básica:** objetos empujables, agua que sube de nivel en timers, plataformas móviles. Servidor valida posiciones finales, el cliente anima.
- **Puzzles con decaimiento:** estados que cambian si tardas (la vela se consume, la arena cae).
- **Salas multi-nivel:** pisos con cámara que sigue escaleras.
- **Editor de cinemáticas:** secuencias de cámara/parlamento para introducciones y finales.

---

## 10. Marketplace avanzado

- **Licencias de salas entre creadores:** el organizador puede comprar para su evento una sala de OTRO creador. Modelo: pago único por evento (p. ej. 10 €/evento) o suscripción de centro educativo (X eventos/mes). El creador percibe 70 %.
- **Salas privadas de organización:** una empresa/instituto compra una sala y esta solo existe en su espacio (no pública).
- **Plantillas de evento:** packs "team building", "clase de historia", "cumpleaños" preconfigurados (sala + configuración de evento sugerida).
- **Temporadas y retos:** salas destacadas de pago, eventos oficiales de la plataforma con ranking.
- **Programa de creadores verificados:** badge, mayor visibilidad, revenue share mejorado.

---

## 11. Ranking y clasificaciones

- **Ranking por escape room únicamente** (global por sala): cada sala tiene su propia tabla de clasificación.
- Métrica principal: **tiempo de finalización** (victoria). Desempates: nº de pistas usadas, nº de jugadores (penalización suave por tamaño de grupo configurable por el creador).
- Categorías por sala: "Cualquier grupo" y "Tamaño fijo" (rankings separados por nº de jugadores: 1P, 2P, 3P, 4P).
- Solo entran partidas con **pistas desactivadas** (modo "clasificación" explícito al crear la sesión) y en la versión vigente de la sala.
- Anti-cheat: partida verificada por servidor (bitácora de eventos de puzzle); el panel muestra el replay de eventos a moderadores.
- En eventos: ranking interno del evento (entre sus grupos), opcionalmente no público (el profe decide).

---

## 12. API pública + webhooks (ideas)

- **API REST pública (v2):** lectura del catálogo, creación de eventos y generación de claves desde sistemas externos (el HRIS de una empresa lanza su team building sin entrar en la web).
- **API keys por organización** con scopes (events:write, keys:read) y rate limiting propio.
- **Webhooks:** `event.created`, `key.redeemed`, `session.ended`, `group.finished` (con tiempo y puzzles) → para que RRHH registre asistencia automáticamente.
- **SSO/SAML para organizaciones** (colegios y empresas con su propio login).
- **Exportación de resultados:** CSV/PDF de un evento completo (tiempos, puzzles, asistencia confirmada).
- **Embeds:** sala jugable embebida en webs de terceros (con licencia).
- **Zapier/Make:** conector no-code para el ecosistema educativo/RRHH.

---

## Relación con el roadmap

| Punto | Cuándo se ataca |
|---|---|
| 1, 2 (motor de reglas, objetos) | Antes / dentro de Fase 1–2 (bloqueante) |
| 3 (audio + créditos SLXD + ElevenLabs) | Fase 3–4 (editor y MCP) |
| 4 (onboarding) | Fase 6, antes de beta |
| 5 (plantillas v2) | Post-lanzamiento, iterativo |
| 6 (gráficos v1) | Fase 1 (encargar pack ya) |
| 7 (analítica) | Instrumentar desde Fase 1 (eventos), dashboards en Fase 5–6 |
| 8 (business plan) | Revisar con datos en beta |
| 9–12 | Hoja de ruta post-MVP, este documento es su referencia |
