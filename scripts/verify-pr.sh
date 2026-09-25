#!/usr/bin/env bash
#
# verify-pr.sh — puerta de calidad local que reproduce los checks de CI
# (.github/workflows/ci.yml: jobs `verify` y `e2e-smoke`) antes de hacer push
# o abrir una PR, pensada para varios worktrees de Orca trabajando a la vez
# en la misma máquina (docs/reference/verify-pr.md tiene el diseño completo).
#
#   pnpm verify:pr                  # solo los paquetes afectados por el diff con main
#   pnpm verify:pr --all            # fuerza lint/typecheck/test/build de todo el monorepo
#   pnpm verify:pr --e2e            # fuerza e2e-smoke aunque el diff no lo toque
#   pnpm verify:pr --no-e2e         # salta e2e-smoke aunque el diff sí lo toque
#   pnpm verify:pr --concurrency=N  # concurrencia de turbo (por defecto 50%; VERIFY_PR_CONCURRENCY)
#   pnpm verify:pr --lock-timeout=N # segundos esperando el lock de máquina (por defecto 2700; VERIFY_PR_LOCK_TIMEOUT)
#   pnpm verify:pr --cpu-throttle   # best-effort para tests sensibles al paralelismo — ver el aviso en el propio paso
#   pnpm verify:pr --no-cache       # ignora la caché compartida de turbo entre worktrees
#   pnpm verify:pr --skip-install   # no corre `pnpm install` aunque cambie pnpm-lock.yaml
#
# Requiere el entorno de worktree ya preparado (`pnpm infra:up`, `pnpm dev:env`,
# `pnpm db:migrate && pnpm db:seed` — nunca `pnpm db:reset` desde un agente).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
skip() { printf '\033[1;90m· %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

# --- Argumentos --------------------------------------------------------------
ALL=false
E2E_FORCE=""   # "" (auto) | "yes" | "no"
CONCURRENCY="${VERIFY_PR_CONCURRENCY:-50%}"
LOCK_TIMEOUT="${VERIFY_PR_LOCK_TIMEOUT:-2700}"
CPU_THROTTLE=false
NO_CACHE=false
SKIP_INSTALL=false

for arg in "$@"; do
  case "$arg" in
    --all) ALL=true ;;
    --e2e) E2E_FORCE=yes ;;
    --no-e2e) E2E_FORCE=no ;;
    --concurrency=*) CONCURRENCY="${arg#*=}" ;;
    --lock-timeout=*) LOCK_TIMEOUT="${arg#*=}" ;;
    --cpu-throttle) CPU_THROTTLE=true ;;
    --no-cache) NO_CACHE=true ;;
    --skip-install) SKIP_INSTALL=true ;;
    -h | --help)
      sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      die "opción desconocida: $arg (usa --help)"
      ;;
  esac
done

START=$(date +%s)
STEP_NAMES=()
STEP_SECS=()
STEP_STATUS=()
STEP_NOTES=()

record_step() {
  STEP_NAMES+=("$1")
  STEP_SECS+=("$2")
  STEP_STATUS+=("$3")
  STEP_NOTES+=("$4")
}

print_summary() {
  local total=$(( $(date +%s) - START ))
  printf '\n\033[1;36m── Resumen de pnpm verify:pr ──\033[0m\n'
  local i
  for i in "${!STEP_NAMES[@]}"; do
    local name="${STEP_NAMES[$i]}" secs="${STEP_SECS[$i]}" status="${STEP_STATUS[$i]}" note="${STEP_NOTES[$i]}"
    local mark="✓"
    local color="\033[1;32m"
    case "$status" in
      SALTADO) mark="·"; color="\033[1;90m" ;;
      FALLO) mark="✖"; color="\033[1;31m" ;;
    esac
    printf "${color}%s\033[0m %-28s %6ss  %s\n" "$mark" "$name" "$secs" "$note"
  done
  printf '\nTotal: %ss\n' "$total"
}

run_step() {
  # run_step <nombre> <comando...>
  local name="$1"; shift
  step "$name"
  local t0=$(date +%s)
  set +e
  "$@"
  local rc=$?
  set -e
  local dt=$(( $(date +%s) - t0 ))
  if [ $rc -eq 0 ]; then
    record_step "$name" "$dt" OK ""
    ok "$name (${dt}s)"
  else
    record_step "$name" "$dt" FALLO ""
    warn "$name falló (${dt}s)"
    print_summary
    exit $rc
  fi
}

# --- Caché y concurrencia compartidas entre worktrees ------------------------
CACHE_ROOT="${VERIFY_PR_CACHE_ROOT:-$HOME/.cache/escaperoom}"
TURBO_CACHE_DIR="$CACHE_ROOT/turbo-cache"
LOCK_DIR="$CACHE_ROOT/verify-pr-lock"
mkdir -p "$TURBO_CACHE_DIR" "$CACHE_ROOT"

