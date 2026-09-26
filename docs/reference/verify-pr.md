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

## `REDIS_PREFIX` por worktree (evita pisar rate-limit/colas/pub-sub de otro)

`REDIS_URL` por defecto apunta al Redis **persistente** de
`infra/docker-compose.dev.yml` (`:56380`, compartido por todos los
worktrees) — a diferencia del Redis efímero que CI levanta desde cero en
cada job. Todo lo que usa Redis (rate limiting, colas BullMQ, pub/sub de
`editor-sync`) namespacea sus claves con `REDIS_PREFIX` (`kit/src/redis/
index.ts`, `redisPrefix()`); **`pnpm dev:env` escribe un `REDIS_PREFIX`
propio por worktree** (el mismo slug que su base de datos) en los `.env` de
`web`/`kit`/`worker`/`colyseus-server` — ver `scripts/dev-env.sh`, arreglado
en la auditoría 2026-09-25 (bloque CI/infra): antes todos los worktrees
compartían el prefijo por defecto (`APP_NAME`), así que dos `pnpm dev`/
workers/procesos `editor-sync` de worktrees distintos sí podían pisarse
colas y pub/sub reales entre sí. Si ves keys `escaperoom:*` (el prefijo por
defecto, sin slug) en ese Redis con `redis-cli -a redis_dev_only -p 56380
--no-auth-warning KEYS '<tu REDIS_PREFIX>:*'`, comprueba que tu `.env`
tiene el `REDIS_PREFIX` correcto (`grep REDIS_PREFIX packages/web/.env`) y
que no lo copiaste a mano del worktree principal.

**Actualización (entrada "Tests de rate limit deterministas" de `docs/DEUDA.md`, resuelta): SÍ
era esto**, aunque de una forma distinta a la que descartaba una versión anterior de esta nota.
`vitest run` directo (o `pnpm turbo run test` invocado a mano, sin pasar por este script)
efectivamente nunca carga `packages/web/.env` ni recibe `REDIS_URL` — eso seguía confirmado — pero
**`scripts/verify-pr.sh` (este script) exporta `REDIS_URL`/`REDIS_PREFIX` él mismo** para toda la
tubería de `turbo` (líneas de aquí abajo, para que los `*.integration.test.ts` del E-14 tengan
Redis disponible), y hasta ahora ese `REDIS_PREFIX` por defecto era el genérico `escaperoom`, NO
el propio del worktree. Bajo `pnpm verify:pr` (a diferencia de `vitest run` o `turbo run test`
sueltos), los tests de rate-limit de `web` SÍ hablaban con el Redis real y PERSISTENTE de
`infra/docker-compose.dev.yml`, perdiendo el aislamiento en memoria que su propio diseño da por
hecho: las claves de cuota (`escaperoom:rls:*`, confirmado con `redis-cli … KEYS 'escaperoom:rls:*'`)
sobrevivían de una tirada de `pnpm verify:pr` a la siguiente — y entre worktrees distintos, si
ninguno tenía `REDIS_PREFIX` ya puesto en su shell — así que el 429/403 dependía de qué había
quedado sin expirar de una ejecución anterior (algunas cuotas con ventana de hasta 1h, la de
`gift-copy-recipient` de 24h), no de la carga de la máquina en ese momento ni de un fallo del
algoritmo del limitador (reproducido: `pnpm verify:pr --all --no-e2e` fallaba de forma consistente
con las claves contaminadas, y en verde 3 veces seguidas tras limpiarlas). Arreglado: este script
ahora lee el `REDIS_PREFIX` del worktree desde `packages/shared/.env` (el que ya deja
`pnpm dev:env`) antes de caer al genérico — ver el bloque "Entorno local" más abajo en el propio
script. Si ves 429/403 en tests de rate-limit bajo `pnpm verify:pr`, comprueba primero que tu
`REDIS_PREFIX` no sea el genérico (`grep REDIS_PREFIX packages/shared/.env`) antes de asumir
contención de CPU (que sigue siendo real para OTROS tests, ver "Timeouts de CI" más arriba —
`test/sitemap.test.ts` sí es un timeout genuino de CPU, sin relación con rate-limit).

**Actualización 2 (entrada "Tests de rate limit de `web` aún intermitentes bajo `pnpm verify:pr`
(429)" de `docs/DEUDA.md`, #170, resuelta): el prefijo por worktree no bastaba.** Leer el
`REDIS_PREFIX` de `packages/shared/.env` (arreglo anterior) evita que dos worktrees se pisen entre
sí, pero ese Redis sigue siendo el mismo persistente **entre tiradas sucesivas del mismo
worktree**: las claves de cuota que deja una `pnpm verify:pr --all` seguían vivas para la
siguiente, así que el 429 podía depender de la tirada anterior (visto en `room-license-api.test.ts`,
`gift-copy`, reproducible en dos tiradas seguidas sin limpiar Redis a mano entre medias). Arreglado:
el script añade un sufijo por EJECUCIÓN al `REDIS_PREFIX` del worktree (PID del script + epoch,
nunca reutilizado — `REDIS_PREFIX="${REDIS_PREFIX}_run$$_$(date +%s)"`, justo antes de exportarlo),
así que cada tirada de `pnpm verify:pr` empieza con un namespace de Redis limpio propio, sin tocar
el prefijo por worktree que sigue separando `pnpm dev`/workers reales entre worktrees. Las claves
"huérfanas" de tiradas anteriores no se limpian activamente, pero llevan TTL propio (rate limiting
por ventana) y ya no colisionan con nada: se dejan expirar solas. Verificado con dos
`pnpm verify:pr --all` seguidas en verde.

De forma independiente (defensa en profundidad, no la causa de lo anterior): el limitador en
memoria (`MemoryRateLimitStore`/`MemorySlidingWindowStore`, `packages/kit/src/rate-limit/`) acepta
ahora un reloj inyectable de punta a punta (ningún test depende ya de un `setTimeout`/espera real),
y `__resetInMemoryRateLimitersForTests()` (`packages/kit/src/rate-limit/index.ts`) se llama al
principio de cada fichero de test que ejercita una ruta real limitada, para que ninguno dependa del
estado que deje otro si alguna vez vuelven a compartir store.

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
