# 03 — Arquitectura y stack

Depende de `01-vision-y-alcance.md`. El porqué de cada elección y las alternativas descartadas
están en `reference/registro-de-decisiones.md`.

---

## 1. Stack final

```
Aplicación (catálogo, perfiles, checkout, dashboard, editor UI):  Next.js (TypeScript)
Juego (runtime de salas):                                         Phaser 3, embebido en Next.js
Editor de salas:                                                  Next.js + Yjs + el propio runtime en modo edición
Partidas (estado autoritativo, 1–N jugadores):                    Colyseus (Node.js + WebSocket)
Chat de texto:                                                    canal de la room de Colyseus
Voz y webcam:                                                     LiveKit (self-hosted, WebRTC) + coturn
Agente IA creador:                                                Servidor MCP (TypeScript, MCP SDK)
API de la UI (web/editor):                                        tRPC (v11)
API pública:                                                      REST /api/* (terceros, webhooks) + catálogo anónimo
Lógica de dominio:                                                packages/shared/services (única fuente: la usan tRPC, REST, MCP y Colyseus)
Colaboración en edición:                                          Yjs (CRDT) sobre PostgreSQL
Base de datos:                                                    PostgreSQL (JSONB para RoomPackage)
ORM / migraciones:                                                Prisma (packages/shared/db)
Caché / presencia / colas:                                        Redis
Assets:                                                           Cloudflare R2 (compatible S3)
Pagos:                                                            Stripe + Stripe Connect
Emails transaccionales:                                           Nodemailer (SMTP) por defecto; Resend opcional
PDF de tarjetas-clave:                                            pdf-lib + qrcode (JS puro; ticket 5.7)
Auth:                                                             Better Auth — email mágico + Google + organizaciones
UI / estilos:                                                     Tailwind CSS + shadcn/ui
i18n:                                                             next-intl (locales en, es, fr, de, nl, pt; por defecto es)
Tests:                                                            Vitest (unitario + integración) + Playwright (E2E)
Infraestructura:                                                  Docker + VPS (Hetzner) + Cloudflare + GitHub Actions
```

Todo el producto queda en **TypeScript end-to-end**, incluido Colyseus (nativo en TS). Un solo
lenguaje, un solo equipo, un solo build.

## 2. Decisiones clave (resumen)

