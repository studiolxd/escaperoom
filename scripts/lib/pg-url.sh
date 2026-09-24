# scripts/lib/pg-url.sh — helpers para leer una DATABASE_URL sin volcarla en
# la línea de comandos de otros procesos (E-2: evita que la contraseña quede
# visible en `ps`/`/proc` cuando se llama a pg_dump/pg_restore).
#
# Pensado para `source`arse desde scripts/backup-postgres.sh y
# scripts/restore-postgres.sh. No lo ejecutes directamente.

# read_env_var <fichero> <NOMBRE> — lee NOMBRE=valor de un .env por texto
# (grep), nunca con `source` (un .env con código de shell no se ejecuta).
# Imprime el valor (sin comillas) por stdout, o nada si no está.
read_env_var() {
  local file="$1" name="$2"
  [ -f "$file" ] || return 1
  grep -E "^${name}=" "$file" | tail -n1 | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

# pg_url_parse <DATABASE_URL> — descompone una URI postgresql://user:pass@host:port/db
# en PG_URL_USER/PG_URL_PASSWORD/PG_URL_HOST/PG_URL_PORT/PG_URL_DB.
pg_url_parse() {
  local url="$1"
  if [[ "$url" =~ ^[A-Za-z0-9+]+://([^:@/]+)(:([^@/]*))?@([^:/]+)(:([0-9]+))?/([^?]+) ]]; then
    PG_URL_USER="${BASH_REMATCH[1]}"
    PG_URL_PASSWORD="${BASH_REMATCH[3]}"
    PG_URL_HOST="${BASH_REMATCH[4]}"
    PG_URL_PORT="${BASH_REMATCH[6]:-5432}"
    PG_URL_DB="${BASH_REMATCH[7]}"
  else
    return 1
  fi
  # decodificado básico de %XX (suficiente para usuarios/contraseñas generados
  # por dev-env.sh; si la contraseña real trae otros caracteres especiales,
  # usa PGHOST/PGUSER/PGPASSWORD directamente en vez de una URI).
  PG_URL_USER="${PG_URL_USER//%/\\x}"; PG_URL_USER=$(printf '%b' "$PG_URL_USER")
  PG_URL_PASSWORD="${PG_URL_PASSWORD//%/\\x}"; PG_URL_PASSWORD=$(printf '%b' "$PG_URL_PASSWORD")
}

# pg_url_export_env <DATABASE_URL> — exporta PGHOST/PGPORT/PGUSER/PGPASSWORD a
# partir de la URI para que pg_dump/pg_restore/psql la usen sin que la URI (con
# la contraseña) aparezca nunca como argumento de esos procesos.
pg_url_export_env() {
  pg_url_parse "$1" || return 1
  export PGHOST="$PG_URL_HOST"
  export PGPORT="$PG_URL_PORT"
  export PGUSER="$PG_URL_USER"
  export PGPASSWORD="$PG_URL_PASSWORD"
}
