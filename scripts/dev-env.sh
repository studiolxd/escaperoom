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
# `colyseus-server`, para que el rate limiting, las colas (BullMQ) y el
# pub/sub de `editor-sync` de un worktree no pisen los de otro corriendo en
# paralelo. El worktree principal sigue con el prefijo por defecto.
#
#   pnpm dev:env              # idempotente; NO pisa un .env existente
#   pnpm dev:env -- --force   # reescribe packages/shared/.env (REDIS_PREFIX
#                              # de los demás .env siempre se mantiene al día)
#
# Prerequisito: `pnpm infra:up` (Postgres en localhost:55433, Redis en 56380).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

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

printf '\n'
ok "listo: pnpm db:reset"
