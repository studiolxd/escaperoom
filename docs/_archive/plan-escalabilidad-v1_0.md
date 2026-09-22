# Plan de escalabilidad

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§5, §13), `esquema-sql-migraciones-v1.0.md`, `arquitectura-livekit-v1.0.md` (§2) y `planificacion-ampliada-puntos-1-12.md` (§8.2).

Principio general: **no escalar por adelantado, pero saber de antemano qué se toca cuando toque** — la arquitectura ya está diseñada para no bloquear ningún escalón (Colyseus, Postgres y LiveKit se eligieron precisamente porque admiten crecer sin reescritura, ver la discusión original de stack). Este documento fija los cuellos de botella reales, las señales que disparan cada paso, y trata por separado los dos tipos de pico que tiene este producto — porque son de naturaleza opuesta y cada uno estresa partes distintas del sistema.

---

## 1. Dos picos de naturaleza opuesta

| | Pico por streamer / viral | Pico por campaña escolar de septiembre |
|---|---|---|
| **Predecibilidad** | Ninguna — puede pasar cualquier día | Alta — se sabe con semanas/meses de antelación |
| **Qué crece** | Visitas al catálogo, registros, checkouts de compra individual | Nº de eventos y sesiones simultáneas, generación de claves en lote, exports de PDF |
| **Qué NO crece tanto como parece** | El nº de `GameRoom` de Colyseus reales — un streamer con 50.000 espectadores sigue jugando con 1–4 compañeros; los espectadores ven el stream en Twitch, no se conectan a nuestra infraestructura de partida | — |
| **Componente que más sufre** | Web (Next.js), checkout, capa de registro | Colyseus (muchas `GameRoom` concurrentes reales), generación de claves/PDF, Postgres (escritura de eventos/sesiones) |
| **Ventana de reacción** | Minutos — hace falta autoscaling reactivo | Semanas — hace falta aprovisionar *antes*, no reaccionar |

Esta distinción es la razón de que el plan no sea "un botón de escalar más", sino dos estrategias distintas (§4).

---

## 2. Cuellos de botella por componente y su ruta de escalado

### 2.1 Web (Next.js) — trivial, horizontal desde el principio

Stateless por diseño. Escalar es añadir réplicas del contenedor detrás de Cloudflare — no requiere cambio de arquitectura en ningún punto. El catálogo (SSR) se sirve con cache agresivo en el edge de Cloudflare, así que la mayoría del tráfico viral (gente mirando el catálogo, no comprando) ni siquiera llega al origen.

### 2.2 Colyseus — el componente con estado, el que de verdad necesita un plan

Cada `GameRoom` vive en un único proceso — es justo el punto que ya se señaló como riesgo desde la conversación de diseño original (*"si esperas picos grandes, Colyseus puede necesitar Redis en modo cluster pronto"*). La ruta de escalado, en orden:

1. **Un solo proceso Colyseus** (MVP, Fase 0): soporta cientos de `GameRoom` concurrentes en un VPS modesto — suficiente para el techo de ~1.000 CCU ya estimado en el business plan.
2. **Múltiples procesos/nodos Colyseus** cuando ese techo se acerque: requiere `@colyseus/redis-presence` (coordinación de qué room vive en qué nodo) y `@colyseus/redis-driver` (matchmaking distribuido) — el `LobbyRoom` (`protocolo-mensajes-colyseus.md` §1) reparte la creación de nuevas `GameRoom` entre nodos sin que el cliente necesite saber cuál. Es un cambio de configuración de Colyseus, no de protocolo — `protocolo-mensajes-colyseus.md` no cambia una línea.
3. El **Redis de presence/matchmaking de Colyseus** debe ser una instancia separada del Redis de rate limiting/colas de analítica (`api-rest-backend-v1.0.md` §11, `protocolo-mensajes-colyseus.md` §10) desde que se llegue al paso 2 — un pico de generación de claves en septiembre no debe poder degradar el matchmaking de partidas en curso, y viceversa.

