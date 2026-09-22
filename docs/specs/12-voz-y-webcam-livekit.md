# 12 — Voz y webcam (LiveKit)

Depende de `11-protocolo-multijugador.md` (§1, §8) y `17-moderacion-de-contenido.md` (§7).
Define **cómo** se despliega y configura LiveKit: topología de rooms, ancho de banda, cámara por
defecto y grabación opcional con su base de consentimiento.

---

## 1. Topología: una room por partida, no por evento

**Decisión: una room de LiveKit por `GameRoom` de Colyseus (por sesión de juego), nunca una room
compartida por todo el evento.**

Razones:

- Coincide con el ciclo de vida ya fijado: *"la room de medios se crea junto a la de Colyseus y
  muere con ella"*. Una room por evento rompería esa simetría.
- **Aislamiento:** en un evento con 10 sesiones simultáneas, una room única mezclaría el
  audio/vídeo de 10 grupos que no deben oírse entre sí.
- **Ancho de banda:** el coste de un SFU crece con el nº de publishers en la misma room. Una room
  de 4 cuesta lo mismo publique quien publique; 10 sesiones de 4 no deben ser una room de 40.

### 1.1 El caso del organizador-observador

El organizador en modo observador (`SpectatorRoom`) necesita ver/oír grupos distintos según a cuál
salte, pero **no simultáneamente**:

- Recibe un token LiveKit **de solo suscripción** (`canPublish: false`, `canPublishData: false`)
  para la room de la sesión que mira en cada momento.
- Al cambiar de sesión, el cliente se desconecta de la room anterior y se conecta a la nueva —
  nunca mantiene N conexiones SFU abiertas a la vez.
- Excepción v2 (modo híbrido de pistas): sigue siendo una sesión activa a la vez, mismo patrón.

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
    # TURN relay — imprescindible: sin él, los peers detrás de NAT simétrico
    # (redes corporativas/educativas con firewall estricto, justo el perfil B2B/Edu)
    # no consiguen conectar.
