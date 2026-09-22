# Fase 0 — Cimientos (semanas 1–2)

**Objetivo:** monorepo listo y "Hola mundo" isométrico multijugador.
**Depende de:** nada. **Hito:** dos navegadores mueven avatares en un tilemap isométrico sincronizado,
y el esquema RoomPackage + seed del Rey Aldric cargan en local.

Referencias: `specs/03-arquitectura-y-stack.md`, `specs/14-modelo-de-datos-sql.md`,
`specs/11-protocolo-multijugador.md`.

---

| # | Ticket | Detalle | Spec | Criterio de aceptación |
|---|---|---|---|---|
| 0.1 | **Monorepo + tooling** | pnpm workspaces + Turborepo; `packages/{web, game-runtime, editor, mcp-server, colyseus-server, shared}`; TS estricto, ESLint/Prettier; GH Actions (lint+test+build) | `03` §4 | `pnpm build` y `pnpm test` en verde; CI corre en cada PR |
| 0.2 | **Infra local** | Docker Compose: PostgreSQL, Redis, MinIO (S3 local), LiveKit local; migraciones con Drizzle (`packages/shared/db`) | `14`, `03` §5.2 | `pnpm db:migrate` aplica 0001–0010 desde cero; `pnpm db:seed` carga admin + creador + Rey Aldric publicado |
| 0.3 | **Auth + usuarios/orgs** | Auth.js: email mágico + Google; tablas `users`, `oauth_identities`, `organizations`, `organization_members`; sesión por cookie + Bearer | `13` §2, `14` §3 | Registro/login OAuth y email; `/api/me` devuelve perfil |
| 0.4 | **Canvas híbrido** | Next.js monta Phaser en `<GameCanvas>`; overlay React con `pointer-events`; store Zustand compartido | `03` §3 | Se ve un tilemap isométrico de prueba y un HUD React encima, ambos leyendo el mismo store |
| 0.5 | **Movimiento multijugador** | Colyseus room `lobby_test`: 2 clientes mueven avatares isométricos y se ven en tiempo real (interpolación + validación de salto) | `11` §3–4 | Dos navegadores ven los dos avatares moverse; el servidor rechaza teletransporte |
| 0.6 | **Schemas Zod compartidos** | `packages/shared/schemas`: `RoomPackage`, `PuzzleDefinition` (base), `Rule`; validación del JSON del Rey Aldric | `08`, `06` | El fixture del Rey Aldric valida contra el schema; un JSON inválido falla con error claro |
| 0.7 | **Analítica base** | Endpoint de colección + cola Redis + worker → `analytics_events`; emisión desde Next API | `16`, `14` §8 | Insertar un evento de prueba desde API llega a `analytics_events` sin bloquear la request |
| 0.8 | **Import script SLXD (esqueleto)** | Script `scripts/import-slxd-ledger.ts` con el esquema destino fijado (mapeo pendiente del DDL real) | `14` §12, `15` §2 | El script corre en seco contra un fixture; documenta el mapeo a completar |

## Hito 0

Dos navegadores mueven avatares en un tilemap isométrico sincronizado, con infra local levantada por
Docker Compose, migraciones aplicadas y el Rey Aldric como seed cargable.