### 2.3 PostgreSQL

- **Vertical primero** (más CPU/RAM en el mismo VPS o uno dedicado a la base) — más barato y más simple que ir a horizontal antes de necesitarlo.
- **Separación de lecturas** (réplica de solo lectura) cuando el catálogo público (`GET /api/rooms`, alto volumen, bajo coste por query gracias a los índices ya definidos en `esquema-sql-migraciones-v1.0.md` §5) y la analítica agregada empiecen a competir con las escrituras transaccionales (compras, progreso de partida) por I/O — el catálogo y la analítica pueden servirse desde una réplica sin ningún riesgo de inconsistencia relevante (un catálogo con segundos de retraso no importa).
- El **particionado mensual de `analytics_events`** ya está resuelto desde el diseño (`esquema-sql-migraciones-v1.0.md` §8) — este punto no necesita "escalar" en el sentido de rediseño, solo seguir creando particiones y, eventualmente, mover particiones antiguas a almacenamiento más barato.

### 2.4 Redis

Empieza como una sola instancia con varios usos (cache, rate limiting, colas de analítica). Se separa en instancias dedicadas por uso en el mismo orden que se van saturando — el primer separable, por lo dicho en §2.2, es el presence/matchmaking de Colyseus en cuanto haya más de un nodo Colyseus.

### 2.5 LiveKit

Ya tratado en detalle en `arquitectura-livekit-v1.0.md` §2: separación a su propio nodo antes que cualquier otro componente (es el que más CPU consume por participante con vídeo), y LiveKit Cloud como salida si el self-hosted da problemas de NAT en redes educativas/corporativas. Un matiz relevante para el pico de septiembre: como el vídeo está **apagado por defecto en eventos** (`arquitectura-livekit-v1.0.md` §4), el pico escolar pesa sobre LiveKit mucho menos de lo que su volumen de sesiones simultáneas sugeriría a primera vista — la mayoría de esas sesiones son solo audio.

### 2.6 Assets (R2) y generación de PDF/claves

- R2 es almacenamiment de objetos gestionado — no tiene un "plan de escalado" propio, escala por diseño del proveedor.
- La generación de claves en lote y el export de PDF **ya están diseñados como asíncronos cuando el volumen es alto** (`api-rest-backend-v1.0.md` §9) — un pico de "500 profesores generando claves el mismo lunes de septiembre" se absorbe en la cola sin bloquear ninguna petición HTTP, siempre que haya suficientes workers procesándola (eso sí es un parámetro a vigilar y subir en la ventana de riesgo, §4.2).

---

## 3. Señales que disparan cada escalón

Se escala por dato, no por miedo — umbrales orientativos (a calibrar con métricas reales de producción, mismo mecanismo de monitorización ya anotado en `arquitectura-livekit-v1.0.md` §3):

| Señal | Umbral orientativo | Acción |
|---|---|---|
| CPU sostenida del proceso Colyseus > 70 % en horas pico | — | Pasar a múltiples nodos Colyseus (§2.2, paso 2) |
| Latencia p95 de queries de catálogo > 200 ms | — | Añadir réplica de lectura de Postgres (§2.3) |
| CCU total acercándose a ~1.000 (techo ya estimado en el business plan) | 800 CCU sostenidos | Revisar sizing general del VPS principal, planificar separación de componentes si no se ha hecho ya |
| CPU del nodo LiveKit > 70 % con vídeo mayoritariamente apagado | — | Separar LiveKit a nodo propio si no lo estaba ya (debería ser el primer paso, no el último) |
| Cola de generación de PDF/claves con retraso > 5 min en hora punta | — | Subir nº de workers de la cola (parámetro barato de ajustar, no requiere cambio de arquitectura) |

---

## 4. Plan específico por tipo de pico

### 4.1 Pico viral (streamer, impredecible)

