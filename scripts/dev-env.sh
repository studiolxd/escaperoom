#!/usr/bin/env bash
#
# dev-env — base de datos y prefijo de Redis por worktree (ticket 0.12; E-18/
# CI-infra 2026-09-25).
#
# Deriva un slug estable del path del worktree y escribe packages/shared/.env
# apuntando a la base `escaperoom` (worktree principal) o `escaperoom_<slug>`
# (cualquier worktree enlazado), creándola en el contenedor Postgres si falta.
# Así dos worktrees migran y siembran a la vez sin pisarse.
#
# Redis SÍ es una instancia compartida (a diferencia de Postgres): en los
# worktrees enlazados, escribe (o actualiza, sin tocar el resto del fichero)
# `REDIS_PREFIX=<mismo slug que la BD>` en los `.env` de `web`/`kit`/`worker`/
# `colyseus-server`/`shared`, para que el rate limiting, las colas (BullMQ) y
# el pub/sub de `editor-sync` de un worktree no pisen los de otro corriendo en
# paralelo. El worktree principal sigue con el prefijo por defecto.
#
# Los worktrees enlazados también obtienen tres puertos propios (web,
# Colyseus, editor-sync) fuera de los que usa el worktree principal
# (3000/2567/2568) y el smoke E2E (3100/2667/2668): ver «Puertos por
# worktree» más abajo.
#
#   pnpm dev:env              # idempotente; NO pisa un .env existente ni los
#                              # puertos ya asignados a este worktree
#   pnpm dev:env -- --force   # reescribe packages/shared/.env y reasigna
#                              # puertos (REDIS_PREFIX de los demás .env
#                              # siempre se mantiene al día)
#
# Prerequisito: `pnpm infra:up` (Postgres en localhost:55433, Redis en 56380).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

for bin in jq lsof; do
  command -v "$bin" > /dev/null 2>&1 \
    || { echo "✖ falta '$bin' (necesario para asignar puertos por worktree)" >&2; exit 1; }
done

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    -h | --help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "opción desconocida: $arg" >&2
      exit 1
      ;;
  esac