TURBO_ARGS=(--concurrency="$CONCURRENCY")
if $NO_CACHE; then
  TURBO_ARGS+=(--force)
else
  TURBO_ARGS+=(--cache-dir="$TURBO_CACHE_DIR")
fi

# --- Detección de cambios respecto a main -------------------------------------
step "Detección de cambios respecto a main"
if ! git rev-parse --verify -q main >/dev/null; then
  die "no encuentro la rama local 'main' en este worktree. Haz 'git fetch origin main:main' o equivalente."
fi
MERGE_BASE=$(git merge-base main HEAD)
DIFF_FILES=$(
  {
    git diff --name-only "$MERGE_BASE"
    git status --porcelain=v1 --untracked-files=all | cut -c4-
  } | sed '/^$/d' | sort -u
)
DIFF_COUNT=$(printf '%s\n' "$DIFF_FILES" | sed '/^$/d' | wc -l | tr -d ' ')
ok "$DIFF_COUNT archivo(s) distinto(s) de main (base $MERGE_BASE)"

LOCKFILE_CHANGED=false
if printf '%s\n' "$DIFF_FILES" | grep -qx "pnpm-lock.yaml"; then
  LOCKFILE_CHANGED=true
fi

# --- Instalación (solo si hace falta) -----------------------------------------
if $SKIP_INSTALL; then
  record_step "Install" 0 SALTADO "--skip-install"
elif $LOCKFILE_CHANGED || [ ! -d "$ROOT/node_modules" ]; then
  run_step "Install (frozen lockfile)" pnpm install --frozen-lockfile
else
  record_step "Install" 0 SALTADO "pnpm-lock.yaml no cambió"
fi

# --- Paquetes afectados (turbo --affected) ------------------------------------
AFFECTED_PACKAGES=""
if ! $ALL; then
  step "Paquetes afectados (turbo --affected)"
  AFFECTED_JSON=$(pnpm exec turbo run build --affected --dry=json 2>/dev/null || echo '{"packages":[]}')
  AFFECTED_PACKAGES=$(printf '%s' "$AFFECTED_JSON" | jq -r '.packages[]?' | sort -u)
  if [ -z "$AFFECTED_PACKAGES" ]; then
    ok "ningún paquete afectado por el diff con main"
  else
    ok "afectados: $(printf '%s' "$AFFECTED_PACKAGES" | tr '\n' ' ')"
  fi
fi

# --- ¿Hace falta e2e-smoke? ---------------------------------------------------
# Criterio (specs/22 §3.4, e2e-smoke ejercita web + colyseus-server con datos
# del Rey Aldric): se dispara si el diff afecta a alguno de los paquetes que la
# suite arranca o ejercita en tiempo de ejecución (web, game-runtime,
# colyseus-server, shared, el propio e2e — usamos la lista de `turbo
# --affected`, así que cualquier dependencia transitiva de esos paquetes,
# como kit/env/config/editor, ya cuenta), o si toca directamente el fixture
# del Rey Aldric o los assets de packs que la web sirve (no forman parte del
# grafo de turbo, así que se comprueban aparte por ruta).
E2E_TARGET_PACKAGES="@escaperoom/web @escaperoom/game-runtime @escaperoom/colyseus-server @escaperoom/shared @escaperoom/e2e"
E2E_TARGET_PATHS='^docs/reference/roompackage-.*\.json$|^packages/web/public/packs/'

e2e_diff_triggers() {
  printf '%s\n' "$DIFF_FILES" | grep -qE "$E2E_TARGET_PATHS"
}

e2e_affected_triggers() {
  local pkg
  for pkg in $E2E_TARGET_PACKAGES; do
    if printf '%s\n' "$AFFECTED_PACKAGES" | grep -qx "$pkg"; then
      return 0
    fi
  done
  return 1
}

RUN_E2E=false
E2E_REASON=""
case "$E2E_FORCE" in
  yes) RUN_E2E=true; E2E_REASON="--e2e" ;;
  no) RUN_E2E=false; E2E_REASON="--no-e2e" ;;
  *)
    if $ALL; then
      RUN_E2E=true; E2E_REASON="--all"
    elif e2e_affected_triggers; then
      RUN_E2E=true; E2E_REASON="paquete afectado"
    elif e2e_diff_triggers; then
      RUN_E2E=true; E2E_REASON="fixture/packs en el diff"
    else
      RUN_E2E=false; E2E_REASON="nada en el diff toca web/game-runtime/colyseus-server/shared/e2e/fixtures"
    fi
    ;;
esac

