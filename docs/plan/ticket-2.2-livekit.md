# Ticket 2.2 — LiveKit + coturn (voz y webcam)

Referencias: `specs/12` §1–4, `specs/11` §8, `docs/plan/fase-2-cooperativo.md` 2.2.

## Qué entra

- **Servidor** (`packages/colyseus-server/src/media/`): firma de token LiveKit por
  `GameRoom`, derivación `GameRoom.roomId ↔ room de LiveKit`, permisos por rol y
  degradación limpia si faltan credenciales. La room `lobby_test` responde al
  mensaje `request_media_token` con el payload `media_token` (specs/11 §8).
- **Web** (`packages/web`): overlay React de tiles de webcam/mic (`@livekit/components-react`),
  mute/unmute, estados `conectando / sin medios / en directo / error` y modo
  observador de solo-suscripción. El token y la URL llegan del servidor: el
  navegador no conoce las claves.

## Decisión: cámara por defecto

El lobby de desarrollo sigue la fila **B2C (amigos)** de `specs/12` §6:

- **Audio activo** al conectar (canal principal de coordinación).
- **Vídeo permitido** en el token (`canPublishVideo: true`, fuentes
  `microphone + camera`) y la cámara **se enciende al conectar**, pero cada
  jugador puede apagarla con su botón. El flag del token fija el permiso; no
  fuerza a nadie: apagar la cámara no requiere cambio de token.
- **Contexto educativo**: se fuerza `allowVideo: false` en el join (o
  `LIVEKIT_ALLOW_VIDEO=false` por entorno). Entonces el token solo permite
  `microphone` y el overlay muestra "Vídeo no permitido". Esto reproduce el
  `canPublishVideo: false` de `specs/12` §4 sin acoplarse todavía a
  `events.config.allowVideo` (llega con la fase de eventos).
- **Observador**: `canPublish: false`, `canPublishData: false`,
  `canSubscribe: true`. Nunca publica ni añade coste de publisher.

## Configuración (solo servidor)

Copia `packages/colyseus-server/.env.example` a
`packages/colyseus-server/.env`:

```bash
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Si falta cualquiera de las tres, la room funciona **sin medios**
(`configured: false`): el overlay muestra "LiveKit no configurado" y la partida
continúa por Colyseus. Opcionales: `LIVEKIT_ROOM_PREFIX`, `LIVEKIT_TOKEN_TTL_SECONDS`,
`LIVEKIT_ALLOW_VIDEO`.

La room de LiveKit se deriva del **`roomId`** de Colyseus (`escape-<roomId>`),
no del `name` de la clase: así cada partida (y cada sesión simultánea) queda
aislada, que es el requisito de `specs/12` §1.

## Probar con 2+ navegadores

Requisitos: `pnpm install`, Docker levantado y las apps en marcha.

```bash
pnpm infra:up                                   # LiveKit (7880/7881/7882) + coturn (3478/5349)
cp packages/colyseus-server/.env.example packages/colyseus-server/.env
pnpm dev                                        # web:3000 + colyseus:2567
```

1. Abre `http://localhost:3000/es/lobby` en **dos navegadores** (o uno normal +
   uno privado) para que cada uno tenga su propio `sessionId` y permisos de
   cámara.
2. Acepta los permisos de micrófono/cámara. Cada pestaña debería mostrar dos
   tiles; verás tu vídeo y el del otro jugador, y te oirás al hablar.
3. Usa **Silenciar mic / Activar mic** y **Apagar cámara / Encender cámara**:
   el tile del otro navegador refleja el estado (icono 🎤/🔇).
4. **Observador (solo-suscripción):** abre
   `http://localhost:3000/es/lobby?role=observer`. Entra sin publicar
   (no aparece su tile de cámara ni su micrófono) y sí recibe el audio/vídeo de
   los demás. El servidor lo confirma con `canPublish: false`.
5. **Sin medios (degradación):** renombra el `.env`, reinicia el servidor
   Colyseus y recarga: el overlay dice "sin medios" y la partida sigue.

> En `localhost` los navegadores permiten `getUserMedia` sin TLS. Si pruebas
> desde otra máquina, LiveKit/coturn necesitan TLS y un dominio real
> (`specs/12` §2).

## Tests (CI, sin infraestructura)

`packages/colyseus-server/test/media.test.ts` firma tokens con claves de prueba y
decodifica el JWT para comprobar identidad (`sub`), room (`video.room`),
`canPublish`/`canSubscribe`/`canPublishSources` por rol y TTL; además cubre la
derivación `GameRoom.roomId ↔ room` y la degradación sin claves.
`test/media-room.test.ts` comprueba el flujo real de la room (`configured:false`
y token de observador) y `packages/web/test/media.test.ts` la normalización del
payload en el cliente. El resto (SFU real, NAT/coturn, eco entre navegadores) es
prueba manual.
