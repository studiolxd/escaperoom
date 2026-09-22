#!/usr/bin/env bash
#
# dev-env — base de datos por worktree (ticket 0.12).
#
# Deriva un slug estable del path del worktree y escribe packages/shared/.env
# apuntando a la base `escaperoom` (worktree principal) o `escaperoom_<slug>`
# (cualquier worktree enlazado), creándola en el contenedor Postgres si falta.
# Así dos worktrees migran y siembran a la vez sin pisarse.
#
#   pnpm dev:env              # idempotente; NO pisa un .env existente
#   pnpm dev:env -- --force   # reescribe packages/shared/.env
#
# Prerequisito: `pnpm infra:up` (Postgres en localhost:55433).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    -h | --help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
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

printf '\n'
ok "listo: pnpm db:reset"
