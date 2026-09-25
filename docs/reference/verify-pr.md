# `pnpm verify:pr` — puerta de calidad local antes de push/PR

`scripts/verify-pr.sh` reproduce en local los dos jobs de `.github/workflows/ci.yml` (`verify` y
`e2e-smoke`) para que un agente que trabaja en un worktree de Orca detecte los mismos fallos que
vería en CI **antes** de hacer push, sin saturar el Mac del usuario mientras varios worktrees
trabajan a la vez (cada uno con su propia base de datos, ticket 0.12, pero compartiendo CPU, RAM y
la infra de `infra/docker-compose.dev.yml`).

Motivación concreta: la PR #142 falló en CI por un `e2e-smoke` que nadie había corrido en local y
por tests del editor que superan el timeout de 5 s del runner de CI (2 vCPU) sin superarlo en un
Mac de 10 núcleos. `pnpm verify:pr` no elimina esa clase de problema (ver "timeouts de CI" más
abajo), pero corre el mismo `e2e-smoke` en local cuando el diff lo justifica, que es la mitad
barata del problema.

```bash
pnpm verify:pr                  # solo los paquetes afectados por el diff con main
pnpm verify:pr --all            # fuerza lint/typecheck/test/build de todo el monorepo
pnpm verify:pr --e2e            # fuerza e2e-smoke aunque el diff no lo toque
pnpm verify:pr --no-e2e         # salta e2e-smoke aunque el diff sí lo toque
pnpm verify:pr --concurrency=N  # concurrencia de turbo (por defecto 50%; env VERIFY_PR_CONCURRENCY)
pnpm verify:pr --lock-timeout=N # segundos esperando el lock de máquina (por defecto 2700; env VERIFY_PR_LOCK_TIMEOUT)
pnpm verify:pr --cpu-throttle   # heurístico para tests sensibles al paralelismo — no fiable, ver más abajo
pnpm verify:pr --no-cache       # ignora la caché compartida de turbo entre worktrees
pnpm verify:pr --skip-install   # no corre `pnpm install` aunque cambie pnpm-lock.yaml
pnpm verify:pr --no-audit       # no corre `pnpm audit --prod` (paridad con el job `verify` de CI)
```

Requiere el worktree ya preparado: `pnpm infra:up`, `pnpm dev:env`, `pnpm db:migrate && pnpm
db:seed` (nunca `pnpm db:reset` desde un agente — [[feedback_db_reset_bloqueado]] en la memoria de
la coordinadora). El script no lo hace por ti. También requiere `jq` y `lsof` en el `PATH`
(los comprueba al arrancar y aborta con un mensaje claro si faltan — los necesita para parsear
el `--dry=json` de turbo y para comprobar los puertos del e2e).

Un fallo real de `turbo --affected --dry=json` (o de `jq` al parsear su salida) **aborta el
script** en vez de degradar en silencio a "ningún paquete afectado": una puerta de calidad que
termina en verde sin haber sabido qué verificar es peor que una que falla ruidosamente.

## Qué detecta como "afectado"

`pnpm turbo run ... --affected` (nativo desde turbo 2.x) compara el árbol de trabajo — commits
más cambios sin commitear — contra `main` y calcula el cierre transitivo de dependencias: si
cambias `packages/kit`, turbo ya marca como afectados a `web`, `colyseus-server` y `shared`
(que dependen de `kit`), no solo `kit`. `--all` se salta esa detección y corre el monorepo entero,
igual que hace CI. Si `turbo.json` o el `package.json` raíz cambian, turbo los trata como
dependencia global y marca **todo** como afectado — es lo correcto (afecta a la caché de todas las
tareas) pero significa que un cambio solo de configuración dispara una pasada completa.

## Por qué build va pegado a lint/typecheck/test (no se puede aislar)

`turbo.json` declara `dependsOn: ["^build"]` en `lint`, `typecheck` y `test`: aunque le pidas a
turbo solo `lint`, ya agenda el `build` de las dependencias de los paquetes afectados (verificado
con `turbo run lint --affected --dry=json`: al tocar un solo paquete, turbo agenda `build` de
prácticamente todo su árbol de dependencias). Por eso **no hay forma limpia de mantener el build
fuera del paso "ligero"** sin duplicar ese trabajo dos veces. `pnpm verify:pr` corre
`turbo run lint typecheck test build` en una sola invocación (igual que el job `verify` de CI) y
serializa **ese paso completo junto con `e2e-smoke`** bajo el lock de máquina — ver más abajo. Es
una serialización más amplia de lo que pedía el diseño original ("solo build y e2e"), pero
correcta: separar build del resto habría significado ejecutarlo dos veces o inventar una forma de
"pedir solo el build de las dependencias sin lint/typecheck/test del propio paquete", que turbo no
expone.