# --- Lock de máquina para los pasos pesados (build + e2e) --------------------
# mkdir es atómico incluso en macOS (sin flock). El dueño escribe su PID y su
# worktree en LOCK_DIR/owner; si el proceso dueño ya no existe, el lock se
# considera huérfano (p. ej. el agente murió a mitad) y se recupera.
LOCK_HELD=false
acquire_lock() {
  local waited=0
  local interval=5
  while true; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf 'pid=%s\nworktree=%s\nstarted=%s\n' "$$" "$ROOT" "$(date +%s)" > "$LOCK_DIR/owner"
      LOCK_HELD=true
      return 0
    fi
    local owner_pid owner_worktree owner_started
    owner_pid=$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null || true)
    owner_worktree=$(sed -n 's/^worktree=//p' "$LOCK_DIR/owner" 2>/dev/null || true)
    owner_started=$(sed -n 's/^started=//p' "$LOCK_DIR/owner" 2>/dev/null || true)
    if [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null; then
      warn "lock huérfano (PID $owner_pid ya no existe, worktree ${owner_worktree:-?}) — lo recupero"
      rm -rf "$LOCK_DIR"
      continue
    fi
    if [ "$waited" -eq 0 ]; then
      step "Esperando el lock de build/e2e (lo tiene ${owner_worktree:-otro worktree}, PID ${owner_pid:-?})"
    fi
    if [ "$waited" -ge "$LOCK_TIMEOUT" ]; then
      die "llevo ${waited}s esperando el lock de ${owner_worktree:-otro worktree} (PID ${owner_pid:-?}). Sube --lock-timeout si hace falta, o comprueba que ese proceso sigue vivo."
    fi
    local since=$(( $(date +%s) - ${owner_started:-$(date +%s)} ))
    printf '\r\033[1;90m· esperando (%ss, lo tiene desde hace %ss)…\033[0m' "$waited" "$since"
    sleep "$interval"
    waited=$(( waited + interval ))
  done
}

release_lock() {
  if $LOCK_HELD; then
    rm -rf "$LOCK_DIR"
    LOCK_HELD=false
  fi
}
trap release_lock EXIT

