# Fase 0 — Cimientos (semanas 1–2)

**Objetivo:** monorepo listo y "Hola mundo" isométrico multijugador.
**Depende de:** nada. **Hito:** dos navegadores mueven avatares en un tilemap isométrico sincronizado,
y el esquema RoomPackage + seed del Rey Aldric cargan en local.

Referencias: `specs/03-arquitectura-y-stack.md`, `specs/14-modelo-de-datos-sql.md`,
`specs/11-protocolo-multijugador.md`, `reference/reutilizacion-slxd.md` (ADR-015/016/017).

---

| # | Ticket | Detalle | Spec | Criterio de aceptación |
|---|---|---|---|---|
| 0.1 | **Monorepo + tooling (base SLXD podada)** | pnpm workspaces + Turborepo con base importada/adaptada de SLXD (`@slxd/config`, `@slxd/env`, `turbo.json`, catálogo del workspace, `scripts/verify.sh`, `scripts/dev-env.sh`), namespace propio; `packages/{web, game-runtime, editor, mcp-server, colyseus-server, shared}`; TS estricto; **Vitest + Playwright** (presets de SLXD); CI (lint+test+build) | `03` §4, ADR-017/021 | `pnpm build` y `pnpm test` en verde vía `scripts/verify.sh`; CI corre en cada PR |
| 0.2 | **Infra local** | Docker Compose (base de SLXD podada: sin ClickHouse ni Gatus) con PostgreSQL, Redis, MinIO (S3 local) y **añadido de LiveKit + coturn**; migraciones con **Prisma** (`packages/shared/db`); `@slxd/kit` adaptado (logger, redis, storage, colas, health) | `14`, `03` §5.2, ADR-015 | `pnpm db:migrate` aplica 0001–0010 desde cero; `pnpm db:seed` carga admin + creador + Rey Aldric publicado |
| 0.3 | **Auth + usuarios/orgs** | **Better Auth** con plugin de organización: email mágico + Google; tablas `users`, `oauth_identities`, `organizations`, `organization_members` (vía Better Auth + Prisma); sesión por cookie + Bearer; `@slxd/roles` adaptado | `13` §2, `14` §3, ADR-016 | Registro/login OAuth y email; `/api/me` devuelve perfil con organizaciones y rol |
| 0.4 | **Canvas híbrido** | Next.js monta Phaser en `<GameCanvas>`; overlay React con `pointer-events`; store Zustand compartido; base de **Tailwind CSS + shadcn/ui** | `03` §3, ADR-019 | Se ve un tilemap isométrico de prueba y un HUD React (con primitivos shadcn) encima, ambos leyendo el mismo store |
| 0.5 | **Movimiento multijugador** | Colyseus room `lobby_test`: 2 clientes mueven avatares isométricos y se ven en tiempo real (interpolación + validación de salto) | `11` §3–4 | Dos navegadores ven los dos avatares moverse; el servidor rechaza teletransporte |
| 0.6 | **Schemas Zod compartidos** | `packages/shared/schemas`: `RoomPackage`, `PuzzleDefinition` (base), `Rule`; validación del JSON del Rey Aldric | `08`, `06` | El fixture del Rey Aldric valida contra el schema; un JSON inválido falla con error claro |
| 0.7 | **Analítica base** | Endpoint de colección + cola Redis + worker → `analytics_events`; emisión desde Next API | `16`, `14` §8 | Insertar un evento de prueba desde API llega a `analytics_events` sin bloquear la request |
| 0.8 | **Import script SLXD (esqueleto)** | Script `scripts/import-slxd-ledger.ts` sobre el esquema Prisma destino (mapeo pendiente del DDL real) | `14` §12, `15` §2 | El script corre en seco contra un fixture; documenta el mapeo a completar |
| 0.9 | **i18n base (next-intl)** | Routing de locales, catálogo `es` y carga de mensajes; locales `en, es, fr, de, nl, pt` con `es` por defecto | `03` §1, ADR-018 | Una página de prueba renderiza su copy en `es` y el selector de idioma cambia de locale |

## Hito 0

Dos navegadores mueven avatares en un tilemap isométrico sincronizado, con infra local levantada por
Docker Compose, migraciones aplicadas y el Rey Aldric como seed cargable.