```

- **TURN es obligatorio, no opcional**, por el perfil de red esperado: colegios y oficinas con
  firewalls estrictos son el caso de uso principal de "eventos".
- Certificados TLS y dominio propio para signaling (`livekit.dominio.com`) detrás de Cloudflare.
- Sizing inicial: el mismo VPS que web+Colyseus+Postgres+Redis hasta el límite de ~1.000 CCU
  (20–60 €/mes). A partir de ahí, LiveKit se separa a su propio nodo **antes** que cualquier otro
  componente (es el que más CPU consume por participante con vídeo).

### 2.2 Plan B: LiveKit Cloud

- **Probar LiveKit Cloud en Fase 2**, no como fallback de emergencia — con tráfico real de prueba
  entre redes distintas (móvil, wifi doméstica, red corporativa simulada) antes de comprometerse
  a self-hosted para producción.
- Criterio de cambio a Cloud: tasa de fallo de conexión > 3–5 % en sesiones de evento (no en B2C,
  donde la red es más predecible), o coste de soporte/debugging de NAT que supere el ahorro.
- El código de aplicación **no debe acoplarse** al hecho de ser self-hosted: se usa el SDK oficial
  y la única diferencia es la URL y las credenciales — decisión reversible sin tocar el protocolo.

## 3. Gestión de ancho de banda

| Medida | Detalle |
|---|---|
| **Simulcast** | Cada publisher de vídeo envía 2–3 capas; el SFU reenvía la adecuada a cada subscriber (activado por defecto en el SDK) |
| **Vídeo apagado por defecto en eventos educativos** | La medida más efectiva: si la cohorte educativa no publica vídeo (§4), su coste es solo audio, un orden de magnitud menor |
| **Límite de publishers de vídeo por room** | El mismo `platform_settings.max_players_per_room` (default 6) que usa el validador de salas — **una sola fuente de verdad**: si se sube a 8 desde el panel admin, sube a la vez el techo de creación de salas y el cap de publishers, nunca se desincronizan |
| **Degradación ante congestión** | El cliente LiveKit (adaptive stream) reduce resolución/framerate; si la red es muy mala, ofrece "pasar a solo audio" sin desconectar de la partida (que sigue por Colyseus, independiente de LiveKit) |
| **Spectator sin publicar nunca** | El observador nunca añade coste de publisher, solo de subscriber, y solo a una room a la vez |
| **Monitorización** | Métricas de LiveKit (bitrate, packet loss, participantes) exportadas junto al resto de analítica de infraestructura |

## 4. Modo "sin cámara por defecto" en eventos educativos

Fijado a nivel de protocolo (`canPublishVideo: false` en el token) y de producto
(`specs/17-moderacion-de-contenido.md` §7). Aquí se fija **dónde vive la decisión** y **quién
puede cambiarla**:

- Campo `allowVideo: boolean` dentro de `events.config` (JSONB, mismo lugar que `expiryRules`) —
  **default `false`** al crear cualquier evento.
- **Audio activo por defecto** en todos los casos (es el canal principal de coordinación). Lo que
  cambia es solo el vídeo.
- Solo el organizador puede poner `allowVideo: true`, y **solo antes de que arranque la sesión**
  (`sessions.status = pending`) — nunca a media partida.
- En compra individual B2C (amigos): `allowVideo` por defecto **`true`** — grupo de adultos que se
  conoce. Cada jugador sigue controlando su cámara individualmente (encender/apagar); el flag solo
  fija el permiso del token, no fuerza a nadie a publicar.
- El token es la única fuente de verdad del permiso real: el flag decide **qué permiso se firma**
  al generar el token de join, no una restricción de UI eludible.

## 5. Grabación opcional para eventos corporativos (RRHH)

### 5.1 Cuándo existe esta opción

- **Disponible únicamente para eventos no educativos.** Usa el campo `events.audience:
  'general' | 'educational'`: si `audience = 'educational'`, la opción de grabar **ni siquiera
  aparece** en el panel. No es una casilla que un profesor pueda marcar por error: es una rama de
  producto distinta.
- Pensada para el caso RRHH: una empresa hace un team building y quiere una prueba/recuerdo, no
  vigilancia continua.

### 5.2 Consentimiento — todo o nada, nunca silencioso

- El organizador activa `recordingEnabled: true` al crear el evento, aceptando un texto explícito
  ("declaro que informaré a los participantes y solicitaré su consentimiento antes de la sesión").
  Queda constancia de quién lo activó y cuándo (patrón de auditoría).
- **Cada participante**, al unirse a una sesión con grabación activada, ve una pantalla de
  consentimiento explícito **antes de conectar a LiveKit** (antes del `join`, no después) y debe
  aceptar para continuar.
- **Si un solo participante rechaza, esa sesión no se graba** — no hay grabación parcial porque
  una grabación compuesta mezcla todas las pistas en un único archivo y separar a una persona no
  es limpio. Decisión deliberadamente conservadora: todo el grupo con consentimiento unánime, o
  nada.
- Base legal: **consentimiento explícito** (no interés legítimo), única base defendible para
  grabar voz e imagen de personas identificables en contexto laboral. El desarrollo legal completo
  es cosa de `specs/18-legal-rgpd-y-menores.md`.

### 5.3 Implementación técnica

- **LiveKit Egress** (composición de room a archivo), self-hosted, saliendo a **Cloudflare R2**.
- Egress se dispara al confirmarse el consentimiento unánime (no al crear el evento). Si nadie ha
  aceptado al arrancar, la sesión no se graba y el panel muestra
  `recordingStatus: 'not_recorded_no_consent'`.
- Tabla nueva (`event_recordings`):

```sql
CREATE TABLE event_recordings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES sessions(id),
  egress_id        text NOT NULL,
  storage_path     text,                    -- ruta en R2, null hasta que termina
  consent_status   text NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending', 'unanimous', 'declined')),
  status           text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'recording', 'ready', 'failed', 'deleted')),
  retention_until  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
```

- **Retención por defecto: 90 días** desde `ready`, borrado automático (job programado, mismo
  mecanismo que la caducidad de `access_keys`). El organizador puede pedir el borrado antes en
  cualquier momento (`DELETE /api/events/:id/recordings/:id`) o extender la retención
  explícitamente (nunca por defecto indefinida).
- **Acceso:** solo miembros de la organización con `org_role IN ('owner','admin')` pueden generar
  la URL de descarga firmada (24 h, mismo patrón que el export de PDF).
- La grabación **nunca** pasa por el pipeline de moderación de contenido: es privada de la
  organización, no contenido publicado.

## 6. Resumen de valores por defecto

| Contexto | Audio por defecto | Vídeo por defecto | Grabación disponible |
|---|---|---|---|
| Compra individual (B2C, amigos) | Activo | Activo (cada jugador controla el suyo) | No |
| Evento `audience: general` (empresas) | Activo | Apagado, activable por el organizador antes de empezar | Sí, con consentimiento unánime |
| Evento `audience: educational` (aulas) | Activo | Apagado, activable por el organizador antes de empezar | No disponible en absoluto |

## 7. Dependencias

- `specs/11-protocolo-multijugador.md` §8 — firma y permisos del token.
- `specs/14-modelo-de-datos-sql.md` — `events.config`, `event_recordings`, `platform_settings`.
- `specs/24-operaciones-y-escalabilidad.md` §2.5 — separación a nodo propio.
