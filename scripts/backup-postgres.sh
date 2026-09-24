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
#   scripts/backup-postgres.sh --encrypt destinatario@edad.pub
#                                                   # cifra el .dump con `age` (requiere
#                                                   # tenerlo instalado); también vale
#                                                   # `gpg --encrypt -r <destinatario>`
#                                                   # aplicado a mano sobre el .dump.
#
# Pensado para cron: sin argumentos, sale con el nombre de fichero por stdout
# (una línea) para que el job pueda subirlo a donde corresponda; los mensajes
# de progreso van a stderr.
#
# Seguridad (E-2): en --direct nunca se pasa la URI (con contraseña) como
# argumento de pg_dump — quedaría visible en `ps`/`/proc` mientras dura el
# volcado. Se descompone en PGHOST/PGPORT/PGUSER/PGPASSWORD (leídas por
# libpq del entorno del proceso, no de sus argumentos). El `.env` se lee con
# `grep`, nunca con `source` (un `.env` manipulado no debe poder ejecutar
# código como este script/el cron que lo invoca).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# shellcheck source=lib/pg-url.sh
source "$ROOT/scripts/lib/pg-url.sh"

COMPOSE_FILE=infra/docker-compose.dev.yml
PG_USER=postgres
OUT_DIR="$ROOT/backups"
DB=""
OUT_FILE=""
DIRECT=false
KEEP=14
ENCRYPT_TO=""

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1" >&2; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1" >&2; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$1" >&2; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --out) OUT_FILE="$2"; shift 2 ;;
    --direct) DIRECT=true; shift ;;
    --keep) KEEP="$2"; shift 2 ;;
    --encrypt) ENCRYPT_TO="$2"; shift 2 ;;
    -h | --help) usage ;;
    *) die "opción desconocida: $1 (usa --help)" ;;
  esac
done

# --- Resolver DATABASE_URL / nombre de base ---------------------------------
# Mismo orden de carga que packages/worker/src/main.ts: packages/shared/.env
# primero (lo escribe `pnpm dev:env`), sin pisar lo ya exportado. Se lee con
# `grep` (read_env_var), nunca con `source` (E-2).
if [ -z "${DATABASE_URL:-}" ] && [ -f packages/shared/.env ]; then
  ENV_DATABASE_URL=$(read_env_var packages/shared/.env DATABASE_URL || true)
  [ -n "$ENV_DATABASE_URL" ] && export DATABASE_URL="$ENV_DATABASE_URL"
fi

if [ -z "$DB" ]; then
  [ -n "${DATABASE_URL:-}" ] || die "no hay DATABASE_URL (exporta la variable, pasa --db o ejecuta 'pnpm dev:env' antes)"
  pg_url_parse "$DATABASE_URL" || die "no se pudo parsear DATABASE_URL"
  DB="$PG_URL_DB"
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
  pg_url_export_env "$DATABASE_URL" || die "no se pudo parsear DATABASE_URL"
  pg_dump -Fc -d "$DB" -f "$OUT_FILE"
else
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$PG_USER" -Fc -d "$DB" > "$OUT_FILE" \
    || die "pg_dump falló. ¿Está arriba el contenedor? ('pnpm infra:up')"
fi

SIZE=$(du -h "$OUT_FILE" | cut -f1)
ok "volcado: $OUT_FILE ($SIZE)"

# --- Cifrado opcional (E-2) --------------------------------------------------
# El dump contiene PII (specs/22): si se sube a un bucket/objeto que no cifra
# en reposo, cifrarlo aquí con `age` (recomendado, más simple) o a mano con
# `gpg --encrypt -r <destinatario> --output f.dump.gpg f.dump` después de este
# script.
if [ -n "$ENCRYPT_TO" ]; then
  command -v age >/dev/null || die "--encrypt requiere 'age' instalado (https://age-encryption.org)"
  step "Cifrando el dump con age para '$ENCRYPT_TO'"
  age -r "$ENCRYPT_TO" -o "$OUT_FILE.age" "$OUT_FILE"
  rm -f "$OUT_FILE"
  OUT_FILE="$OUT_FILE.age"
  ok "cifrado: $OUT_FILE"
fi

# --- Rotación ----------------------------------------------------------------
# Solo afecta a backups del mismo prefijo de base en OUT_DIR (no toca ficheros
# pasados explícitamente con --out fuera de ese directorio). Se ordena por
# mtime con `stat` (no parseando la salida de `ls -1t`, E-21: su formato varía
# entre plataformas/locales y no soporta nombres con caracteres especiales).
if [ "$(dirname "$OUT_FILE")" = "$OUT_DIR" ] && [ "$KEEP" -gt 0 ] 2>/dev/null; then
  step "Rotación (conserva los $KEEP más recientes de '$DB-*')"
  for f in "$OUT_DIR/${DB}-"*.dump*; do
    [ -e "$f" ] || continue
    mtime=$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f")
    printf '%s\t%s\n' "$mtime" "$f"
  done | sort -rn -k1,1 | cut -f2- | tail -n "+$((KEEP + 1))" | while IFS= read -r f; do
    rm -f "$f"
    ok "borrado (rotación): $f"
  done
fi

printf '%s\n' "$OUT_FILE"