# --- Comprobación de puertos del e2e (por defecto 3100/2667/2668, fijos en
# packages/e2e/support/env.ts, salvo que E2E_*_PORT los sobreescriba) --------
check_e2e_ports() {
  local port name pid
  for entry in "${E2E_WEB_PORT:-3100}:web" "${E2E_COLYSEUS_PORT:-2667}:colyseus" "${E2E_EDITOR_SYNC_PORT:-2668}:editor-sync"; do
    port="${entry%%:*}"; name="${entry#*:}"
    pid=$(lsof -ti "tcp:$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
      die "el puerto $port ($name de e2e) ya está ocupado por el PID $pid. Si es otro worktree corriendo su propio e2e, espera a que termine (el lock ya te habrá hecho esperar tu turno) o usa E2E_WEB_PORT/E2E_COLYSEUS_PORT/E2E_EDITOR_SYNC_PORT para correr en otros puertos."
    fi
  done
}

# --- Entorno local (infra compartida del worktree, ver packages/e2e/support/env.ts) ---
SHARED_ENV_FILE="$ROOT/packages/shared/.env"
if [ -z "${DATABASE_URL:-}" ] && [ -f "$SHARED_ENV_FILE" ]; then
  DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' "$SHARED_ENV_FILE" | head -1)
  export DATABASE_URL
fi
if [ -z "${DIRECT_URL:-}" ] && [ -f "$SHARED_ENV_FILE" ]; then
  DIRECT_URL=$(sed -n 's/^DIRECT_URL=//p' "$SHARED_ENV_FILE" | head -1)
  export DIRECT_URL
fi
if [ -z "${DATABASE_URL:-}" ]; then
  die "sin DATABASE_URL: corre 'pnpm infra:up && pnpm dev:env' en este worktree primero."
fi
# Redis/SeaweedFS de infra/docker-compose.dev.yml (compartidos por todos los
# worktrees, puertos fijos): activan los *.integration.test.ts (E-14), que si
# no se saltan silenciosamente con `describe.skipIf`.
: "${REDIS_URL:=redis://:redis_dev_only@localhost:56380}"
: "${REDIS_PREFIX:=escaperoom}"
: "${QUEUES_ENABLED:=true}"
: "${STORAGE_PROVIDER:=s3}"
: "${STORAGE_BUCKET:=escaperoom-assets}"
: "${STORAGE_REGION:=us-east-1}"
: "${STORAGE_ENDPOINT:=http://localhost:9002}"
: "${STORAGE_ACCESS_KEY_ID:=minioadmin}"
: "${STORAGE_SECRET_ACCESS_KEY:=minioadmin}"
export REDIS_URL REDIS_PREFIX QUEUES_ENABLED STORAGE_PROVIDER STORAGE_BUCKET STORAGE_REGION STORAGE_ENDPOINT STORAGE_ACCESS_KEY_ID STORAGE_SECRET_ACCESS_KEY
export CI=true

# --- lint + typecheck + test + build ------------------------------------------
# turbo.json declara `dependsOn: ["^build"]` en lint/typecheck/test, así que
# aunque sólo se pida "lint" turbo ya agenda los `build` de las dependencias
# de los paquetes afectados: build no se puede separar limpiamente del resto
# sin duplicar trabajo. Por eso todo el paso `verify` (igual que el job
# `verify` de CI) va en una sola invocación de turbo, bajo el lock de máquina
# junto con el e2e — son los dos pasos que de verdad cargan CPU/RAM.
VERIFY_TASKS=(lint typecheck test build)
FILTER_ARGS=()
if $ALL; then
  : # todo el monorepo, sin --affected
elif [ -n "$AFFECTED_PACKAGES" ]; then
  FILTER_ARGS=(--affected)
else
  ok "nada que verificar (sin cambios respecto a main); usa --all para forzar el monorepo completo"
fi

TEST_EXTRA_ARGS=()
if $CPU_THROTTLE; then
  # AVISO (requisito 6 del ticket): esto NO reproduce con fiabilidad los
  # timeouts de vitest (5s por defecto) del runner de CI (ubuntu-latest,
  # 2 vCPU). Limitar los hilos de vitest a 2 aumenta la contención en este
  # Mac, pero un núcleo de este Mac es mucho más rápido en single-thread que
  # uno del runner, así que un test que sea lento en CI por CPU real (no por
  # contención) puede seguir pasando aquí en verde. Es un heurístico de
  # "más probable que sea sensible al paralelismo", no una detección fiable
  # de qué va a fallar en CI. La única forma fiable que encontramos es mirar
  # el timing real del job `verify` en CI tras el push.
  warn "cpu-throttle es un heurístico, no reproduce fielmente los timeouts de CI (ver el comentario en scripts/verify-pr.sh)"
  TEST_EXTRA_ARGS=(--poolOptions.threads.maxThreads=2 --poolOptions.threads.minThreads=1)
fi

run_verify_pipeline() {
  # Patrón `${arr[@]+"${arr[@]}"}` (como en scripts/verify.sh): bash 3.2 (el
  # de macOS) revienta con `set -u` al expandir un array vacío directamente.
  if [ ${#TEST_EXTRA_ARGS[@]} -gt 0 ]; then
    pnpm exec turbo run "${VERIFY_TASKS[@]}" ${FILTER_ARGS[@]+"${FILTER_ARGS[@]}"} "${TURBO_ARGS[@]}" \
      --summarize -- "${TEST_EXTRA_ARGS[@]}"
  else
    pnpm exec turbo run "${VERIFY_TASKS[@]}" ${FILTER_ARGS[@]+"${FILTER_ARGS[@]}"} "${TURBO_ARGS[@]}" \
      --summarize
  fi
}

print_turbo_task_summary() {
  local dir="$ROOT/.turbo/runs"
  [ -d "$dir" ] || return 0
  local latest
  latest=$(ls -t "$dir"/*.json 2>/dev/null | head -1)
  [ -n "$latest" ] || return 0
  printf '\033[1;90m  detalle por tarea (turbo --summarize):\033[0m\n'
  jq -r '.tasks[] | [.taskId, .cache.status, ((.execution.endTime - .execution.startTime))] | @tsv' "$latest" 2>/dev/null \
    | sort -t $'\t' -k3 -nr \
    | awk -F'\t' '{ printf "    %-45s %-6s %6sms\n", $1, $2, $3 }'
}

if $ALL || [ -n "$AFFECTED_PACKAGES" ]; then
  acquire_lock
  printf '\n'
  run_step "Lint + typecheck + test + build (turbo)" run_verify_pipeline
  print_turbo_task_summary
else
  record_step "Lint + typecheck + test + build" 0 SALTADO "sin paquetes afectados"
fi

# --- e2e-smoke (condicional) ---------------------------------------------------
if $RUN_E2E; then
  if ! $LOCK_HELD; then
    acquire_lock
  fi
  check_e2e_ports
  run_step "Build de @escaperoom/shared (prisma generate, para e2e)" \
    pnpm --filter @escaperoom/shared build
  # Playwright ya es idempotente (no vuelve a descargar si el Chromium
  # pinneado está presente), así que llamarlo siempre es barato salvo la
  # primera vez.
  run_step "e2e:install (Chromium de Playwright)" \
    pnpm --filter @escaperoom/e2e e2e:install
  run_step "e2e:smoke (Playwright, @smoke)" \
    pnpm --filter @escaperoom/e2e e2e:smoke
else
  record_step "e2e-smoke" 0 SALTADO "$E2E_REASON"
fi

release_lock

print_summary
ok "pnpm verify:pr OK"
