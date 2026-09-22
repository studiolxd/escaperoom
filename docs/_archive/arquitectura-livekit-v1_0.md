# Arquitectura LiveKit en detalle

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§5, §7, §13), `protocolo-mensajes-colyseus.md` (§8) y `plan-moderacion-contenido-v1.0.md` (§7).

El protocolo de Colyseus ya fija **cuándo** se firma un token LiveKit y **con qué permisos por defecto** en eventos educativos. Este documento detalla **cómo** se despliega y configura LiveKit en sí: topología de rooms, gestión de ancho de banda, el interruptor de cámara por defecto (a nivel de producto, no solo de token) y la grabación opcional para eventos corporativos — incluida su base de consentimiento.

---

## 1. Topología de rooms: una por partida, no por evento

**Decisión: una room de LiveKit por `GameRoom` de Colyseus (es decir, por sesión de juego), nunca una room compartida por todo el evento.**

Razones:
- Es exactamente el ciclo de vida ya fijado en `especificaciones-escape-room-creator-v1.0.md` §7: *"la room de medios se crea junto a la room de Colyseus y muere con ella"*. Una room por evento rompería esa simetría y obligaría a gestionar dos ciclos de vida distintos.
- **Aislamiento**: en un evento con 10 sesiones simultáneas (el máximo de `especificaciones` §3.2), una room única mezclaría el audio/vídeo de 10 grupos que no deben oírse entre sí. Habría que segmentar con lógica de aplicación (mute selectivo) en vez de dejar que LiveKit lo resuelva por diseño.
- **Ancho de banda**: el coste de un SFU crece con el nº de participantes publicando en la misma room (cada publisher se reenvía a cada subscriber). Una room de 4 personas cuesta lo mismo publique quien publique; 10 sesiones de 4 no deben convertirse en una room de 40.

### 1.1 El caso del organizador-observador

El organizador en modo observador (`SpectatorRoom` de Colyseus, `protocolo-mensajes-colyseus.md` §1) necesita ver/oír grupos distintos según a cuál "salta" — pero **no simultáneamente a todos**. Se resuelve así:

- El observador recibe un token LiveKit **de solo suscripción** (`canPublish: false`, `canPublishData: false`) para la room de la sesión que está mirando en cada momento.
- Al cambiar de sesión en el panel (§3.5 de especificaciones: *"salta entre sesiones, no ocupa plaza"*), el cliente se desconecta de la room LiveKit anterior y se conecta a la nueva — nunca mantiene N conexiones SFU abiertas a la vez por una sola persona.
- Excepción: si el organizador activa el modo híbrido de pistas (v2, mencionado como pendiente en especificaciones §11 de la planificación), seguiría siendo una sesión activa a la vez, mismo patrón.

---

## 2. Despliegue

### 2.1 MVP: self-hosted en el mismo VPS

```
docker-compose.yml (extracto)
  livekit-server:
    image: livekit/livekit-server
    ports: ["7880:7880", "7881:7881/tcp", "50000-50100:50000-50100/udp"]
    # 7880 = API/signaling (WSS detrás de Cloudflare)
    # 7881 = TCP fallback (redes que bloquean UDP)
    # 50000-50100 = rango RTP/ICE (UDP) — el cuello de botella real de NAT
  coturn:
    image: coturn/coturn
    # TURN relay — imprescindible en self-hosted: sin él, los peers detrás de NAT
    # simétrico (redes corporativas/educativas con firewall estricto, justo el
    # perfil de cliente más probable en eventos B2B/Edu) no consiguen conectar.
```

- **TURN es obligatorio, no opcional**, precisamente por el perfil de red esperado: colegios y oficinas con firewalls estrictos son el caso de uso principal de "eventos", no la excepción.
- Certificados TLS y dominio propio para signaling (`livekit.dominio.com`) detrás de Cloudflare (ya en el stack, `especificaciones-escape-room-creator-v1.0.md` §13).
- Sizing inicial: el mismo VPS que web+Colyseus+Postgres+Redis hasta el límite de CCU mencionado en el business plan (~1.000 CCU/20–60 €/mes) — a partir de ahí, LiveKit se separa a su propio VPS antes que cualquier otro componente, porque es el que más CPU consume por participante con vídeo activo.

### 2.2 Plan B ya identificado en el roadmap: LiveKit Cloud

