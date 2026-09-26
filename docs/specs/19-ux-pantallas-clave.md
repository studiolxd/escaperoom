# 19 — UX de pantallas clave

Depende de `11-protocolo-multijugador.md` (§2, §8), `13-api-rest.md` (§6) y
`12-voz-y-webcam-livekit.md` (§4–5).

Wireframes de baja fidelidad de las tres pantallas críticas: **lobby de partida**, **panel del
organizador en vivo** y **flujo de canje de clave del jugador invitado** (el más delicado: la
puerta de entrada de quien no tiene cuenta).

---

## 1. Lobby de partida

Corresponde a la fase `lobby` del protocolo (`specs/11` §2.1, encargo lobby-diseño 2026-09-26):
una **sala de espera jugable** — la habitación `kind: "lobby"` del mapa, diseñada por el creador o
generada —, donde los jugadores ya aparecen, se mueven con su avatar y se ven. La interfaz es un
**panel lateral** sobre ese mapa (`lobby-panel.tsx`, componentes shadcn/ui, estética del HUD):

| Región | Contenido | Decisión de diseño |
|---|---|---|
| Cabecera | Portada, título, descripción, dificultad, duración (o «Sin límite de tiempo», ADR-038) y jugadores `mín.–máx.` | Los valores salen de la sala (`meta`), nunca fijos |
| Jugadores | Nombre, personaje, conectado/desconectado, «Listo», marca de anfitrión y, para el anfitrión, «Expulsar» con confirmación (C-13) | El «Listo» se quita al cambiar de personaje |
| Selector de personaje | Retrato + nombre por personaje de `manifest.avatars` (`26-pack-grafico-v1.md` §4.4), `RadioGroup` + `Card` de shadcn/ui | Los personajes ya ocupados por otro jugador conectado se muestran deshabilitados (A1: únicos por sesión). Elegir envía `select_character`; el servidor es la autoridad |
| Prueba de micro y cámara | Solo si la partida usa voz/vídeo (token de medios configurado y con permiso de publicar) | Abre el dispositivo LOCALMENTE (vista previa silenciada + nivel del micro); no publica nada en la sala |
| Chat | El chat de la partida (el existente) | Funciona en cualquier fase |
| Invitación | «Copiar invitación» (sin QR), solo en partida B2C (en un evento el jugador llega con su clave) | El enlace lleva el `gameToken` en el **fragmento** (nunca llega al servidor web ni a sus logs) y solo sirve para unirse a ESTA partida — también si ya empezó (entrada tardía) |
| Empezar | «Empezar» (todos «Listo») o «Empezar igualmente» (con confirmación) | Solo el **anfitrión**; nunca por debajo de `players.min` conectados (se avisa y no se ofrece). No hace falta llenar el cupo máximo. Con "Todos los grupos comienzan juntos" activo en el evento (`11` §2.2), el anfitrión no ve este control: ve «Esperando a que el organizador inicie la partida» |

**Transición:** «Empezar» envía `start_game` (`lobby → starting`); esta pantalla no valida nada,
delega en el servidor. Después cada jugador ve la **introducción** de la sala (texto o vídeo, la
cierra cuando quiere) y **su 3-2-1** (3 s, sin saltar) y entra al mapa (`specs/04` §10).

## 2. Panel del organizador en vivo

Corresponde a `GET /api/events/:id/dashboard`, complementado por la `SpectatorRoom` para lo
estrictamente en vivo.

| Región | Contenido | Decisión de diseño |
|---|---|---|
| Cabecera | Nombre del evento, sala usada, nº de sesiones activas, ajuste de **duración de partida** (ticket duración-salas) y de **"Todos los grupos comienzan juntos"** (ticket "inicio conjunto") | El ajuste de duración (`Dialog` de shadcn/ui, minutos o "sin duración") solo aparece mientras el evento está en `draft` (antes de activarlo); avisa (no bloquea) si acorta por debajo del `estimatedMinutes` de la sala. El de "inicio conjunto" (`Switch` de shadcn/ui) es editable en `draft` Y en `active`, hasta que algún grupo empiece a jugar |
| Métricas resumen | Sesiones, claves usadas, tiempo medio, pistas por grupo | Las mismas métricas de `progressEvent` — el panel no calcula nada que no esté ya en la analítica de producto |
| Listado de sesiones | Una fila por sesión: nombre del grupo, barra de progreso (puzzles resueltos / total), estado, acción, y — con "inicio conjunto" activo — conectados/mínimo y "Listos" en vivo | Tres acciones: `observar` (sesión en curso → entra como `SpectatorRoom`), `ver replay` (sesión terminada → reconstruida de `progressEvent`, la bitácora de eventos anti-cheat, no un vídeo), sin acción si no ha empezado |
| "Comenzar todos" | Solo visible con "inicio conjunto" activo | Sin `force`: todo o nada — si algún grupo no cumple mínimo/"Listo", no arranca ninguno y se muestra el aviso con el detalle por grupo y tres opciones (`Dialog` de shadcn/ui): Esperar, Refrescar estado, Comenzar igualmente. "Comenzar igualmente" arranca todo grupo con algún conectado (salta el mínimo), salvo los vacíos |
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
