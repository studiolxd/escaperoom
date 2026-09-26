# @escaperoom/e2e

Suite E2E con navegador (Playwright, `docs/specs/22-qa-y-pruebas.md` §3, ticket 6.5) y prueba
de carga con clientes de protocolo.

| Spec                                      | Qué recorre                                                                                                                                                                                 | Dónde corre                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `tests/game.reyaldric.spec.ts` `@smoke`   | 2 `BrowserContext` se unen por el link de invitación, empiezan y resuelven el Salón del Trono (pasos 1–6) por clics hasta entrar juntos en la Bodega                                        | PR (job `e2e-smoke`) y nightly |
| `tests/game.reyaldric.spec.ts` (completa) | Los 14 pasos del Rey Aldric por clics (mural, memoria por turnos, mirillas, canal…) hasta «¡Victoria!» en los dos navegadores                                                               | nightly                        |
| `tests/event-flow.spec.ts`                | Organizador crea evento → lote de claves → PDF desde el panel → invitado sin cuenta canjea en `/redeem?code=` → juega los pasos 1–5 → el panel abierto refleja el progreso                  | nightly                        |
| `tests/editor-publish.spec.ts`            | Copia regalo del Rey Aldric → 2 pestañas coeditan la luz ambiente y convergen → «Validar» en verde → `publish` (MCP) + «Publicar ahora» → catálogo; el paquete publicado lleva lo coeditado | nightly                        |
| `tests/purchase-flow.spec.ts`             | Compra con Stripe test mode — **saltada (`fixme`) hasta el ticket 5.1**                                                                                                                     | —                              |
| `load/ten-sessions.ts`                    | 10 sesiones simultáneas × 2 clientes de protocolo, ruta completa; compara latencias con una sesión sola                                                                                     | nightly                        |

## Ejecutar en local

```sh
pnpm infra:up && pnpm dev:env            # Postgres (y la base propia del worktree)
pnpm --filter @escaperoom/shared build   # cliente de Prisma
pnpm --filter @escaperoom/e2e e2e:install   # Chromium de Playwright (una vez)

pnpm --filter @escaperoom/e2e e2e        # suite completa
pnpm --filter @escaperoom/e2e e2e:smoke  # solo el subset de PR
pnpm --filter @escaperoom/e2e load       # prueba de carga (servidor Colyseus en proceso)
```

Playwright arranca solo los tres procesos (`scripts/serve.ts`) con el entorno de
`support/env.ts`: **web** (`next build` + `next start`) en `:3100`, **colyseus-server** en
`:2667` y **editor-sync** en `:2668` — puertos propios para convivir con `pnpm dev`. El
`global-setup.ts` aplica migraciones y el seed (idempotentes; no borra nada).

- La web se compila en cada ejecución (≈1–2 min). Para iterar sin tocar `web`,
  `E2E_REUSE_BUILD=1` reutiliza la última build de la suite si su entorno público coincide.
- `E2E_REUSE_SERVERS=1` reutiliza servidores ya arrancados en esos puertos (p. ej. con
  `pnpm exec tsx scripts/serve.ts web` en otra terminal) y `E2E_SKIP_DB_SETUP=1` salta
  migraciones y seed.
- Base de datos: `DATABASE_URL` exportada o, si no, la de `packages/shared/.env`.
- Prueba de carga contra un servidor ya levantado: `E2E_LOAD_URL=ws://localhost:2667`.

Sin servicios externos: los emails van por `jsonTransport` y las colas están apagadas. El
enlace mágico de Better Auth se envía por ese transporte (A-1: ya no se imprime en ningún
log); `support/auth.ts` lee su token de la tabla `verification` de Postgres para iniciar
sesión. Web y colyseus arrancan con `NODE_ENV=production`, así que necesitan `REDIS_URL`
(rate limiting, como en producción) además de la base de datos — `support/env.ts` usa
`REDIS_URL`/`E2E_REDIS_URL` exportada o, por defecto, `redis://localhost:6379` (el
servicio Redis sin contraseña que levantan `e2e-smoke`/`e2e-nightly` en CI). LiveKit va
sin configurar (la partida degrada a «sin medios»). Los límites anti-abuso del ticket 6.3
**siguen encendidos**: los jugadores de los tests van a ritmo de persona (≥ 550 ms entre
intentos del mismo puzzle).

**Redis en local**: el default (`redis://localhost:6379`) no es el mismo Redis de
`pnpm infra:up` (ese vive en `56380` y, desde E-13, pide contraseña) — necesitas uno propio
en `6379`. Dos opciones:

```sh
# 1) Un Redis suelto sin contraseña en 6379 (más simple, igual que en CI):
docker run --rm -p 6379:6379 redis:7-alpine

# 2) Reutilizar el Redis de infra/docker-compose.dev.yml (56380, con requirepass):
E2E_REDIS_URL=redis://:redis_dev_only@localhost:56380 pnpm --filter @escaperoom/e2e e2e:smoke
```

## CI

- **PR** — job `e2e-smoke` de `.github/workflows/ci.yml`: Postgres + Redis de servicio + el
  smoke (≈1 min de test más el build de Next).
- **Nightly** — `.github/workflows/e2e-nightly.yml` (cron 02:30 UTC y `workflow_dispatch`):
  Postgres + Redis de servicio, suite completa, `mcp-parity` y la carga. Si falla, abre o
  comenta un issue con la etiqueta `e2e-nightly` y sube el informe como artefacto.

Paso manual para el mantenedor: que `e2e-smoke` **bloquee el merge** (specs/22 §3.4) es
cuestión de marcarlo como check obligatorio en la protección de la rama `main`
(Settings → Branches); este ticket no toca la protección de rama.

## Problemas conocidos

- Con Prisma 6 (`prisma-client-js`) veías aquí `Prisma Client could not locate
  the Query Engine` cuando `packages/shared/generated/client` venía de la
  caché de turbo de **otro worktree** (binario nativo por plataforma). Desde
  la migración a Prisma 7 (generador `prisma-client`, adaptador
  `@prisma/adapter-pg`, sin motor de Rust) esto ya no puede pasar: el cliente
  generado es solo TypeScript, sin binario que dependa de la plataforma del
  worktree que lo generó. Si `pnpm --filter @escaperoom/shared build` no se
  ha corrido tras un cambio de `prisma/schema.prisma`, el síntoma ahora es un
  error de tipos o de módulo no encontrado, no de motor — regenerarlo con
  `pnpm --filter @escaperoom/shared exec prisma generate` sigue siendo el
  arreglo.
