# Infra local

Dependencias de desarrollo en Docker (adaptado de SLXD, ADR-017). Las apps
corren en el host con `pnpm dev`; esto solo levanta Postgres, Redis, MinIO,
LiveKit y coturn.

```bash
pnpm infra:up      # docker compose up -d
pnpm infra:down    # docker compose down
pnpm dev:env       # crea packages/shared/.env con la BD de ESTE worktree
pnpm db:reset      # migra 0001–0010 desde cero y siembra (admin + creador + Rey Aldric)
pnpm db:migrate    # aplica migraciones Prisma (directo a Postgres)
pnpm db:seed       # admin + creador + Rey Aldric publicado
```

> El `.env` de Prisma vive en `packages/shared/.env`. No crees también
> `packages/shared/prisma/.env`: Prisma cargaría los dos y fallaría por conflicto
> de variables.

## Una base de datos por worktree (ticket 0.12)

Varios worktrees comparten el **mismo** contenedor Postgres, así que si todos
migran y siembran contra la misma base se pisan. `pnpm dev:env` aísla cada
worktree en su propia base:

| Worktree                                 | Base de datos                      |
| ---------------------------------------- | ---------------------------------- |
| Principal (`/Users/suvi/Dev/escaperoom`) | `escaperoom`                       |
| Cualquier `git worktree add`             | `escaperoom_<slug del directorio>` |

El script es **idempotente**: deriva el slug del path, crea la base en el
contenedor si falta (`docker compose … exec -T postgres createdb …`) y escribe
`packages/shared/.env` (`DATABASE_URL` y `DIRECT_URL`, ambos directos a
`localhost:55433`). **No pisa un `.env` existente**; para reescribirlo:

```bash
pnpm dev:env -- --force
```

Flujo típico en un worktree nuevo:

```bash
pnpm install
pnpm infra:up
pnpm dev:env && pnpm db:reset
```

> El `DIRECT_URL` apunta al Postgres directo (55433), no a PgBouncer: tras un
> `migrate reset` los planes cacheados del pooler quedan inválidos (ENUMs
> recreados).

## Puertos (no estándar, para no chocar con otras suites)

| Servicio            | Host                    | Contenedor  |
| ------------------- | ----------------------- | ----------- |
| Postgres            | 55433                   | 5432        |
| PgBouncer (app)     | 56433                   | 5432        |
| Redis               | 56380                   | 6379        |
| MinIO API / consola | 9002 / 59002            | 9000 / 9001 |
| LiveKit (ws)        | 7880                    | 7880        |
| LiveKit RTC         | 7881 (tcp) / 7882 (udp) | idem        |
| coturn              | 3478 (tcp/udp) / 5349   | idem        |

## URLs

- Postgres (dev, directo): `postgresql://postgres:postgres@localhost:55433/escaperoom`
- PgBouncer (opcional, paridad de pooling): `postgresql://postgres:postgres@localhost:56433/escaperoom`
- Redis: `redis://localhost:56380`
- MinIO: `http://localhost:9002` (usuario/clave `minioadmin`)

> En dev se va directo a Postgres (55433). PgBouncer (56433) existe para probar
> paridad de pooling, pero tras un `migrate reset` hay que reiniciarlo
> (`docker compose -f infra/docker-compose.dev.yml restart pgbouncer`) porque
> sus planes cacheados referencian los ENUMs viejos.

## Notas

- **coturn en macOS**: el networking de Docker limita TURN; sirve para probar el
  flujo, no como espejo de producción (donde va en el VPS con red host).
- **LiveKit**: claves de desarrollo (`devkey`/`secret`) en `livekit/livekit.yaml`.