- **Cloudflare absorbe la mayor parte** antes de que llegue al origen (catálogo cacheado).
- El tramo crítico real es **registro + checkout**: la idempotencia ya exigida en el diseño de la API (`Idempotency-Key`, `api-rest-backend-v1.0.md` §1) hace que los reintentos de clientes bajo carga no dupliquen compras ni cuentas.
- **Autoscaling reactivo** solo en la capa web (§2.1) — Colyseus no necesita reaccionar a este tipo de pico porque, como se explica en §1, el nº de jugadores reales conectados no crece al ritmo de los espectadores.
- **Alertas automáticas** (CPU, latencia, tasa de error) enrutadas al canal del equipo — con un equipo pequeño no hay guardia 24/7 formal en el MVP, así que el objetivo realista es "degradar con gracia" (Cloudflare sirve la última versión cacheada del catálogo aunque el origen esté sobrecargado) más que "escalar en minutos a cualquier hora".

### 4.2 Pico escolar de septiembre (predecible)

- **Aprovisionar antes, no reaccionar**: dado que la fecha se conoce, el paso a múltiples nodos Colyseus (si el volumen esperado lo justifica) y el aumento de workers de la cola de PDF/claves se hacen **en agosto**, con margen, no la primera semana de septiembre cuando ya hay profesores esperando.
- **El límite de 10 sesiones simultáneas por evento** (`especificaciones-escape-room-creator-v1.0.md` §3.2) ya acota el impacto de un solo evento grande — el riesgo real de septiembre es la **coincidencia de muchos eventos de centros distintos** el mismo rango de horas lectivas, no un evento individual descontrolado.
- **Congelación de despliegues de cambios grandes** durante la ventana de alto riesgo (las 2–3 primeras semanas de septiembre, o el periodo que el negocio identifique como de mayor concentración de eventos reservados) — solo hotfixes, ningún cambio de arquitectura ni migración de esquema no crítica en esa ventana.
- **Señal de negocio → infraestructura**: si el equipo comercial sabe que hay eventos grandes ya reservados (varios institutos, por ejemplo) para fechas concretas, esa información debe llegar a quien gestiona la infraestructura con antelación — es un dato de negocio, no algo que se descubra por monitorización el mismo día.

---

## 5. Fases de escalado — resumen

| Fase | Qué cambia | Disparador |
|---|---|---|
| **0 — MVP** | Todo en 1 VPS (web + Colyseus + Postgres + Redis + LiveKit), tal como está en `especificaciones-escape-room-creator-v1.0.md` §13 | Lanzamiento |
| **1** | LiveKit a su propio nodo | Primero en activarse — es el más pesado por participante, no hace falta esperar a un pico real |
| **2** | Réplica de lectura de Postgres para catálogo/analítica | Señales de §3 (latencia de catálogo) |
| **3** | Colyseus multi-nodo + Redis de presence separado | Señales de §3 (CPU Colyseus / CCU acercándose a 1.000), o de forma proactiva antes de una campaña escolar grande conocida (§4.2) |
| **4** | Redis separado por uso (cache/rate-limit vs. presence Colyseus vs. colas) | Cuando el paso 3 ya esté hecho y algún uso empiece a competir por recursos con otro |
| **5+ (no planificado para v1)** | Multi-región / CDN de media para LiveKit, sharding de Postgres | Solo si el negocio se expande fuera de España/UE con volumen que lo justifique — no hay señal de que vaya a hacer falta a corto plazo, se anota aquí solo para no fingir que el plan termina en la fase 4 |

Los costes de cada fase son incrementales sobre la base ya estimada (20–60 €/mes hasta ~1.000 CCU, `planificacion-ampliada-puntos-1-12.md` §8.2) — no se fijan cifras exactas para las fases 1–4 porque dependen de precios de proveedores en el momento de necesitarlas; el criterio de decisión (§3) es independiente del precio concreto.