| Decisión | Elección | Por qué (resumen) |
|---|---|---|
| Cliente de juego | **Phaser 3**, híbrido con React | Web-only, TS; tilemaps isométricos, cámara e input resueltos; webcam/WebRTC y UI rica naturales en DOM. Godot/PixiJS descartados. |
| Multijugador | **Colyseus** sobre Node | Añade gestión de salas, estado autoritativo sincronizado, reconexión y matchmaking sobre Node WS. |
| Colaboración editor | **Yjs** (CRDT) | Convergencia sin autoridad: ideal para co-edición y offline. **No** se usa para la partida (necesita autoridad central). |
| Framework web | **Next.js** | No compite con React: es React con SSR (SEO del catálogo = canal de adquisición). |
| Voz/webcam | **LiveKit** self-hosted | SFU maduro, SDK JS, 1–N sin mesh; la room de medios vive y muere con la de Colyseus. |
| Validación | **Servidor siempre** | Anti-trampa y coherencia; el cliente nunca marca `solved`. |
| Editor | **El editor ES el runtime** en modo edición | WYSIWYG absoluto y un solo código; elimina el riesgo "en el editor se ve bien, en el juego falla". |
| Formato | **JSON declarativo** | Un único `RoomPackage` para editor, API, BD, MCP y runtime; sin código arbitrario del creador. |
| MCP | **Mismos servicios de dominio** | El editor (tRPC), la API pública (REST) y el MCP llaman a la misma capa de servicios; paridad por lógica compartida (ADR-010/022). |
| API | **tRPC (UI) + REST /api/* (público)** | tRPC da ergonomía tipada a la UI; REST sirve a terceros, webhooks y catálogo anónimo. Las dos sobre los servicios (ADR-022). |
| ORM/migraciones | **Prisma** | Alinea con el andamiaje de SLXD y con el port de identidad/ledger; tipos compartidos (ADR-015). |
| Auth | **Better Auth** | Plugin de organizaciones (miembros, roles, invitaciones) y alineación con SLXD (ADR-016). |
| Reutilización | **Andamiaje de SLXD podado** | Tooling, infra y backend (incl. MCP) se copian/adaptan; no se arrastra el multi-tenant ni el DS (ADR-017). |
| i18n | **next-intl** | Misma solución y set de locales que SLXD (`en es fr de nl pt`), `es` por defecto; `RoomPackage` ya es multiidioma (ADR-018). |
| UI / estilos | **Tailwind CSS + shadcn/ui** | Componentes accesibles y propios en el repo, sin DS opaco; se descarta el DS BEM de SLXD (ADR-019). |
| Email | **Nodemailer (SMTP)**, Resend opcional | Un solo transporte con dos proveedores (patrón de `@slxd/mailer`); SMTP por defecto (ADR-020). |
| Tests | **Vitest + Playwright** | Unitario/integración rápidos y E2E en navegador real; reutiliza el tooling de SLXD (ADR-021). |
| Créditos IA | Pool interno de plataforma | Tokens a nivel de plataforma con margen; subsistema copiado de SLXD. |

## 3. Arquitectura del cliente: híbrido Phaser + React

```
┌─────────────────────────────────────────────┐
│  Capa React (DOM, overlay sobre el canvas)  │
│  HUD, inventario, diálogos, chat, webcam,   │
│  menús y puzzles que se abren como panel    │
├─────────────────────────────────────────────┤
│  Capa Phaser (canvas)                       │
│  Mapa isométrico, avatares, objetos,        │
│  animaciones, efectos, cámara               │
└─────────────────────────────────────────────┘
```

**Regla de oro para decidir dónde va cada cosa:** ¿el puzzle es **parte del mundo** o **abre un
panel**?

- **Parte del mundo → Phaser.** Llave escondida tras el cuadro, placas que se pisan, mural en la
  pared, engranajes, luz y espejos.
- **Abre un panel/caja → React.** Candado numérico, memoria, deslizante, tuberías, circuito,
  balanza, sudoku. Son formularios e interfaces: el terreno natural de React.

Comunicación entre capas:

- **Store Zustand conectado al cliente Colyseus** es el puente. Ambas capas leen/escriben el
  mismo estado de partida y reaccionan a él.
- Phaser vive en un componente React (`<GameCanvas room={...} />`) montado con `useRef`.
- El overlay React va sobre el canvas con `pointer-events: none` en el contenedor y `auto` en
  los elementos interactivos.
- Colyseus vive en la capa React y alimenta a ambas: el servidor muta el estado → Zustand se
  actualiza → Phaser anima y React pinta el HUD.

**Bonus del diseño:** el editor reutiliza los componentes React de puzzle; el mismo
`<LockPuzzle>` sirve para editar, previsualizar y jugar. Los puzzles en React son testeables con
testing-library, y el i18n/temas/accesibilidad se resuelven con infraestructura estándar.

## 4. Monorepo

```
packages/
├── web/                 ← Next.js: catálogo, perfiles, checkout, dashboard; rutas tRPC (UI),
│                          REST /api/* y endpoint MCP `/mcp/creator`
├── game-runtime/        ← Phaser: runtime de salas (modo play y modo edit) + componentes React de puzzle
├── editor/              ← UI del editor (Next.js) + Yjs + React Flow
├── mcp-server/          ← @slxd/mcp-server adaptado: pipeline, tools sobre servicios, OAuth 2.1 (@slxd/mcp-auth)
├── colyseus-server/     ← rooms autoritativas, motor de reglas, validación de puzzles
├── kit/                 ← @escaperoom/kit: infraestructura común reutilizable (logger,
│                          redis, rate-limit, storage S3/R2, colas/eventos BullMQ y
│                          health de workers); sin la infraestructura tRPC (la consume el 0.10)
├── worker/              ← @escaperoom/worker: procesos de cola (analítica → analyticsEvent);
│                          consume Redis y escribe vía Prisma (@escaperoom/shared/db)
└── shared/
    ├── services/        ← **única lógica de dominio** (salas, objetos, puzzles, reglas, eventos, créditos)
    │                      la invocan tRPC, REST, MCP y Colyseus con un `actor` (ADR-022)
    ├── schemas/         ← Zod: PuzzleDefinition, Rule, RoomPackage, mensajes de protocolo…
    ├── templates/       ← catálogo de plantillas con sus configs
    ├── validator/       ← validador + test de solvabilidad (usado por API, editor y MCP)
    ├── simulators/      ← simuladores (rayo, engranajes, alcanzabilidad) reutilizados por runtime/validador/MCP
    └── db/              ← Prisma: schema y migraciones (tipos compartidos con API, Colyseus y MCP)
```

- Tooling: pnpm workspaces + Turborepo; TS estricto; ESLint/Prettier; GitHub Actions
  (lint + test + build).
- **Base de andamiaje:** el tooling (`packages/config`, `packages/env`, `scripts/verify.sh`,
  `dev-env.sh`), la infra local y la infraestructura de backend (`kit`, `mailer`, `roles`, eje MCP)
  se importan y adaptan de SLXD (ADR-017; mapeo y poda en `reference/reutilizacion-slxd.md`).
- Principio "cero deriva de tipos": los mismos esquemas Zod y los mismos tipos de Prisma Client se
  comparten entre web, Colyseus, MCP y validador.

## 5. Infraestructura y despliegue

### 5.1 v1 (MVP)

- **Docker Compose en un VPS (Hetzner)** con: web, colyseus, LiveKit, coturn, PostgreSQL, Redis.
- **Cloudflare** delante: CDN + SSL + protección; catálogo SSR cacheado en el edge.
- **R2** para assets y grabaciones (almacenamiento externo).
- **GitHub Actions**: CI/CD (lint, tests, migraciones desde cero, build).
- Coste estimado: **10–20 €/mes** + LiveKit self-hosted en el mismo VPS.

### 5.2 Entornos

| Entorno | Uso |
|---|---|
| Local (`docker-compose`) | Postgres, Redis, MinIO (S3 local), LiveKit local. `pnpm db:migrate` + `pnpm db:seed` |
| CI | Postgres/Redis efímeros, migraciones desde cero, E2E del Rey Aldric como smoke test |
| Staging | Réplica de producción para playtest y pruebas de carga |
| Producción | VPS único en v1, escalado por fases (`24-operaciones-y-escalabilidad.md`) |

El seed de desarrollo/CI carga: usuario admin, creador de ejemplo y el Rey Aldric publicado
como `roomVersion` real → el entorno arranca siempre con contenido jugable.

### 5.3 Variables y secretos

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- `DATABASE_URL`, `REDIS_URL`, `R2_*`.
- `ELEVENLABS_API_KEY`; email: `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`EMAIL_FROM`
  (Nodemailer, por defecto) y, opcional, `RESEND_API_KEY`.
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MCP_OAUTH_*`.

Nunca se commitean secretos. Rotación y auditoría básica en Fase 6.

## 6. Flujo de datos (vista de conjunto)

```
Next.js (web/editor UI)
  ├── tRPC (UI) ────────────────► routers ──┐
  ├── REST /api/* ─────────────► handlers ─┤──► servicios de dominio ──► PostgreSQL / Redis / R2
  ├── WebSocket edición (Yjs) ──► backend de edición ──────────────────► room_updates / room_snapshots
  ├── WebSocket partida ────────► Colyseus GameRoom ───────────────────► GameState (en vivo) + Postgres
  └── WebRTC ───────────────────► LiveKit SFU (+ coturn) ──────────────► audio/vídeo en tránsito
MCP /mcp/creator (OAuth) ───────► tools ──────────────────────────────► servicios de dominio
Webhook Stripe ─────────────────► /api/stripe/webhook ──► cola Redis ──► transfers / activaciones
```

- tRPC, REST, el MCP y Colyseus invocan los **mismos servicios de dominio** (`shared/services`);
  REST y Colyseus son **procesos distintos** pero comparten lógica y base de datos.
- Los recursos pesados (transfer a Connect, generación de claves, PDF) se delegan a colas Redis.
- La analítica se emite por cola Redis → worker → `analyticsEvent`; nunca bloquea el game loop.

## 7. Dependencias

- `specs/11-protocolo-multijugador.md` — arquitectura de rooms y mensajes.
- `specs/12-voz-y-webcam-livekit.md` y `specs/24-operaciones-y-escalabilidad.md` — despliegue.
- `reference/registro-de-decisiones.md` — ADR completo.