El roadmap ya marca el riesgo (*"LiveKit self-hosted da problemas de red (NAT) → LiveKit Cloud como plan B, probar en Fase 2, no al final"*). Se formaliza aquí el criterio de decisión, para no dejarlo para cuando ya duela:

- **Probar LiveKit Cloud en Fase 2**, no como fallback de emergencia — con tráfico real de prueba entre redes distintas (móvil, wifi doméstica, red corporativa simulada) antes de comprometerse a self-hosted para producción.
- Criterio de cambio a Cloud: tasa de fallo de conexión >3–5 % en sesiones de evento (no en B2C, donde el perfil de red es más predecible), o coste de soporte/debugging de NAT que supere el ahorro de self-hosted.
- El código de aplicación **no debe acoplarse** al hecho de ser self-hosted: se usa el SDK oficial de LiveKit y la única diferencia entre self-hosted y Cloud es la URL del servidor y las credenciales — decisión reversible sin tocar `protocolo-mensajes-colyseus.md`.

---

## 3. Gestión de ancho de banda

| Medida | Detalle |
|---|---|
| **Simulcast** | Cada publisher de vídeo envía 2–3 capas de calidad; el SFU reenvía a cada subscriber la capa adecuada a su ancho de banda — activado por defecto en el SDK de LiveKit, no requiere lógica propia |
| **Vídeo apagado por defecto en eventos educativos** | La medida de ancho de banda más efectiva no es técnica: si la mayoría de sesiones de evento nunca publican vídeo (§4), el coste de banda de esa cohorte es solo audio, un orden de magnitud menor |
| **Límite de participantes con vídeo simultáneo por room** | Cap duro de 6 publishers de vídeo por `GameRoom` (coincide con el techo razonable de jugadores por sala) — no hace falta lógica de "cascada" porque el propio límite de jugadores por sala (`especificaciones` §2.2, N configurable por el creador) ya acota esto |
| **Degradación ante congestión** | El propio cliente LiveKit (adaptive stream) reduce resolución/frame rate automáticamente; si la red es muy mala, el cliente ofrece "pasar a solo audio" con un aviso en la UI, sin desconectar de la partida (que sigue funcionando por el WebSocket de Colyseus, independiente de LiveKit) |
| **Spectator sin publicar nunca** | Ya cubierto en §1.1 — el organizador observador nunca añade coste de publisher, solo de subscriber, y solo a una room a la vez |
| **Monitorización** | Métricas de LiveKit (bitrate, packet loss, participantes activos) exportadas junto al resto de analítica de infraestructura — alimenta la decisión de sizing/Cloud de §2.2 con datos reales, no solo con el techo teórico de 1.000 CCU |

---

## 4. Modo "sin cámara por defecto" en eventos educativos

Ya establecido a nivel de protocolo (`canPublishVideo: false` en el token, `protocolo-mensajes-colyseus.md` §8) y de producto (`plan-moderacion-contenido-v1.0.md` §7). Aquí se fija **dónde vive la decisión** y **quién puede cambiarla**:

- Campo `allowVideo: boolean` dentro de `events.config` (JSONB, mismo lugar que `expiryRules`, `esquema-sql-migraciones-v1.0.md` §6) — **default `false`** al crear cualquier evento.
- **Audio sí está activo por defecto** en todos los casos (es el canal principal de coordinación cooperativa) — lo que cambia por defecto es solo vídeo.
- Solo el organizador puede cambiar `allowVideo` a `true`, y **solo antes de que arranque la sesión** (`sessions.status = pending`) — nunca a media partida. Cambiarlo en caliente abriría una ventana donde alguien enciende cámara sin que el resto lo esperara.
- En compra individual B2C (amigos jugando entre sí, sin evento de por medio): `allowVideo` por defecto **`true`** — es un grupo de adultos que se conoce y ha elegido jugar junto, el caso de uso por defecto es verse la cara. Cada jugador sigue controlando su propia cámara individualmente (encender/apagar), esto solo fija el permiso del token, no fuerza a nadie a publicar.
- El token sigue siendo la única fuente de verdad de permiso real (§8 del protocolo) — el flag de `events.config` es lo que decide **qué permiso se firma** al generar el token de join, no una restricción de UI que se pueda saltar.

---

## 5. Grabación opcional para eventos corporativos (RRHH)

### 5.1 Cuándo existe esta opción

