# Instrucciones para Claude en este repo

> **Ámbito de las dos secciones siguientes ("Lanzar agentes vía Orca" y "Modo
> de trabajo por defecto"): SOLO para el worktree principal
> (`/Users/suvi/Dev/escaperoom`), la sesión coordinadora.**
>
> Este archivo se comitea en el repo, así que todo worktree nuevo (incluidos
> los que la coordinadora crea para delegar una tarea) lo hereda al clonar. Un
> agente que YA está trabajando dentro de su propio worktree delegado no es la
> coordinadora — para él, estas dos secciones no aplican: no debe lanzar sus
> propios `orca worktree create`/`orca terminal create`, ni re-aplicar el
> "flujo worktree + PR" sobre sí mismo (ya está en su worktree, su trabajo es
> hacer la tarea y abrir su PR, no orquestar más agentes). Ya ha pasado que un
> agente delegado, al leer este archivo, se lanzó su propio worktree+agente en
> paralelo sobre la misma tarea sin que la coordinadora se enterara — de ahí
> esta nota. Si un agente delegado necesita investigación puntual dentro de su
> propia tarea, el tool `Agent`/subagentes internos de Claude Code sí está
> permitido; `orca worktree create` no.
>
> El resto del archivo (UI con shadcn/ui, `pnpm verify:pr`) sí aplica a
> cualquiera, coordinadora o agente delegado.

## Lanzar agentes: siempre vía Orca (solo la sesión coordinadora)

Cuando haya que lanzar un agente para trabajar en este repo (investigación,
implementación, tareas delegadas), **usar siempre el CLI de Orca**
(`orca worktree create --agent ... --prompt ...`, o `orca terminal create` +
`orca terminal send` sobre un worktree existente), no el tool `Agent` interno
(subagentes en proceso).

Motivo: el usuario gestiona su flujo de trabajo desde Orca (worktrees,
terminales, seguimiento de tareas) y quiere que todo agente que toque este
repo sea visible y gestionable ahí, no en background dentro de la sesión de
Claude Code.

Esto aplica tanto a handoffs completos (`orca worktree create --agent codex
--no-parent --prompt "..."`) como a trabajo de investigación/exploración que
en otros repos se resolvería con el tool `Agent` (`subagent_type: "Explore"`,
`"fork"`, etc.) — en este repo, ese trabajo también debe ir a través de Orca.

## Modo de trabajo por defecto (solo la sesión coordinadora): worktree + PR, no edición directa en main

Salvo que el usuario diga explícitamente "trabajamos en main" (o equivalente),
el flujo por defecto para cualquier tarea de código es:

1. Crear el worktree con `orca worktree create` **sin lanzar el agente
   todavía** (sin `--agent`), para preparar antes el entorno:
   - **NO copiar el `.env` del worktree principal.** El repo ya tiene
     aprovisionamiento de base de datos por worktree (ticket 0.12,
     `scripts/dev-env.sh`): cada worktree enlazado obtiene su propia base
     Postgres aislada (`escaperoom_<slug>`, en el mismo contenedor Docker
     compartido, puerto 55433) para poder migrar/sembrar en paralelo sin
     pisar a los demás worktrees ni al principal (que usa `escaperoom`).
     Copiar el `.env` del principal hace que todos los worktrees compartan
     la misma base y provoca líos de migraciones concurrentes (nos pasó con
     la tarea de `waitlist`).
   - Redis (`:56380`) SÍ es una instancia compartida entre worktrees, a
     diferencia de Postgres: `pnpm dev:env` también escribe (o actualiza,
     sin tocar el resto del fichero) `REDIS_PREFIX=<mismo slug que la BD>`
     en los `.env` de `web`/`kit`/`worker`/`colyseus-server`/`shared`
     (auditoría 2026-09-25, bloque CI/infra), para que las colas BullMQ y el
     pub/sub de `editor-sync` de un worktree no se pisen con los de otro (dos
     `pnpm dev`/workers reales corriendo a la vez). Si el agente copia esos
     `.env` a mano en vez de dejar que `dev-env.sh` los gestione, pierde este
     aislamiento. La config base de Vitest (`packages/config/vitest.config.ts`)
     también carga ese `REDIS_PREFIX` para los tests de esos cinco paquetes
     (`test.env`; en CI, sin `.env` de worktree, es un no-op) — antes de la
     auditoría 2026-09-25 (puertos por worktree) no llegaba a los tests de
     `web`, que seguían compartiendo prefijo entre worktrees. **Ojo (#161):**
     los 429/403 intermitentes de los tests de rate-limit de `web` bajo
     `pnpm verify:pr` venían de que `scripts/verify-pr.sh` exportaba el
     `REDIS_PREFIX=escaperoom` genérico, con lo que esos tests usaban el Redis
     real y persistente compartido y heredaban cuota de tiradas anteriores.
     Ahora el script lee el prefijo del worktree de `packages/shared/.env`
     (lo deja `pnpm dev:env`). Si vuelven a aparecer, comprobar primero que
     el worktree pasó por `pnpm dev:env`; si aun así fallan, es contención de
     CPU (ver "Timeouts de CI" en `docs/reference/verify-pr.md`).
   - En el nuevo worktree, correr: `pnpm dev:env` (requiere que
     `pnpm infra:up` ya esté levantado, normalmente ya lo está porque lo
     comparte con el principal) y luego `pnpm db:reset` para migrar y
     sembrar esa base nueva desde cero.
   - **Prisma 7 (adaptador `@prisma/adapter-pg`, sin motor de Rust):
     migraciones SIEMPRE por `DIRECT_URL` (directo a Postgres, nunca por
     PgBouncer) y NADA de estado de sesión en SQL** — solo
     `pg_advisory_xact_lock`/`SET LOCAL` (de transacción), nunca
     `pg_advisory_lock`, `SET` sin `LOCAL`, `LISTEN`/`NOTIFY`, tablas
     temporales ni cursores `WITH HOLD`: dev sigue directo a Postgres, pero
     CI y producción van por PgBouncer en modo transacción (paridad), donde
     la conexión física se devuelve al pool entre transacciones. Detalle
     completo (pool `max` por proceso, motivo de cada regla) en
     `infra/README.md` §"Prisma 7: adaptador, pool y PgBouncer".
   - **Los puertos 3000 (web), 2567 (Colyseus) y 2568 (editor-sync) son del
     usuario**, aunque en ese momento estén libres: el worktree principal los
     usa cuando el usuario arranca `pnpm dev` ahí. **Ningún agente puede
     levantar nada en esos puertos.** Desde la auditoría 2026-09-25 (puertos
     por worktree) esto es **automático**: `pnpm dev:env` en un worktree
     enlazado le asigna tres puertos propios (web 3200-3299, Colyseus
     2700-2799, editor-sync 2800-2899; registro en
     `$(git rev-parse --git-common-dir)/escaperoom-dev-ports.json`, detalle en
     `infra/README.md`) y los escribe en su `.env`, así que `pnpm dev` **sin**
     `PORT=` ya arranca en esos puertos y nunca en 3000/2567/2568. Aun así, el
     agente debe mirar la salida real del arranque para confirmar en qué
     puerto quedó (no darlo por hecho), y correr `pnpm dev:env` como parte de
     la preparación del worktree (paso 1 más abajo) antes de `pnpm dev`.
   - **Nunca matar procesos por patrón amplio** (`pkill -f "next dev"`,
     `pkill -f node`, `killall next`, etc.). Un `pkill -f "next dev"` mata
     TODOS los `next dev` de la máquina, incluido el del worktree principal
     que el usuario tiene abierto en el navegador (ya pasó una vez y hubo que
     relanzarlo). Si el agente necesita reiniciar su propio dev server, que
     use `orca terminal send --interrupt` sobre su propia terminal, o mate
     solo el proceso que escucha en el puerto concreto que él mismo levantó
     (`lsof -ti :<su-puerto> | xargs kill`), nunca por nombre de comando.
     Incluir esta advertencia explícitamente en el brief de cualquier agente
     que vaya a levantar/reiniciar `pnpm dev` en su worktree.
2. Un worktree nuevo se crea desde `origin/main`, que puede ir por detrás de
   la rama `main` local (commits aún no pusheados). Antes de darle trabajo al
   agente, decirle que compruebe con `git log` y haga `git merge main` (rama
   local, mismo `.git`, no hace falta red) si le falta algún commit reciente.
3. Lanzar un agente Orca de Claude con modelo **Sonnet 5** en ese worktree
   (`orca terminal create --worktree <id> --command "claude --model sonnet"`
   + `orca terminal send` con el brief de la tarea).
4. Ese agente trabaja ahí y, al terminar, **abre una Pull Request** (no basta
   con comitear en su rama local).
5. Cuando el agente avisa que terminó, además de esperar ese aviso, se
   programa un monitor de respaldo por si no llega.
6. Al terminar: revisar la PR, validarla, integrarla (merge), limpiar el
   worktree (`orca worktree rm`) y cerrar el agente de Orca.

No editar archivos directamente en el worktree principal (`main`) para tareas
de código salvo petición explícita del usuario de trabajar ahí.

## UI: todos los componentes deben ser shadcn/ui, sin componentes nativos

Ya es la decisión del proyecto (ADR-019, `docs/reference/registro-de-decisiones.md`),
pero se reitera aquí para que ningún agente lo pase por alto: **todo control
de interfaz usa un componente de shadcn/ui, nunca el elemento HTML nativo
directamente** (`<button>` → `Button`, `<input>` → `Input`, `<select>` →
`Select`, `<textarea>` → `Textarea`, checkbox/radio → `Checkbox`/`RadioGroup`,
modales → `Dialog`, etc.). Si hace falta un componente shadcn que no está
instalado, se instala con el CLI pinneado del proyecto
(`pnpm --filter @escaperoom/web exec shadcn add <componente>`, desde
`packages/web` donde vive `components.json`) en vez de usar el elemento nativo
o improvisar un componente propio. Incluir esto explícitamente en el brief de
cualquier agente que toque UI.

Excepción ya acordada: elementos puramente decorativos/estructurales sin
semántica de control (`div`, `span`, `img`, SVG de iconos/glifos) no necesitan
shadcn — la regla es sobre controles interactivos y de formulario.

## Antes de push/PR: `pnpm verify:pr` en verde

Antes de hacer push o abrir una PR, corre `pnpm verify:pr` en tu worktree
(diseño completo en `docs/reference/verify-pr.md`). Reproduce en local los
jobs `verify` y `e2e-smoke` de `.github/workflows/ci.yml` sin esperar a
GitHub, con detección de lo afectado, caché y un lock compartidos entre
worktrees (no satura el Mac del usuario mientras hay varios agentes
trabajando a la vez). Opciones principales: `--all` (fuerza todo el
monorepo), `--e2e`/`--no-e2e` (fuerza u omite el smoke E2E), `--concurrency=N`
y `--cpu-throttle` (heurístico para tests sensibles al paralelismo, sin
fiabilidad completa frente a los timeouts reales de CI — ver el aviso en el
propio script). Requiere el worktree ya preparado (`pnpm infra:up`,
`pnpm dev:env`, `pnpm db:migrate && pnpm db:seed`).

## Assets gráficos

Assets gráficos (estilos, packs, renders de Blender, tiles SVG):
`tools/assets-generator/` — leer su `CLAUDE.md` antes de tocarlo; sus
binarios (`fuentes/`, `entregas/`) son locales y no se versionan.
