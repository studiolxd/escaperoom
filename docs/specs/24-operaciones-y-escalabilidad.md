# 24 — Operaciones y escalabilidad

Depende de `03-arquitectura-y-stack.md` (§5), `12-voz-y-webcam-livekit.md` (§2) y
`14-modelo-de-datos-sql.md`.

Principio general: **no escalar por adelantado, pero saber de antemano qué se toca cuando toque.**
La arquitectura ya está diseñada para no bloquear ningún escalón (Colyseus, Postgres y LiveKit se
eligieron precisamente porque admiten crecer sin reescritura).

---

## 1. Dos picos de naturaleza opuesta

| | Pico por streamer / viral | Pico por campaña escolar de septiembre |
|---|---|---|
| **Predecibilidad** | Ninguna — cualquier día | Alta — se sabe con semanas/meses de antelación |
| **Qué crece** | Visitas al catálogo, registros, checkouts B2C | Nº de eventos y sesiones simultáneas, generación de claves en lote, exports PDF |
| **Qué NO crece tanto como parece** | El nº de `GameRoom` reales — un streamer con 50.000 espectadores sigue jugando con 1–4 compañeros; los espectadores ven el stream en Twitch | — |
| **Componente que más sufre** | Web (Next.js), checkout, registro | Colyseus, generación de claves/PDF, Postgres (escrituras) |
| **Ventana de reacción** | Minutos — autoscaling reactivo | Semanas — aprovisionar *antes* |

Por eso el plan no es "un botón de escalar más", sino dos estrategias distintas (§4).

## 2. Cuellos de botella por componente

### 2.1 Web (Next.js) — trivial, horizontal desde el principio

Stateless por diseño. Escalar = añadir réplicas detrás de Cloudflare. El catálogo (SSR) se sirve
con cache agresivo en el edge, así que la mayoría del tráfico viral (mirando, no comprando) ni
llega al origen.

### 2.2 Colyseus — el componente con estado, el que necesita un plan

Cada `GameRoom` vive en un único proceso. Ruta de escalado, en orden:

1. **Un solo proceso Colyseus** (MVP): soporta cientos de `GameRoom` concurrentes en un VPS
   modesto — suficiente para el techo de ~1.000 CCU.
2. **Múltiples nodos** cuando ese techo se acerque: requiere `@colyseus/redis-presence` y
   `@colyseus/redis-driver`; el `LobbyRoom` reparte la creación de nuevas `GameRoom` entre nodos
   sin que el cliente lo sepa. **Cambio de configuración, no de protocolo.**
3. El **Redis de presence/matchmaking** debe ser instancia separada del Redis de rate limiting/colas
   desde el paso 2 — un pico de generación de claves no debe degradar el matchmaking en curso.

### 2.3 PostgreSQL

- **Vertical primero** (más CPU/RAM), más barato y simple que horizontal antes de necesitarlo.
- **Réplica de lectura** cuando catálogo público y analítica agregada empiecen a competir con las
  escrituras transaccionales por I/O — un catálogo con segundos de retraso no importa.
- **Particionado mensual de `analytics_events`** ya resuelto desde el diseño: solo hay que seguir
  creando particiones y, eventualmente, mover las antiguas a almacenamiento más barato.

### 2.4 Redis

Empieza como una instancia con varios usos (cache, rate limiting, colas de analítica). Se separa en
instancias dedicadas por uso según se saturan — el primero separable es el presence/matchmaking de
Colyseus en cuanto haya más de un nodo.

### 2.5 LiveKit

- Separación a su **propio nodo antes que cualquier otro componente** (es el que más CPU consume
  por participante con vídeo).
- LiveKit Cloud como salida si el self-hosted da problemas de NAT.
- Matiz del pico de septiembre: como el **vídeo está apagado por defecto en eventos**, el pico
  escolar pesa sobre LiveKit mucho menos de lo que su volumen de sesiones sugeriría — la mayoría
  son solo audio.

### 2.6 Assets (R2) y generación de PDF/claves

- R2 escala por diseño del proveedor.
- La generación de claves en lote y el export PDF **ya son asíncronos cuando el volumen es alto**:
  "500 profesores generando claves el lunes de septiembre" se absorbe en la cola sin bloquear
  peticiones HTTP — siempre que haya suficientes workers (parámetro a subir en la ventana de riesgo).