## Lock de máquina entre worktrees

Los pasos pesados (el `turbo run lint typecheck test build` de arriba, y `e2e-smoke`) se
serializan con un lock de ámbito **máquina** (no solo worktree) en
`~/.cache/escaperoom/verify-pr-lock/` (`VERIFY_PR_CACHE_ROOT` lo mueve). macOS no tiene `flock`
utilizable desde bash de forma portable, así que el lock es un `mkdir` atómico: el primero que
consigue crear el directorio es el dueño, escribe su PID y su ruta de worktree en
`verify-pr-lock/owner`, y lo borra al terminar (incluso si falla, vía `trap ... EXIT`). Quien no
consigue el `mkdir` espera, mostrando quién lo tiene y desde cuándo, reintentando cada 5 s hasta
`--lock-timeout` (2700 s / 45 min por defecto). Si el PID del dueño ya no existe (`kill -0` falla:
el agente murió a mitad de build), el lock se considera huérfano y se recupera automáticamente sin
esperar el timeout.

Antes de correr `e2e-smoke` además comprueba que los puertos fijos de la suite
(`packages/e2e/support/env.ts`: 3100/2667/2668, o los que sobreescriban
`E2E_WEB_PORT`/`E2E_COLYSEUS_PORT`/`E2E_EDITOR_SYNC_PORT`) están libres — con el lock ya no
deberían chocar entre worktrees, pero si otro proceso (no gestionado por este lock) los ocupa,
falla con un mensaje claro en vez del error críptico de Playwright
(`Error: http://localhost:2667 is already used`).

## Caché de turbo compartida entre worktrees

`--cache-dir="$HOME/.cache/escaperoom/turbo-cache"` (por defecto; `--no-cache` la desactiva y
fuerza recomputar con `--force`). Es seguro compartirla entre worktrees: turbo solo restaura ahí
archivos declarados en `outputs` (`.next/**`, `dist/**`, `generated/**` de `turbo.json`) copiándolos
al `packages/<pkg>/...` de **cada** worktree — no hay ningún directorio en uso compartido entre
procesos, así que dos worktrees restaurando el mismo `.next` o el mismo `generated/client` de
Prisma desde la caché no se pisan.

El riesgo real no es de archivos sino de **hash**: cada worktree tiene su propia base de datos
(`escaperoom_<slug>`, ticket 0.12), así que un resultado en verde de `test` en el worktree A no
tiene por qué serlo en el worktree B si sus bases divergen. `turbo.json` declara explícitamente
`DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` y las variables de `STORAGE_*` como `env` de la tarea
`test` (igual que hace CI en su bloque `env:` del job `verify`) precisamente para que entren en el
hash de caché: si dos worktrees apuntan a bases distintas, sus resultados de `test` no se
comparten por accidente. `lint`, `typecheck` y `build` no dependen de la base de datos, así que
comparten caché libremente entre worktrees.

## `e2e-smoke`: cuándo se dispara

Ejercita `web` + `colyseus-server` reales contra la base del worktree (`docs/specs/22-qa-y-pruebas.md`
§3.4: 2 jugadores, pasos 1–6 del Rey Aldric). Se dispara si el diff con `main` afecta a alguno de
estos paquetes (por la lista de `turbo --affected`, así que cualquier dependencia transitiva —
`kit`, `env`, `config`, `editor` — ya cuenta porque hace afectados a sus dependientes):

- `@escaperoom/web`, `@escaperoom/game-runtime`, `@escaperoom/colyseus-server`, `@escaperoom/shared`,
  `@escaperoom/e2e`

o si toca directamente rutas que no forman parte del grafo de dependencias de turbo pero sí
ejercita la suite:

- `docs/reference/roompackage-*.json` (el fixture del Rey Aldric)
- `packages/web/public/packs/**` (los assets de packs que sirve la web)

