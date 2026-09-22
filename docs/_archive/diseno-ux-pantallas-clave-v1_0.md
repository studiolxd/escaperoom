# Diseño UX de las pantallas clave

Acompaña a `protocolo-mensajes-colyseus.md` (§2, §8), `api-rest-backend-v1.0.md` (§6) y `arquitectura-livekit-v1.0.md` (§4–5).

Wireframes de baja fidelidad (mostrados arriba en la conversación) de las tres pantallas señaladas como críticas: el lobby de partida, el panel del organizador en vivo, y el flujo de canje de clave del jugador invitado — este último marcado desde el principio como el más delicado, porque es la puerta de entrada de quien no tiene cuenta.

---

## 1. Lobby de partida

Corresponde a la fase `lobby` del protocolo (`protocolo-mensajes-colyseus.md` §2), entre `created` y `playing`.

| Región | Contenido | Decisión de diseño |
|---|---|---|
| Cabecera | Título de la sala, tema, contador `3/4 jugadores` | El contador usa siempre la capacidad declarada por el creador (`players.max` del RoomPackage), nunca un número fijo |
| Tiles de jugador | Uno por participante conectado + huecos vacíos para plazas libres | Cada tile muestra cámara (si `allowVideo`, `arquitectura-livekit-v1.0.md` §4) o icono de solo-micro, nombre, y estado `listo`/`conectando…` — el estado `listo` es local (el jugador pulsa "estoy listo"), no implica nada sobre la partida todavía |
| Enlace de invitación | Solo visible en compra individual (B2C); en un evento, el jugador ya llegó vía clave, no necesita enlace | El enlace nunca contiene la clave en claro reutilizable — es de un solo uso de sesión (mismo criterio de `especificaciones-escape-room-creator-v1.0.md` §3.3) |
| Barra inferior | Controles de mic/cámara/chat/ajustes + botón "Comenzar" | El botón solo lo ve y puede pulsar el **host** (protocolo §11, matriz de permisos); permanece deshabilitado hasta que todos los presentes están `listo` — no hace falta esperar a llenar el cupo máximo, un grupo de 2 puede empezar en una sala de hasta 4 |

**Transición:** al pulsar "Comenzar", el cliente envía la transición de fase que ya define el protocolo (`lobby → playing`); esta pantalla no tiene lógica propia de validación, delega en el servidor.

---

## 2. Panel del organizador en vivo

Corresponde a `GET /api/events/:id/dashboard` (`api-rest-backend-v1.0.md` §6.2), complementado por la `SpectatorRoom` de Colyseus para lo estrictamente en vivo.

| Región | Contenido | Decisión de diseño |
|---|---|---|
| Cabecera | Nombre del evento, sala usada, nº de sesiones activas | — |
| Métricas resumen | Sesiones, claves usadas, tiempo medio, pistas por grupo | Son las mismas métricas que alimenta `progress_events` (`esquema-sql-migraciones-v1.0.md` §8) — el panel no calcula nada que no esté ya en la analítica de producto |
| Listado de sesiones | Una fila por sesión: nombre del grupo, barra de progreso (puzzles resueltos / total), estado, acción | Tres estados de acción posibles: `observar` (sesión en curso → entra como `SpectatorRoom`, protocolo §1), `ver replay` (sesión terminada → reconstruida de `progress_events`, no es un vídeo, es el mismo mecanismo de "bitácora de eventos de puzzle" ya anotado como herramienta anti-cheat en la planificación ampliada), sin acción si aún no ha empezado |
| Pie de panel | Reenviar claves pendientes, exportar PDF | Acciones directas sobre `POST /api/access-keys/:code/resend` y `POST /api/events/:id/access-keys/export-pdf` (`api-rest-backend-v1.0.md` §6.2, §9) — el panel no introduce ninguna operación que la API no tuviera ya |

**Nota de diseño:** *"observar"* nunca añade un jugador a la partida (matriz de permisos del protocolo, observador de solo lectura) — el wireframe lo marca como una acción de navegación (cambia de pantalla), no como unirse.

---

## 3. Flujo de canje de clave — jugador invitado

El más delicado, tal como se señaló al proponer este punto: es la primera impresión del producto para alguien sin cuenta.

### Paso 1 — Introducir código
Un único campo de texto + botón. Sin registro, sin email obligatorio — refuerza visualmente la decisión de producto ya tomada varias veces en los documentos anteriores (`plan-moderacion-contenido-v1.0.md` §7, `legal-tos-rgpd-menores-v1.0.md` §4): el menor invitado no necesita cuenta. El texto de apoyo ("sin cuenta ni email necesarios") no es solo UX, es la forma más directa de comunicar esa garantía al propio usuario en el momento en que más importa.

### Paso 2 — Antes de entrar
Pantalla de permisos y consentimiento, **antes** de conectar a LiveKit (coherente con `protocolo-mensajes-colyseus.md` §8, donde el token se firma después del `join`, no antes). Muestra:
- Estado real de mic/cámara según la configuración del evento (`allowVideo`, `arquitectura-livekit-v1.0.md` §4) — en el wireframe, cámara apagada por ser evento educativo, no editable por el jugador en ese momento (solo el organizador puede cambiarlo, y solo antes de arrancar la sesión).
- Aviso explícito de si la sesión se graba o no. Cuando `recordingEnabled = true`, esta es exactamente la pantalla de consentimiento unánime de `arquitectura-livekit-v1.0.md` §5.2 — no es una pantalla aparte, es este mismo paso con un bloque adicional que exige aceptar antes de continuar.
- Si el jugador rechaza el consentimiento de grabación: no se le bloquea la partida (eso penalizaría al único que actuó con cautela) — la sesión completa pasa a no grabarse, tal como ya se decidió (todo o nada).

### Paso 3 — Conectando
Pantalla de transición corta, sin decisiones del usuario — feedback de que el `redeem` (`api-rest-backend-v1.0.md` §6.2) se resolvió y lo siguiente es el lobby de la sección 1. Si `redeem` falla (clave usada, caducada), esta pantalla nunca llega a mostrarse: el error se muestra en el paso 1 con los códigos ya definidos en el protocolo (`ACCESS_KEY_USED`, `ACCESS_KEY_EXPIRED`...).

---

## 4. Qué no cubre este documento

No son mockups de alta fidelidad ni definen el sistema visual (tipografía, color de marca, ilustraciones) — eso corresponde a una fase de diseño gráfico posterior, fuera del alcance de esta tanda de documentos técnicos. Lo que fija este documento es la **estructura de información y las decisiones de flujo**, que es lo que un desarrollador necesita para empezar a construir sin bloquearse en preguntas de producto a medio camino.
