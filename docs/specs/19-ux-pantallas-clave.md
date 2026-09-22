# 19 — UX de pantallas clave

Depende de `11-protocolo-multijugador.md` (§2, §8), `13-api-rest.md` (§6) y
`12-voz-y-webcam-livekit.md` (§4–5).

Wireframes de baja fidelidad de las tres pantallas críticas: **lobby de partida**, **panel del
organizador en vivo** y **flujo de canje de clave del jugador invitado** (el más delicado: la
puerta de entrada de quien no tiene cuenta).

---

## 1. Lobby de partida

Corresponde a la fase `lobby` del protocolo, entre `created` y `playing`.

| Región | Contenido | Decisión de diseño |
|---|---|---|
| Cabecera | Título de la sala, tema, contador `3/4 jugadores` | El contador usa siempre la capacidad declarada por el creador (`players.max`), nunca un número fijo |
| Tiles de jugador | Uno por conectado + huecos vacíos | Cada tile muestra cámara (si `allowVideo`) o icono de solo-micro, nombre y estado `listo`/`conectando…`. El estado `listo` es local (el jugador pulsa "estoy listo"), no implica nada sobre la partida |
| Enlace de invitación | Solo visible en compra individual (B2C); en un evento el jugador ya llegó vía clave | El enlace nunca contiene la clave en claro reutilizable — es de un solo uso de sesión |
| Barra inferior | Controles de mic/cámara/chat/ajustes + botón "Comenzar" | El botón solo lo ve y pulsa el **host**. Deshabilitado hasta que todos los presentes estén `listo` — no hace falta llenar el cupo máximo (un grupo de 2 puede empezar en sala de 4) |

**Transición:** "Comenzar" envía la transición `lobby → playing`; esta pantalla no tiene lógica
propia de validación, delega en el servidor.

## 2. Panel del organizador en vivo

Corresponde a `GET /api/events/:id/dashboard`, complementado por la `SpectatorRoom` para lo
estrictamente en vivo.

| Región | Contenido | Decisión de diseño |
|---|---|---|
| Cabecera | Nombre del evento, sala usada, nº de sesiones activas | — |
| Métricas resumen | Sesiones, claves usadas, tiempo medio, pistas por grupo | Las mismas métricas de `progress_events` — el panel no calcula nada que no esté ya en la analítica de producto |
| Listado de sesiones | Una fila por sesión: nombre del grupo, barra de progreso (puzzles resueltos / total), estado, acción | Tres acciones: `observar` (sesión en curso → entra como `SpectatorRoom`), `ver replay` (sesión terminada → reconstruida de `progress_events`, la bitácora de eventos anti-cheat, no un vídeo), sin acción si no ha empezado |
| Pie de panel | Reenviar claves pendientes, exportar PDF | Acciones directas sobre `POST /api/access-keys/:code/resend` y `POST /api/events/:id/access-keys/export-pdf` |

**Nota:** *observar* nunca añade un jugador a la partida (observador de solo lectura) — es una
acción de navegación (cambia de pantalla), no un "unirse".

**CTA de crecimiento:** al finalizar la jornada, el panel muestra una llamada contextual — *"¿Y si
la próxima la creas tú? Empieza con el wizard"* — apoyada en los datos reales del evento (ver
`specs/25-estrategia-de-contenido-y-lanzamiento.md` §3.1).

## 3. Flujo de canje de clave — jugador invitado

La primera impresión del producto para alguien sin cuenta.

### Paso 1 — Introducir código

- Un único campo de texto + botón. Sin registro, sin email obligatorio.
- El texto de apoyo ("sin cuenta ni email necesarios") comunica la garantía al propio usuario.
- Si el `redeem` falla (clave usada, caducada), el error se muestra **aquí**, con los códigos ya
  definidos (`ACCESS_KEY_USED`, `ACCESS_KEY_EXPIRED`, `ACCESS_KEY_NOT_CONFIRMED`, `SESSION_FULL`).

### Paso 2 — Antes de entrar

Pantalla de permisos y consentimiento, **antes** de conectar a LiveKit (el token se firma después
del `join`, no antes). Muestra:

- Estado real de mic/cámara según la configuración del evento (`allowVideo`) — en evento
  educativo, cámara apagada y no editable por el jugador (solo el organizador puede cambiarlo,
  y solo antes de arrancar la sesión).
- Aviso explícito de si la sesión se graba o no. Cuando `recordingEnabled = true`, esta es la
  pantalla de consentimiento unánime: no es una pantalla aparte, es este mismo paso con un bloque
  adicional que exige aceptar antes de continuar.
- Si el jugador **rechaza** el consentimiento de grabación: **no se le bloquea la partida** (eso
  penalizaría al único que actuó con cautela) — la sesión completa pasa a no grabarse (todo o nada).

### Paso 3 — Conectando

Pantalla de transición corta, sin decisiones: feedback de que el `redeem` se resolvió y lo
siguiente es el lobby. Si `redeem` falla, esta pantalla nunca se muestra (el error salió en el
paso 1).

## 4. Qué no cubre este documento

No son mockups de alta fidelidad ni definen el sistema visual (tipografía, color de marca,
ilustraciones) — eso es una fase de diseño gráfico posterior. Lo que fija es la **estructura de
información y las decisiones de flujo**, suficiente para empezar a construir sin bloquearse.

## 5. Dependencias

- `specs/11-protocolo-multijugador.md` — fases, permisos y join.
- `specs/12-voz-y-webcam-livekit.md` — defaults de cámara y consentimiento de grabación.
- `specs/13-api-rest.md` §6 — `redeem` y dashboard.
