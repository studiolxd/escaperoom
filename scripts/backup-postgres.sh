#!/usr/bin/env bash
#
# backup-postgres — dump programable de Postgres (ticket 6.4, docs/specs/24 §6).
#
# Por defecto vuelca la base del CONTENEDOR de infra/docker-compose.dev.yml (la
# misma que usa este worktree, ver `pnpm dev:env` y `packages/shared/.env`) con
# `pg_dump -Fc` (formato «custom»: comprimido y el único que acepta pg_restore
# con --clean/--if-exists, que es lo que usa restore-postgres.sh).
#
#   scripts/backup-postgres.sh                    # vuelca la BD de packages/shared/.env
#   scripts/backup-postgres.sh --db escaperoom     # vuelca una BD concreta del contenedor
#   scripts/backup-postgres.sh --out /ruta/f.dump  # ruta de salida explícita
#   scripts/backup-postgres.sh --direct            # pg_dump local contra $DATABASE_URL,
#                                                   # sin Docker (producción; requiere el
#                                                   # cliente `pg_dump` instalado y con
#                                                   # versión >= la del servidor)
#
# Pensado para cron: sin argumentos, sale con el nombre de fichero por stdout
# (una línea) para que el job pueda subirlo a donde corresponda; los mensajes
# de progreso van a stderr.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

COMPOSE_FILE=infra/docker-compose.dev.yml
PG_USER=postgres
OUT_DIR="$ROOT/backups"
DB=""
OUT_FILE=""
DIRECT=false
KEEP=14

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1" >&2; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1" >&2; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --out) OUT_FILE="$2"; shift 2 ;;
    --direct) DIRECT=true; shift ;;
    --keep) KEEP="$2"; shift 2 ;;
    -h | --help) usage ;;
    *) die "opción desconocida: $1 (usa --help)" ;;
  esac
done

# --- Resolver DATABASE_URL / nombre de base ---------------------------------
# Mismo orden de carga que packages/worker/src/main.ts: packages/shared/.env
# primero (lo escribe `pnpm dev:env`), sin pisar lo ya exportado.
if [ -z "${DATABASE_URL:-}" ] && [ -f packages/shared/.env ]; then
  # shellcheck disable=SC1091
  set -a; source packages/shared/.env; set +a
fi

if [ -z "$DB" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    die "no hay DATABASE_URL (exporta la variable, pasa --db o ejecuta 'pnpm dev:env' antes)"
  fi
  # postgresql://user:pass@host:port/DBNAME → DBNAME
  DB=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-zA-Z+]+://[^/]+/([^?]+).*#\1#')
fi
[ -n "$DB" ] || die "no se pudo derivar el nombre de la base de DATABASE_URL"

mkdir -p "$OUT_DIR"
if [ -z "$OUT_FILE" ]; then
  OUT_FILE="$OUT_DIR/${DB}-$(date +%Y%m%d-%H%M%S).dump"
fi

step "Backup de Postgres"
ok "base: $DB"
ok "destino: $OUT_FILE"

if $DIRECT; then
  [ -n "${DATABASE_URL:-}" ] || die "--direct requiere DATABASE_URL"
  command -v pg_dump >/dev/null || die "pg_dump no está instalado (requerido con --direct)"
  pg_dump "$DATABASE_URL" -Fc -f "$OUT_FILE"
else
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$PG_USER" -Fc -d "$DB" > "$OUT_FILE" \
    || die "pg_dump falló. ¿Está arriba el contenedor? ('pnpm infra:up')"
fi

SIZE=$(du -h "$OUT_FILE" | cut -f1)
ok "volcado: $OUT_FILE ($SIZE)"

# --- Rotación ----------------------------------------------------------------
# Solo afecta a backups del mismo prefijo de base en OUT_DIR (no toca ficheros
# pasados explícitamente con --out fuera de ese directorio).
if [ "$(dirname "$OUT_FILE")" = "$OUT_DIR" ] && [ "$KEEP" -gt 0 ] 2>/dev/null; then
  step "Rotación (conserva los $KEEP más recientes de '$DB-*')"
  # shellcheck disable=SC2012
  ls -1t "$OUT_DIR/${DB}-"*.dump 2>/dev/null | tail -n "+$((KEEP + 1))" | while IFS= read -r f; do
    rm -f "$f"
    ok "borrado (rotación): $f"
  done
fi

printf '%s\n' "$OUT_FILE"
