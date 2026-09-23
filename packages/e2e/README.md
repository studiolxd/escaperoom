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

Sin servicios externos: los emails van por `jsonTransport` y las colas están apagadas; el
«buzón» del enlace mágico de Better Auth es el log de la web (`.run/web.log`), de donde
`support/auth.ts` lo lee para iniciar sesión. LiveKit va sin configurar (la partida
degrada a «sin medios»). Los límites anti-abuso del ticket 6.3 **siguen encendidos**: los
jugadores de los tests van a ritmo de persona (≥ 550 ms entre intentos del mismo puzzle).

## CI

- **PR** — job `e2e-smoke` de `.github/workflows/ci.yml`: Postgres de servicio + el smoke
  (≈1 min de test más el build de Next).
- **Nightly** — `.github/workflows/e2e-nightly.yml` (cron 02:30 UTC y `workflow_dispatch`):
  Postgres + Redis de servicio, suite completa, `mcp-parity` y la carga. Si falla, abre o
  comenta un issue con la etiqueta `e2e-nightly` y sube el informe como artefacto.

Paso manual para el mantenedor: que `e2e-smoke` **bloquee el merge** (specs/22 §3.4) es
cuestión de marcarlo como check obligatorio en la protección de la rama `main`
(Settings → Branches); este ticket no toca la protección de rama.

## Problemas conocidos

- `Prisma Client could not locate the Query Engine` en `.run/web.log`: el
  `packages/shared/generated/client` viene de la caché de turbo de **otro worktree** (se
  ve en su `sourceFilePath`). Regenerarlo y volver a lanzar:
  `pnpm --filter @escaperoom/shared exec prisma generate`.