## 3. Señales que disparan cada escalón

Se escala por dato, no por miedo (umbrales orientativos, a calibrar con métricas reales):

| Señal | Umbral orientativo | Acción |
|---|---|---|
| CPU sostenida del proceso Colyseus | > 70 % en horas pico | Pasar a múltiples nodos Colyseus |
| Latencia p95 de queries de catálogo | > 200 ms | Añadir réplica de lectura de Postgres |
| CCU total acercándose a ~1.000 | 800 CCU sostenidos | Revisar sizing del VPS principal, planificar separación |
| CPU del nodo LiveKit con vídeo mayoritariamente apagado | > 70 % | Separar LiveKit a nodo propio (debería ser el primero) |
| Cola de PDF/claves con retraso | > 5 min en hora punta | Subir nº de workers de la cola |

## 4. Plan por tipo de pico

### 4.1 Pico viral (impredecible)

- **Cloudflare absorbe la mayor parte** antes del origen (catálogo cacheado).
- El tramo crítico es **registro + checkout**: la idempotencia (`Idempotency-Key`) evita duplicados
  bajo carga.
- **Autoscaling reactivo solo en la capa web** — Colyseus no necesita reaccionar (los jugadores
  reales no crecen al ritmo de los espectadores).
- **Alertas automáticas** al canal del equipo; con equipo pequeño, el objetivo es "degradar con
  gracia" (Cloudflare sirve la última versión cacheada del catálogo) más que "escalar en minutos a
  cualquier hora".

### 4.2 Pico escolar de septiembre (predecible)

- **Aprovisionar antes, no reaccionar:** el paso a múltiples nodos y el aumento de workers de la
  cola de PDF/claves se hacen **en agosto**, con margen.
- El límite de 10 sesiones simultáneas por evento ya acota el impacto de un evento grande; el
  riesgo real es la **coincidencia de muchos eventos** el mismo rango de horas lectivas.
- **Congelación de despliegues grandes** durante la ventana de alto riesgo (2–3 primeras semanas de
  septiembre): solo hotfixes, ninguna migración no crítica.
- **Señal de negocio → infraestructura:** si el equipo comercial sabe de eventos grandes ya
  reservados, esa información llega a infraestructura con antelación.

## 5. Fases de escalado — resumen

| Fase | Qué cambia | Disparador |
|---|---|---|
| **0 — MVP** | Todo en 1 VPS (web + Colyseus + Postgres + Redis + LiveKit) | Lanzamiento |
| **1** | LiveKit a su propio nodo | Primero en activarse |
| **2** | Réplica de lectura de Postgres (catálogo/analítica) | Latencia de catálogo |
| **3** | Colyseus multi-nodo + Redis de presence separado | CPU Colyseus / CCU ~1.000, o proactivo antes de campaña escolar |
| **4** | Redis separado por uso | Cuando el paso 3 esté hecho y algún uso compita |
| **5+ (no planificado v1)** | Multi-región, sharding de Postgres, CDN de media para LiveKit | Solo si se expande fuera de España/UE con volumen que lo justifique |

Los costes de cada fase son incrementales sobre la base (20–60 €/mes hasta ~1.000 CCU); no se fijan
cifras exactas para fases 1–4 porque dependen de precios de proveedores en el momento de necesitarlas.

## 6. Observabilidad y operaciones

- **Logs, métricas y alertas** (p. ej. Uptime Kuma + Sentry) — ticket de Fase 6.
- Métricas de LiveKit (bitrate, packet loss, participantes) exportadas junto al resto de analítica
  de infraestructura.
- **Backups de PostgreSQL** con restauración probada (no solo configurada) antes de producción.
- **Rotación de secretos** y auditoría de endpoints admin.
- Sin guardia 24/7 formal en el MVP: el modelo realista es degradación con gracia + alertas.

## 7. Dependencias

- `specs/03-arquitectura-y-stack.md` §5 — infraestructura base.
- `specs/12-voz-y-webcam-livekit.md` §2 — despliegue de LiveKit.
- `specs/16-analitica.md` — métricas que alimentan las señales.
