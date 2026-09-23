# Instrucciones para Claude en este repo

## Lanzar agentes: siempre vía Orca

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

## Modo de trabajo por defecto: worktree + PR, no edición directa en main

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
   - En el nuevo worktree, correr: `pnpm dev:env` (requiere que
     `pnpm infra:up` ya esté levantado, normalmente ya lo está porque lo
     comparte con el principal) y luego `pnpm db:reset` para migrar y
     sembrar esa base nueva desde cero.
   - **El puerto 3000 está ocupado por el worktree principal** (el usuario
     tiene `pnpm dev` corriendo ahí para probar la app). Decirle al agente
     explícitamente en el brief que si levanta `pnpm dev` en su worktree,
     Next.js/turbo elegirán otro puerto libre automáticamente si 3000 está
     ocupado — confírmaselo en el brief para que no dé por hecho que su app
     está en 3000 al describir cómo verificar visualmente, y que mire la
     salida real del arranque para saber en qué puerto quedó.
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