`--e2e`/`--no-e2e` siempre ganan sobre la detección automática. `--all` la dispara igual que
`--all` del propio `verify`.

## Timeouts de CI: lo que sí y lo que no reproduce `--cpu-throttle`

El runner de CI es `ubuntu-latest` (2 vCPU). El timeout por defecto de vitest es 5000 ms. Un test
que hace trabajo real (colas, Redis, Postgres) puede pasar de sobra en un Mac de 10 núcleos y
fallar por timeout en el runner — es justo lo que le pasó a la PR #142, y lo reprodujimos durante
esta tarea: `packages/web/test/analytics-pipeline.integration.test.ts` falla de forma
**reproducible** (incluso en aislamiento, sin concurrencia de por medio) con
`Error: Test timed out in 5000ms` contra la infra local de este worktree — no es un fallo
introducido por este cambio (nada de este diff toca ese test ni su código), es preexistente y
demuestra exactamente la clase de problema que `pnpm verify:pr` puede sacar a la luz en local antes
de que lo haga CI.

`--cpu-throttle` limita los hilos de vitest a 2 (`--poolOptions.threads.maxThreads=2`) para
aumentar la contención y así tener más probabilidad de que un test sensible al paralelismo se
note en local. **Es un heurístico, no una reproducción fiable**: un núcleo de este Mac es mucho
más rápido en single-thread que uno del runner de CI, así que limitar el número de hilos no
reproduce la lentitud real por núcleo — un test que sea lento en CI por CPU real (no por
contención con otros tests) puede seguir pasando aquí en verde con o sin `--cpu-throttle`. No
encontramos una forma fiable de emular el rendimiento por núcleo del runner desde este Mac; la
única señal fiable sigue siendo mirar el timing real del job `verify` tras el push. Si un test es
sistemáticamente lento (colas con temporizador, reintentos con backoff), la solución de fondo es
subir su `testTimeout` explícitamente en el propio test, no ajustar el entorno de quien lo corre.

## Cuidado: ejecuciones repetidas pueden acumular cuota de rate-limit

`REDIS_URL` por defecto apunta al Redis **persistente** de
`infra/docker-compose.dev.yml` (`:56380`, compartido por todos los
worktrees) — a diferencia del Redis efímero que CI levanta desde cero en
cada job. Los tests de rate-limit (`test/rate-limit.test.ts`,
`test/audio-generation-api.test.ts`, `test/moderation-api.test.ts`,
`test/onboarding-api.test.ts`…) escriben ahí sus contadores de cuota; si
corres `pnpm verify:pr` varias veces seguidas en poco tiempo, esos contadores
se acumulan entre ejecuciones y algunos de esos tests pueden empezar a fallar
con 429/403 inesperados **sin que hayas tocado código relacionado** — lo
comprobamos durante esta tarea: la primera ejecución del día solo falló por
el timeout de `analytics-pipeline.integration.test.ts` (ver más abajo), y una
ejecución posterior el mismo día encadenó 10 tests caídos, todos ellos de
cuota/rate-limit. Si ves ese patrón, no es necesariamente un fallo real: dale
un rato a que expiren las ventanas de cuota antes de asumir una regresión, o
limpia manualmente las claves de rate-limit de ese Redis
(`redis-cli -a redis_dev_only -p 56380 --no-auth-warning KEYS
'escaperoom:*rate*'` para verlas). No implementamos una limpieza automática
porque no sabemos si algún otro worktree la está usando a la vez.

## Resumen final

Al terminar (o al fallar: el resumen se imprime también en el primer fallo, antes de salir con
código de error) imprime una tabla con cada paso, su duración y por qué se saltó si se saltó, más
el detalle por tarea de turbo (`--summarize`, HIT/MISS de caché y milisegundos) del paso
`lint+typecheck+test+build`.

## Relación con `pnpm verify`

`scripts/verify.sh` (`pnpm verify`) sigue existiendo: es más simple (siempre instala, no usa
`--affected` salvo que le pases un filtro a mano, no toca e2e, no tiene lock ni caché
compartida) y sirve para una verificación rápida de un paquete suelto. `pnpm verify:pr` es la
puerta pensada específicamente para el flujo de varios worktrees de Orca en la misma máquina antes
de abrir una PR.
