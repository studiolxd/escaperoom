#!/usr/bin/env bash
#
# restore-postgres — restaura un dump de scripts/backup-postgres.sh contra una
# base de PRUEBA, para poder comprobar periódicamente que los backups sirven
# (ticket 6.4, docs/specs/24 §6: "un restore de backup se verifica").
#
# Por defecto restaura contra `escaperoom_restore_test` en el contenedor de
# infra/docker-compose.dev.yml, la CREA si no existe y la DEJA VACÍA primero
# (drop + create) para que el restore sea reproducible. Nunca toca la base de
# `packages/shared/.env` a menos que se le pida explícitamente con --target.
#
#   scripts/restore-postgres.sh backups/escaperoom-20260101-0000.dump
#   scripts/restore-postgres.sh f.dump --target escaperoom_mi_prueba
#   scripts/restore-postgres.sh f.dump --direct   # pg_restore local contra
#                                                  # DATABASE_URL (producción;
#                                                  # requiere pg_restore instalado)
#
# Con --verify, además de restaurar, comprueba un recuento de filas de una
# tabla contra el número esperado (--verify-table --verify-count).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

COMPOSE_FILE=infra/docker-compose.dev.yml
PG_USER=postgres
TARGET=escaperoom_restore_test
DIRECT=false
DUMP=""
VERIFY_TABLE=""
VERIFY_COUNT=""

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1" >&2; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1" >&2; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

[ $# -gt 0 ] || usage
DUMP="$1"; shift
[ -f "$DUMP" ] || die "no existe el fichero de dump: $DUMP"

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --direct) DIRECT=true; shift ;;
    --verify-table) VERIFY_TABLE="$2"; shift 2 ;;
    --verify-count) VERIFY_COUNT="$2"; shift 2 ;;
    -h | --help) usage ;;
    *) die "opción desconocida: $1 (usa --help)" ;;
  esac
done

step "Restore de Postgres (verificación de backup)"
ok "dump: $DUMP"
ok "base destino: $TARGET"

if $DIRECT; then
  [ -n "${DATABASE_URL:-}" ] || die "--direct requiere DATABASE_URL apuntando a la base destino"
  command -v pg_restore >/dev/null || die "pg_restore no está instalado (requerido con --direct)"
  pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" "$DUMP"
else
  step "Recreando '$TARGET' vacía en el contenedor"
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    dropdb -U "$PG_USER" --if-exists "$TARGET" \
    || die "no se pudo hacer dropdb. ¿Está arriba el contenedor? ('pnpm infra:up')"
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    createdb -U "$PG_USER" "$TARGET"
  ok "base '$TARGET' recreada vacía"

  step "pg_restore"
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_restore -U "$PG_USER" -d "$TARGET" --no-owner --no-privileges < "$DUMP" \
    || die "pg_restore falló"
fi

ok "restore completo"

if [ -n "$VERIFY_TABLE" ]; then
  step "Verificación: recuento de '$VERIFY_TABLE'"
  COUNT=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$PG_USER" -d "$TARGET" -Atc "select count(*) from \"$VERIFY_TABLE\"")
  ok "$VERIFY_TABLE: $COUNT fila(s)"
  if [ -n "$VERIFY_COUNT" ] && [ "$COUNT" != "$VERIFY_COUNT" ]; then
    die "esperaba $VERIFY_COUNT fila(s) en '$VERIFY_TABLE' y hay $COUNT — el restore no cuadra"
  fi
fi

printf '\n\033[1;32m✔ restore verificado en %s\033[0m\n' "$TARGET" >&2
