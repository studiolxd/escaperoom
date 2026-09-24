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
#   scripts/restore-postgres.sh f.dump --direct --target escaperoom_staging
#                                                  # pg_restore local contra un
#                                                  # host de producción/staging
#                                                  # (requiere pg_restore
#                                                  # instalado); --target debe
#                                                  # ser explícito y distinto
#                                                  # de la base de DATABASE_URL,
#                                                  # o pasa --i-know-this-overwrites
#                                                  # (pide confirmación) para
#                                                  # restaurar sobre esa misma
#                                                  # base.
#
# Con --verify, además de restaurar, comprueba un recuento de filas de una
# tabla contra el número esperado (--verify-table --verify-count).
#
# Seguridad (E-1/E-2): --direct nunca restaura silenciosamente sobre la base
# de DATABASE_URL (sería sobrescribir producción con un dump quizá viejo); y
# nunca pasa la URI (con contraseña) como argumento de pg_restore — se
# descompone en PGHOST/PGPORT/PGUSER/PGPASSWORD, leídas por libpq del entorno,
# no de los argumentos del proceso (visibles en `ps`/`/proc`).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# shellcheck source=lib/pg-url.sh
source "$ROOT/scripts/lib/pg-url.sh"

COMPOSE_FILE=infra/docker-compose.dev.yml
PG_USER=postgres
TARGET=escaperoom_restore_test
TARGET_EXPLICIT=false
DIRECT=false
I_KNOW_OVERWRITE=false
DUMP=""
VERIFY_TABLE=""
VERIFY_COUNT=""
IDENT_RE='^[A-Za-z_][A-Za-z0-9_]*$'

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1" >&2; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1" >&2; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$1" >&2; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

[ $# -gt 0 ] || usage
DUMP="$1"; shift
[ -f "$DUMP" ] || die "no existe el fichero de dump: $DUMP"

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; TARGET_EXPLICIT=true; shift 2 ;;
    --direct) DIRECT=true; shift ;;
    --i-know-this-overwrites) I_KNOW_OVERWRITE=true; shift ;;
    --verify-table) VERIFY_TABLE="$2"; shift 2 ;;
    --verify-count) VERIFY_COUNT="$2"; shift 2 ;;
    -h | --help) usage ;;
    *) die "opción desconocida: $1 (usa --help)" ;;
  esac
done

# E-21: --verify-table se interpola en SQL más abajo (comilla doble, no es un
# literal parametrizable en psql -c) — solo se acepta un identificador simple.
if [ -n "$VERIFY_TABLE" ] && ! [[ "$VERIFY_TABLE" =~ $IDENT_RE ]]; then
  die "--verify-table inválido: '$VERIFY_TABLE' (debe cumplir $IDENT_RE)"
fi

step "Restore de Postgres (verificación de backup)"
ok "dump: $DUMP"
ok "base destino: $TARGET"

if $DIRECT; then
  [ -n "${DATABASE_URL:-}" ] || die "--direct requiere DATABASE_URL apuntando al servidor destino"
  command -v pg_restore >/dev/null || die "pg_restore no está instalado (requerido con --direct)"
  pg_url_export_env "$DATABASE_URL" || die "no se pudo parsear DATABASE_URL"
  ORIGIN_DB="$PG_URL_DB"

  # E-1: en --direct, TARGET debe ser explícito y distinto de la base activa
  # de DATABASE_URL, salvo que se pida expresamente sobrescribirla.
  if [ "$TARGET" = "$ORIGIN_DB" ] && ! $I_KNOW_OVERWRITE; then
    die "--direct con --target '$TARGET' es la MISMA base de DATABASE_URL. Si es intencional (sobrescribir la base activa) repite con --i-know-this-overwrites (pedirá confirmación)."
  fi
  if ! $TARGET_EXPLICIT && ! $I_KNOW_OVERWRITE; then
    die "--direct requiere --target explícito (no el valor por defecto '$TARGET'), o --i-know-this-overwrites"
  fi

  ok "servidor: $PGHOST:$PGPORT (usuario $PGUSER)"
  ok "base de DATABASE_URL: $ORIGIN_DB — base destino del restore: $TARGET"

  if $I_KNOW_OVERWRITE; then
    warn "vas a SOBRESCRIBIR (pg_restore --clean) la base '$TARGET' en $PGHOST:$PGPORT"
    printf 'Escribe el nombre de la base para confirmar: ' >&2
    read -r CONFIRM
    [ "$CONFIRM" = "$TARGET" ] || die "confirmación no coincide con '$TARGET', abortando"
  fi

  step "Backup de seguridad de '$TARGET' antes de restaurar"
  SAFETY_DIR="$ROOT/backups"
  mkdir -p "$SAFETY_DIR"
  SAFETY_FILE="$SAFETY_DIR/${TARGET}-pre-restore-$(date +%Y%m%d-%H%M%S).dump"
  if PGDATABASE="$TARGET" pg_dump -Fc -f "$SAFETY_FILE" 2>/dev/null; then
    ok "backup de seguridad: $SAFETY_FILE"
  else
    rm -f "$SAFETY_FILE"
    warn "no se pudo volcar un backup de seguridad de '$TARGET' (¿no existe todavía? se continúa)"
  fi

  step "Restaurando en '$TARGET' (DIRECT, $PGHOST:$PGPORT)"
  pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET" "$DUMP"
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
  if $DIRECT; then
    COUNT=$(PGDATABASE="$TARGET" psql -Atc "select count(*) from \"$VERIFY_TABLE\"")
  else
    COUNT=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$PG_USER" -d "$TARGET" -Atc "select count(*) from \"$VERIFY_TABLE\"")
  fi
  ok "$VERIFY_TABLE: $COUNT fila(s)"
  if [ -n "$VERIFY_COUNT" ] && [ "$COUNT" != "$VERIFY_COUNT" ]; then
    die "esperaba $VERIFY_COUNT fila(s) en '$VERIFY_TABLE' y hay $COUNT — el restore no cuadra"
  fi
fi

printf '\n\033[1;32m✔ restore verificado en %s\033[0m\n' "$TARGET" >&2
