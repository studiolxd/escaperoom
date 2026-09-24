# Backups de Postgres (ticket 6.4)

Procedimiento de copia de seguridad y restauración de Postgres (docs/specs/24 §6: "Backups de
PostgreSQL con restauración probada (no solo configurada) antes de producción"). Dos scripts en
`scripts/`, pensados para cron y para que cualquiera pueda comprobar un backup sin memorizar
comandos de `pg_dump`/`pg_restore`.

## Los scripts

- **`scripts/backup-postgres.sh`** — `pg_dump -Fc` (formato «custom»: comprimido, el único que
  admite `pg_restore --clean --if-exists`). Por defecto vuelca la base de `packages/shared/.env`
  (`DATABASE_URL`) contra el contenedor de `infra/docker-compose.dev.yml`, a
  `backups/<base>-<fecha>.dump`, y rota dejando los 14 más recientes por base.
- **`scripts/restore-postgres.sh`** — restaura un dump contra una base de **prueba**
  (`escaperoom_restore_test` por defecto), recreándola vacía primero (`dropdb` + `createdb`) para
  que el restore sea reproducible. Nunca toca la base activa a menos que se le pida explícitamente
  con `--target`. Con `--verify-table`/`--verify-count` además comprueba un recuento de filas.

Ambos aceptan `--direct` para usar `pg_dump`/`pg_restore` locales contra `$DATABASE_URL` sin pasar
por Docker (el modo de producción, si el Postgres de despliegue no vive en el mismo Docker Compose
de desarrollo) — requiere tener esos binarios instalados y de versión ≥ la del servidor.

```bash
pnpm db:backup                                    # vuelca la BD de packages/shared/.env
pnpm db:backup -- --db escaperoom                 # vuelca una base concreta del contenedor
pnpm db:backup -- --direct --encrypt yo@edad.pub  # producción: pg_dump local + cifrado con age
pnpm db:restore -- backups/escaperoom-*.dump      # restaura en escaperoom_restore_test
pnpm db:restore -- backups/escaperoom-*.dump \
  --verify-table user --verify-count 12           # + comprueba el recuento
pnpm db:restore -- backups/prod-*.dump --direct \
  --target escaperoom_staging                     # producción: restaura en OTRA base, nunca la activa
```

### `--direct`: nunca sobre la base activa por accidente

`--direct --target` debe ser explícito y **distinto** de la base de `$DATABASE_URL`; si no lo es,
el script se niega a arrancar. Para el caso deliberado de sobrescribir esa misma base (recuperar un
desastre en el sitio, por ejemplo) hay que repetir con `--i-know-this-overwrites`, que además pide
teclear el nombre de la base para confirmar. Antes de restaurar, el script intenta un `pg_dump` de
seguridad de la base destino (si ya existía) a `backups/<target>-pre-restore-<fecha>.dump`, para
poder deshacer un restore equivocado.

Ni `backup-postgres.sh --direct` ni `restore-postgres.sh --direct` pasan nunca la URI completa (con
la contraseña) como argumento de `pg_dump`/`pg_restore` — quedaría visible en `ps`/`/proc` durante
todo el volcado/restore. En su lugar descomponen `DATABASE_URL` en `PGHOST`/`PGPORT`/`PGUSER`/
`PGPASSWORD` (que libpq lee del entorno del proceso, no de sus argumentos). El `.env` se lee con
`grep -E '^DATABASE_URL='` (`scripts/lib/pg-url.sh`), nunca con `source`: un `.env` manipulado con
código de shell no debe poder ejecutarse como el cron/script que lo carga. Alternativa igual de
válida en producción: exportar `PGHOST`/`PGUSER`/`PGPASSWORD` directamente (o usar `~/.pgpass` /
`PGSERVICE`) y omitir `DATABASE_URL`.

### Cifrado de los dumps (opcional)

Los dumps contienen PII (specs/22). Si el destino donde se suben (bucket, volumen) no cifra en
reposo, cifra el `.dump` con `age` (recomendado) o `gpg`:

```bash
pnpm db:backup -- --direct --encrypt <destinatario-age-o-ruta-de-clave-pública>
# o, a mano, sobre un dump ya generado:
gpg --encrypt -r <destinatario> --output f.dump.gpg f.dump
```

## Por qué una base de prueba y no la real

"Restauración probada, no solo configurada" (specs/24 §6) significa que el backup se restaura de
verdad, periódicamente, y no que el `pg_dump` corrió sin error una vez. Restaurar sobre una base
`escaperoom_restore_test` desechable permite comprobarlo tantas veces como haga falta sin arriesgar
la base real: el script la recrea vacía en cada ejecución, así que un restore a medias de la vez
anterior no contamina el siguiente.

## Verificar un backup (procedimiento manual, periódico)

```bash
# 1. Volcar la base activa.
pnpm db:backup

# 2. Restaurar el dump en la base de prueba y comprobar un recuento conocido
#    (ajusta la tabla/recuento a algo que sepas que debe haber — por ejemplo,
#    el número de organizaciones o de salas publicadas en ese momento).
pnpm db:restore -- backups/<fichero>.dump --verify-table room --verify-count <N>

# 3. Inspección manual adicional si hace falta (opcional): entrar a la base de
#    prueba y comprobar contenido real, no solo el recuento.
docker compose -f infra/docker-compose.dev.yml exec -T postgres \
  psql -U postgres -d escaperoom_restore_test -c 'select title, status from room;'
```

Un restore que falla (`pg_restore` con error, o el recuento no cuadra) es una alarma: el backup
programado no sirve y hay que investigar antes de que haga falta de verdad.

## Programarlo (cron / systemd timer / lo que use el despliegue)

```cron
# Diario a las 03:00, backup de la base de producción.
0 3 * * * cd /ruta/al/repo && scripts/backup-postgres.sh --direct >> /var/log/escaperoom-backup.log 2>&1

# Semanal: restaura el último backup contra la base de prueba y verifica.
# (el recuento se saca con las mismas PGHOST/PGUSER/PGPASSWORD que usan los
# scripts, nunca pasando la URI con la contraseña como argumento de psql).
0 4 * * 0 cd /ruta/al/repo && source scripts/lib/pg-url.sh && pg_url_export_env "$DATABASE_URL" && \
  LATEST=$(ls -t backups/*.dump | head -1) && \
  COUNT=$(psql -Atc 'select count(*) from room') && \
  scripts/restore-postgres.sh "$LATEST" --verify-table room --verify-count "$COUNT" \
  >> /var/log/escaperoom-restore-check.log 2>&1
```

El recuento de verificación de la fila semanal se recalcula contra la base real en el momento del
backup (no un número fijo): compara el dump con lo que había cuando se volcó, no con un valor
desactualizado que habría que mantener a mano.

## Dónde viven los dumps

`backups/` está en `.gitignore` — nunca al repo (son datos, potencialmente con PII de
`docs/specs/22-legal-y-cumplimiento.md`). En producción, el destino real del `.dump` (a qué bucket
o volumen se sube tras `backup-postgres.sh`) lo decide quien despliegue; este ticket deja el script
listo para invocarlo desde cron o CI, no un pipeline de subida a un bucket concreto.

## Prueba real ejecutada (ticket 6.4, worktree de desarrollo)

Para cerrar el criterio de aceptación se ejecutó un dump + restore real contra la base aislada de
un worktree (`escaperoom_<slug>`, ver `infra/README.md` § «Una base de datos por worktree»), nunca
contra la base del worktree principal:

1. `pnpm dev:env && pnpm db:reset` — base `escaperoom_<slug>` migrada y sembrada (admin + creador +
   la sala «La Maldición del Rey Aldric» publicada).
2. `scripts/backup-postgres.sh` → dump de ~108 KB.
3. `scripts/restore-postgres.sh <dump> --verify-table user --verify-count 2` → `user: 2 fila(s)`,
   restore verificado.
4. Comprobación de contenido (no solo recuento): `select title, status from room` en
   `escaperoom_restore_test` devolvió `La Maldición del Rey Aldric | published`, igual que en la
   base origen.
5. Limpieza: `dropdb escaperoom_restore_test` y borrado de los `.dump` de prueba.
