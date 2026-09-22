# Reutilización del andamiaje de SLXD

Este documento mapea qué se reutiliza del monorepo **SLXD** (`/Users/suvi/Dev/slxd`) en este
proyecto, cómo se adapta y qué se descarta. Responde al [ADR-017](registro-de-decisiones.md).

Reglas:

1. **Origen de solo lectura.** `/Users/suvi/Dev/slxd` se lee y se copia **desde** él; jamás se edita,
   se commitea ni se ejecuta desde este proyecto.
2. **Namespace propio.** El código copiado pierde el prefijo `slxd`/`@slxd` y pasa al namespace del
   proyecto. No se conserva nada específico de "la suite".
3. **Nada de secretos.** Se copia código y configuración, nunca `.env*`, claves ni datos.
4. **Adaptar, no arrastrar.** Se poda todo lo ligado al modelo multi-producto (plano de control
   `account`, Keycloak, claims, DS `@studiolxd/brand`, catálogo de suite, seis idiomas).

---

## 1. Se reutiliza (copiar / adaptar)

| Origen en SLXD | Destino en este proyecto | Modo | Fase / ticket |
|---|---|---|---|
| `packages/config` (presets `tsconfig`, ESLint, reglas de frontera, Vitest) | `packages/config` | adaptar (quitar reglas de suite/brand) | 0.1 |
| `packages/env` (`zod`, `guardServerKeys`, helpers server/cliente) | `packages/shared/env` | copiar/adaptar nombres | 0.1 |
| `turbo.json`, `pnpm-workspace.yaml` (catálogo/overrides), `package.json` raíz | raíz del monorepo | adaptar | 0.1 |
| `scripts/verify.sh` (puerta de calidad: install+lint+typecheck+test, `--compile/--e2e`) | `scripts/verify.sh` | adaptar (apps y puertos) | 0.1 |
| `scripts/dev-env.sh` (generación idempotente de `.env.local`) | `scripts/dev-env.sh` | adaptar (servicios y secretos) | 0.1/0.2 |
| `infra/docker-compose.dev.yml` — Postgres, Redis, MinIO (+init de buckets) | `infra/docker-compose.dev.yml` | podar y ampliar (ver §3) | 0.2 |
| `infra/Dockerfile.app`, `infra/docker-entrypoint.sh` | `infra/` | adaptar | 0.2 |
| `packages/kit` (logger, redis, rate-limit, audit, storage/R2, webhooks salientes, colas/jobs, cifrado en reposo, health de workers, **infraestructura tRPC**) | `packages/shared/kit` | adaptar (se conserva la infraestructura tRPC de la UI, ADR-022; se quitan los espejos entre apps) | 0.2, 0.7, 2.x |
| `packages/mailer` (un transporte, SMTP + Resend) | `packages/shared/mailer` | copiar/adaptar (Nodemailer/SMTP por defecto, ADR-020) | 5.6 |
| i18n de SLXD (**next-intl**, locales `en es fr de nl pt`; `messages`/`validation`) | `packages/web` i18n + catálogo de textos | adaptar (solo `es` obligatorio al principio, ADR-018) | 0.9 |
| `packages/roles` (roles/permisos de organización) | `packages/shared/roles` | adaptar al modelo de orgs del proyecto | 0.3, 5.11 |
| `packages/mcp-server` (pipeline de petición, registro de tools, gate de confirmación) | `packages/mcp-server` | adaptar | 4.1, 4.4, 4.5 |
| `packages/mcp-auth` (OAuth 2.1 mínimo: PKCE + DCR) | auth del MCP | adaptar (login contra Better Auth, no account) | 4.7 |
| `packages/ai-chat` (chat en streaming con tools, hilos, cobro por créditos) | chat del creador | adaptar | 4.6, 4.9 |
| `packages/validation` + `packages/messages` (patrón Zod error map + catálogo de textos) | validación de formularios | inspirar (una sola fuente; solo `es` por ahora) | 0.6, 3.x |

## 2. No se reutiliza (descartar)

| Origen en SLXD | Motivo |
|---|---|
| `apps/account` (plano de control), Keycloak, flujo de claims/webhook | Este proyecto es un producto único: no hay 12 apps que federar. Better Auth cubre la sesión. |
| `packages/entitlements`, `packages/auth-client` | Contrato hub↔app multi-tenant; sustituido por la sesión de Better Auth y por el modelo de negocio propio. |
| `packages/app-shell`, `packages/public-shell`, `packages/billing-ui`, DS `@studiolxd/brand` | Dependen del DS BEM de la suite. Sustituidos por **Tailwind CSS + shadcn/ui** (ADR-019). |
| `packages/catalog`, `packages/plans` | Modelo comercial de la suite, no de este producto. |
| `packages/legal`, `packages/messages` en 6 idiomas | Textos ajenos; el proyecto arranca en `es` con `LocalizedText` (specs/08). |
| `prisma-platform-sync.mjs`, Prisma-por-app | El proyecto usa **una** base de datos con varias tablas (ADR-015). |
| ClickHouse, Gatus/`status`, `monitor` | Analítica en PostgreSQL (`analytics_events`, specs/16); el panel de estado no es de v1. |

## 3. Poda y añadidos del compose local

- **Se conserva**: Postgres, Redis, MinIO (+ init de buckets), PgBouncer.
- **Se poda**: ClickHouse, Gatus/`gatus-proxy`.
- **Se añade**: **LiveKit** self-hosted y **coturn** (specs/12), que SLXD no tiene.

## 4. Dependencias

- [ADR-015/016/017](registro-de-decisiones.md) — ORM, auth y esta reutilización.
- `specs/03-arquitectura-y-stack.md` §4–§5 — monorepo, infra e infraestructura de entorno.
- `specs/10-mcp-del-creador.md` — toolset que se apoya en `mcp-server`/`mcp-auth`.