- **Disponible únicamente para eventos marcados como no educativos.** Usa el mismo campo `audience` que se propuso como adenda en `plan-moderacion-contenido-v1.0.md` §7 (`events.audience: 'general' | 'educational'`) — si `audience = 'educational'`, la opción de grabar **ni siquiera aparece** en el panel del organizador. No es una casilla que un profesor pueda marcar por error: es una rama de producto distinta.
- Pensada para el caso descrito en la planificación ampliada (§12, ideas de API/webhooks para RRHH): una empresa hace un team building y quiere una prueba/recuerdo de la actividad, no vigilancia continua.

### 5.2 Consentimiento — todo o nada, nunca silencioso

- El organizador activa `recordingEnabled: true` al crear el evento, con un texto de confirmación explícito que acepta ("declaro que informaré a los participantes y solicitaré su consentimiento antes de la sesión") — deja constancia (`purchases`/`events` guardan quién lo activó y cuándo, mismo patrón de auditoría que `credit_movements.created_by`).
- **Cada participante**, al unirse a una sesión con grabación activada, ve una pantalla de consentimiento explícito antes de conectar a LiveKit (antes del `join` de Colyseus, no después) — debe aceptar para continuar.
- **Si un solo participante rechaza, esa sesión concreta no se graba** — no se hace grabación parcial (excluir solo su pista) porque una grabación "compuesta" de room mezcla todas las pistas en un único archivo; separar a una persona de ese archivo no es una operación limpia con Egress de composición. Es una decisión de producto deliberadamente conservadora: graba todo el grupo con consentimiento unánime, o no graba nada.
- Base legal: **consentimiento explícito** (no interés legítimo) — es la única base defendible para grabar voz e imagen de personas identificables en un contexto laboral. El desarrollo legal completo (informar, retirar consentimiento, plazos) es el punto 10 pendiente; esta sección fija el mecanismo técnico que ese análisis necesita para no partir de cero.

### 5.3 Implementación técnica

- **LiveKit Egress** (composición de room a archivo), self-hosted junto al resto del stack, saliendo a Cloudflare R2 (mismo almacenamiento de assets ya usado, `especificaciones-escape-room-creator-v1.0.md` §5).
- Egress se dispara al confirmarse el consentimiento unánime (no al crear el evento) — si nadie ha aceptado todavía cuando arranca la sesión, la sesión simplemente no se graba y el organizador lo ve reflejado en el panel (`recordingStatus: 'not_recorded_no_consent'`).
- Nueva tabla (adenda al esquema, sección de eventos):

```sql
-- adenda a esquema-sql-migraciones-v1.0.md §6
CREATE TABLE event_recordings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES sessions(id),
  egress_id        text NOT NULL,           -- id del job de LiveKit Egress
  storage_path     text,                    -- ruta en R2, null hasta que termina
  consent_status   text NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending', 'unanimous', 'declined')),
  status           text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'recording', 'ready', 'failed', 'deleted')),
  retention_until  timestamptz,             -- borrado automático programado
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
```

- **Retención por defecto: 90 días** desde `ready`, borrado automático (job programado, mismo mecanismo que la caducidad de `access_keys`). El organizador puede pedir el borrado antes en cualquier momento (`DELETE /api/events/:id/recordings/:id`, addenda a `api-rest-backend-v1.0.md` §6) o extender la retención explícitamente si tiene una razón (nunca por defecto indefinida).
- **Acceso**: solo miembros de la organización con `org_role IN ('owner','admin')` (tabla `organization_members` ya existente) pueden generar la URL de descarga firmada (24 h de validez, mismo patrón que el export de PDF, `api-rest-backend-v1.0.md` §9).
- La grabación **nunca** pasa por el pipeline de moderación de contenido — es privada de la organización, no contenido publicado; si en algún momento se planteara analizarla (p. ej. para detectar incidentes), eso requeriría una base legal y un consentimiento propios, más allá del alcance de este documento.

---

## 6. Resumen de valores por defecto

| Contexto | Audio por defecto | Vídeo por defecto | Grabación disponible |
|---|---|---|---|
| Compra individual (B2C, amigos) | Activo | Activo (cada jugador controla el suyo) | No |
| Evento — `audience: general` (empresas) | Activo | Apagado, activable por el organizador antes de empezar | Sí, con consentimiento unánime |
| Evento — `audience: educational` (aulas) | Activo | Apagado, activable por el organizador antes de empezar | No disponible en absoluto |