done

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
skip() { printf '\033[1;90m· %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

PG_HOST=localhost
PG_PORT=55433
PG_USER=postgres
PG_PASSWORD=postgres
COMPOSE_FILE=infra/docker-compose.dev.yml
ENV_FILE=packages/shared/.env

# --- Nombre de la base -----------------------------------------------------
# El worktree principal (aquel cuyo `.git` es un directorio) usa `escaperoom`;
# los worktrees enlazados de `git worktree add` (`.git` es un fichero) usan un
# slug derivado del nombre del directorio, para que cada uno tenga la suya.
if [ -d "$ROOT/.git" ]; then
  DB=escaperoom
  KIND="principal"
else
  base=$(basename "$ROOT")
  slug=$(printf '%s' "$base" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//')
  [ -n "$slug" ] || slug=worktree
  case "$slug" in [0-9]*) slug="w_$slug" ;; esac
  # Un identificador de Postgres no supera los 63 bytes: deja sitio al prefijo.
  slug=${slug:0:48}
  DB="escaperoom_$slug"
  KIND="enlazado"
fi

step "Base de datos por worktree"
ok "worktree $KIND: $ROOT"
ok "base de datos: $DB"

# --- La base existe (o se crea) en el contenedor compartido -----------------
step "Contenedor Postgres"
if ! exists=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$PG_USER" -d postgres -Atc \
  "select 1 from pg_database where datname = '$DB'" 2>/dev/null); then
  die "el Postgres de dev no responde en $PG_HOST:$PG_PORT.
  Arráncalo antes: pnpm infra:up"
fi

if [ "$exists" = "1" ]; then
  ok "la base $DB ya existe"
else
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    createdb -U "$PG_USER" "$DB" || true
  ok "creada la base $DB"
fi

# --- .env de Prisma ---------------------------------------------------------
step "$ENV_FILE"
if [ -f "$ENV_FILE" ] && [ "$FORCE" != true ]; then
  current=$(sed -n 's#^DATABASE_URL=.*/\([^/]*\)$#\1#p' "$ENV_FILE" | head -1)
  if [ "$current" = "$DB" ]; then
    skip "ya apunta a $DB; no lo toco"
  else
    warn "ya existe y apunta a '${current:-?}', no a '$DB'"
    warn "no lo piso; relanza con --force para reescribirlo"
  fi
else
  cat > "$ENV_FILE" <<EOF
# Generado por scripts/dev-env.sh (ticket 0.12) — no lo edites a mano.
# Prisma carga .env desde el directorio de trabajo (packages/shared): no crees
# también prisma/.env o fallará por conflicto de variables.
#
# Cada worktree usa su propia base para poder migrar/sembrar en paralelo sin
# pisar a los demás. Regenerar con: pnpm dev:env -- --force
DATABASE_URL=postgresql://$PG_USER:$PG_PASSWORD@$PG_HOST:$PG_PORT/$DB
DIRECT_URL=postgresql://$PG_USER:$PG_PASSWORD@$PG_HOST:$PG_PORT/$DB
EOF
  ok "escrito → $DB"
fi

# --- REDIS_PREFIX por worktree ----------------------------------------------
# La instancia de Redis (`infra/docker-compose.dev.yml`) es COMPARTIDA entre
# el worktree principal y todos los enlazados (a diferencia de Postgres, que
# tiene una base por worktree). Sin un `REDIS_PREFIX` propio, dos worktrees
# corriendo tests/dev en paralelo pisan las mismas claves de rate limiting,
# colas (BullMQ) y pub/sub de `editor-sync` — auditoría 2026-09-25, bloque
# CI/infra: tests de rate-limit fallando de forma intermitente por contención
# entre worktrees.
#
# El worktree principal sigue con el prefijo por defecto (`APP_NAME`, ver
# `kit/src/redis/index.ts`) — no se le escribe `REDIS_PREFIX`. Los enlazados
# usan el mismo valor que su base de datos (`$DB`, ya único por worktree).
if [ "$KIND" = "enlazado" ]; then
  step "REDIS_PREFIX por worktree"
  REDIS_ENV_FILES=(
    packages/web/.env
    packages/kit/.env
    packages/worker/.env
    packages/colyseus-server/.env
    packages/shared/.env
  )
  for f in "${REDIS_ENV_FILES[@]}"; do
    if [ -f "$f" ] && grep -q '^REDIS_PREFIX=' "$f"; then
      current=$(sed -n 's/^REDIS_PREFIX=//p' "$f" | head -1)
      if [ "$current" = "$DB" ]; then
        skip "$f ya tiene REDIS_PREFIX=$DB"
        continue
      fi
      # Reemplaza SOLO esa línea; el resto del fichero (URLs, secretos…) no se toca.
      tmp=$(mktemp)
      sed "s/^REDIS_PREFIX=.*/REDIS_PREFIX=$DB/" "$f" > "$tmp" && mv "$tmp" "$f"
      ok "$f: REDIS_PREFIX $current → $DB"
    elif [ -f "$f" ]; then
      printf '\nREDIS_PREFIX=%s\n' "$DB" >> "$f"
      ok "$f: añadido REDIS_PREFIX=$DB"
    else
      mkdir -p "$(dirname "$f")"
      printf 'REDIS_PREFIX=%s\n' "$DB" > "$f"
      ok "$f: creado con REDIS_PREFIX=$DB"
    fi
  done
fi

# --- Puertos por worktree ----------------------------------------------------
# Los puertos 3000 (web), 2567 (Colyseus) y 2568 (editor-sync) son del
# worktree principal (los usa el usuario con `pnpm dev`), y 3100/2667/2668 son
# del smoke E2E (packages/e2e/support/env.ts) — un worktree enlazado nunca
# debe arrancar en ninguno de esos seis. Cada enlazado obtiene tres puertos
# libres en rangos propios (web 3200-3299, Colyseus 2700-2799, editor-sync
# 2800-2899), asignados una vez y reutilizados en corridas siguientes
# (auditoría 2026-09-25, puertos por worktree; decisión: buscar puertos
# libres al ejecutar dev:env y guardarlos, no derivarlos de un hash).
#
# El registro vive fuera del árbol de trabajo, en el `.git` común a todos los
# worktrees (`git rev-parse --git-common-dir`): así sobrevive a un
# `orca worktree rm` de otro worktree y no hace falta compartir nada por red.
if [ "$KIND" = "enlazado" ]; then
  step "Puertos por worktree (web / Colyseus / editor-sync)"

  GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
  case "$GIT_COMMON_DIR" in
    /*) : ;;
    *) GIT_COMMON_DIR="$ROOT/$GIT_COMMON_DIR" ;;
  esac
  PORTS_FILE="$GIT_COMMON_DIR/escaperoom-dev-ports.json"
  PORTS_LOCK="$GIT_COMMON_DIR/escaperoom-dev-ports.lock"

  # Lock corto (mkdir es atómico): dos `dev:env` de worktrees distintos no
  # deben asignar el mismo puerto libre a la vez. Mismo patrón (sin flock,
  # recuperación de lock huérfano) que `scripts/verify-pr.sh`.
  PORTS_LOCK_HELD=false
  acquire_ports_lock() {
    local waited=0
    while ! mkdir "$PORTS_LOCK" 2>/dev/null; do
      if [ -n "$(find "$PORTS_LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
        warn "lock de puertos huérfano (>1 min) — lo recupero"
        rmdir "$PORTS_LOCK" 2>/dev/null || true
        continue
      fi
      waited=$((waited + 1))
      [ "$waited" -le 50 ] || die "no pude adquirir el lock de puertos ($PORTS_LOCK)"
      sleep 0.2
    done
    PORTS_LOCK_HELD=true
  }
  release_ports_lock() {
    if [ "$PORTS_LOCK_HELD" = true ]; then
      rmdir "$PORTS_LOCK" 2>/dev/null || true
      PORTS_LOCK_HELD=false
    fi
  }
  trap release_ports_lock EXIT

  acquire_ports_lock
  [ -f "$PORTS_FILE" ] || echo '{}' > "$PORTS_FILE"

  # Descarta asignaciones de worktrees que ya no existen (`orca worktree rm`,
  # `git worktree remove`…), para no agotar los rangos con basura.
  existing_json=$(git worktree list --porcelain | sed -n 's/^worktree //p' | jq -R . | jq -s .)
  tmp=$(mktemp)
  jq --argjson existing "$existing_json" \
    'with_entries(select(.key as $k | $existing | index($k) != null))' \
    "$PORTS_FILE" > "$tmp" && mv "$tmp" "$PORTS_FILE"

  # Libre = nadie escucha en el puerto Y no está ya asignado a OTRO worktree
  # en el registro (aunque ese worktree no lo tenga levantado ahora mismo).
  port_used_elsewhere() {
    jq -e --arg root "$ROOT" --argjson p "$1" \
      'to_entries | any(.key != $root and ([.value.web, .value.colyseus, .value.editorSync] | index($p)))' \
      "$PORTS_FILE" > /dev/null
  }
  find_free_port() {
    local start=$1 end=$2 p
    for ((p = start; p <= end; p++)); do
      if lsof -iTCP:"$p" -sTCP:LISTEN > /dev/null 2>&1; then continue; fi
      if port_used_elsewhere "$p"; then continue; fi
      printf '%s' "$p"
      return 0
    done
    die "sin puertos libres en $start-$end (revisa $PORTS_FILE)"
  }

  current=$(jq -r --arg root "$ROOT" '.[$root] // empty' "$PORTS_FILE")
  if [ -n "$current" ] && [ "$FORCE" != true ]; then
    WEB_PORT=$(printf '%s' "$current" | jq -r '.web')
    COLYSEUS_PORT_VAL=$(printf '%s' "$current" | jq -r '.colyseus')
    EDITOR_SYNC_PORT_VAL=$(printf '%s' "$current" | jq -r '.editorSync')
    skip "reutilizo puertos ya asignados: web=$WEB_PORT colyseus=$COLYSEUS_PORT_VAL editor-sync=$EDITOR_SYNC_PORT_VAL"
  else
    WEB_PORT=$(find_free_port 3200 3299)
    COLYSEUS_PORT_VAL=$(find_free_port 2700 2799)
    EDITOR_SYNC_PORT_VAL=$(find_free_port 2800 2899)
    tmp=$(mktemp)
    jq --arg root "$ROOT" --argjson web "$WEB_PORT" --argjson col "$COLYSEUS_PORT_VAL" \
      --argjson es "$EDITOR_SYNC_PORT_VAL" \
      '.[$root] = {web: $web, colyseus: $col, editorSync: $es}' "$PORTS_FILE" > "$tmp" \
      && mv "$tmp" "$PORTS_FILE"
    ok "asignados: web=$WEB_PORT colyseus=$COLYSEUS_PORT_VAL editor-sync=$EDITOR_SYNC_PORT_VAL"
  fi
  release_ports_lock
  trap - EXIT

  # --- Escribe los puertos en los .env de cada paquete -----------------------
  ensure_env_file() {
    local file=$1 example=$2
    if [ -f "$file" ]; then return 0; fi
    if [ -f "$example" ]; then
      cp "$example" "$file"
      ok "$file: creado desde $example"
    else
      mkdir -p "$(dirname "$file")"
      : > "$file"
    fi
  }
  set_env_var() {
    local file=$1 key=$2 value=$3
    if grep -q "^${key}=" "$file" 2>/dev/null; then
      local current_value
      current_value=$(sed -n "s#^${key}=##p" "$file" | head -1)
      [ "$current_value" = "$value" ] && return 0
      local tmp
      tmp=$(mktemp)
      sed "s#^${key}=.*#${key}=${value}#" "$file" > "$tmp" && mv "$tmp" "$file"
    else
      printf '%s=%s\n' "$key" "$value" >> "$file"
    fi
  }

  WEB_ENV=packages/web/.env
  COLYSEUS_ENV=packages/colyseus-server/.env
  WORKER_ENV=packages/worker/.env
  ensure_env_file "$WEB_ENV" packages/web/.env.example
  ensure_env_file "$COLYSEUS_ENV" packages/colyseus-server/.env.example
  ensure_env_file "$WORKER_ENV" packages/worker/.env.example

  set_env_var "$WEB_ENV" PORT "$WEB_PORT"
  set_env_var "$WEB_ENV" APP_URL "http://localhost:$WEB_PORT"
  set_env_var "$WEB_ENV" NEXT_PUBLIC_APP_URL "http://localhost:$WEB_PORT"
  set_env_var "$WEB_ENV" BETTER_AUTH_URL "http://localhost:$WEB_PORT"
  set_env_var "$WEB_ENV" NEXT_PUBLIC_COLYSEUS_URL "ws://localhost:$COLYSEUS_PORT_VAL"
  set_env_var "$WEB_ENV" COLYSEUS_INTERNAL_URL "http://localhost:$COLYSEUS_PORT_VAL"
  set_env_var "$WEB_ENV" NEXT_PUBLIC_EDITOR_SYNC_URL "ws://localhost:$EDITOR_SYNC_PORT_VAL"
  set_env_var "$WEB_ENV" EDITOR_SYNC_PORT "$EDITOR_SYNC_PORT_VAL"
  set_env_var "$WEB_ENV" EDITOR_SYNC_ALLOWED_ORIGINS "http://localhost:$WEB_PORT"
  set_env_var "$COLYSEUS_ENV" COLYSEUS_PORT "$COLYSEUS_PORT_VAL"
  set_env_var "$WORKER_ENV" APP_URL "http://localhost:$WEB_PORT"
  ok "puertos escritos en $WEB_ENV, $COLYSEUS_ENV y $WORKER_ENV"
fi

printf '\n'
ok "listo: pnpm db:reset"
