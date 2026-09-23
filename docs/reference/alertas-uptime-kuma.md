# Alertas de disponibilidad con Uptime Kuma (ticket 6.4)

Procedimiento corto para configurar el monitor de disponibilidad (docs/specs/24 §6). Uptime Kuma
es autohospedado: no hay cuenta ni API externa que integrar en el código, solo un contenedor
(`infra/docker-compose.dev.yml`) que se configura a mano desde su propia UI, tanto en desarrollo
como en producción.

## Qué vigila

`GET /api/health` de `packages/web` (`packages/web/src/app/api/health/route.ts`). Comprueba las dos
dependencias de las que depende que la app responda:

- **Postgres**: un `SELECT 1` por Prisma.
- **Redis**: `redisHealth()` de `@escaperoom/kit/health` (la misma conexión compartida que usa el
  rate limiting del ticket 6.3). Sin `REDIS_URL` configurado responde `not_configured` y **no**
  cuenta como caída (degradación sin colas es un estado válido en desarrollo).

Responde `200` con `{ ok: true, database, redis, timestamp }` cuando todo está arriba, `503` con
`ok: false` en cuanto Postgres no responde o Redis (si está configurado) está caído. Es
intencionadamente ligero: nada de lógica de negocio, solo las dos sondas.

No hay un endpoint equivalente para `colyseus-server` ni `worker` en este ticket — quedan fuera de
alcance; `packages/kit/src/health/index.ts` ya trae `createWorkerHealthHandler` por si un ticket
futuro quiere montarlo ahí.

## Arrancar Uptime Kuma

```bash
pnpm infra:up   # incluye el contenedor uptime-kuma (infra/docker-compose.dev.yml)
```

La UI queda en `http://localhost:59003` (puerto `UPTIME_KUMA_PORT`, por defecto `59003`; el
contenedor escucha en `3001`). El primer arranque pide crear el usuario admin local — nunca se
preconfiguran credenciales en el repo.

## Configurar el monitor (una vez, a mano)

1. Entrar en `http://localhost:59003` y crear el usuario admin (solo la primera vez).
2. **Add New Monitor**:
   - **Monitor Type**: `HTTP(s) - Keyword` (o `HTTP(s)` a secas; el keyword permite comprobar
     `"ok":true` en el cuerpo, no solo el código HTTP).
   - **Friendly Name**: `escaperoom-web /api/health`.
   - **URL**: en dev, `http://host.docker.internal:3000/api/health` (Uptime Kuma corre en Docker;
     `pnpm --filter @escaperoom/web dev` corre en el host, así que no vale `localhost` desde dentro
     del contenedor). En producción, la URL pública de `packages/web` + `/api/health`.
   - **Heartbeat Interval**: 30–60 s es suficiente para un MVP sin guardia 24/7 (specs/24 §6: "sin
     guardia 24/7 formal, el modelo realista es degradación con gracia + alertas").
   - **Retries**: 2–3 antes de marcar caído, para no avisar por un timeout suelto.
   - **Upside Down Mode**: apagado (el healthcheck es "up = 200", no al revés).
3. **Notifications** → añadir un canal (email, Slack, Telegram, webhook genérico — lo que use el
   equipo) y activarlo en el monitor. Sin un canal configurado, Uptime Kuma solo lo marca "down" en
   su dashboard, sin avisar a nadie: para cumplir "una caída simulada dispara alerta" hace falta al
   menos un canal.
4. Guardar. El estado inicial debería quedar `Up` (verde) en segundos.

## Probar que una caída dispara la alerta

Esto es la prueba del criterio de aceptación ("una caída simulada dispara alerta"), no solo un
monitor configurado y en verde:

```bash
# 1. Con la web y el monitor arriba y en verde…
docker compose -f infra/docker-compose.dev.yml stop postgres

# 2. Esperar el intervalo configurado (30-60 s) + los reintentos.
#    GET /api/health empieza a responder 503 (database: "down") en cuanto
#    Prisma agota su pool de conexión a Postgres.

# 3. Comprobar en la UI de Uptime Kuma (http://localhost:59003):
#    - el monitor pasa a "Down" (rojo);
#    - llega la notificación por el canal configurado en el paso 3 de arriba;
#    - el "Important Events" del monitor registra el cambio con marca de tiempo.

# 4. Restaurar:
docker compose -f infra/docker-compose.dev.yml start postgres
# El monitor vuelve a "Up" en el siguiente heartbeat y, según el canal, también
# avisa de la recuperación.
```

Variante sin tocar Postgres: `docker compose -f infra/docker-compose.dev.yml stop redis` con
`QUEUES_ENABLED=true` también tumba el healthcheck (Redis pasa a `down`, no a `not_configured`,
porque estaba configurado y dejó de responder).

## Producción

Mismo procedimiento, apuntando la URL del monitor al dominio público de `packages/web`. Uptime Kuma
en sí no es parte del despliegue de la app — vive en su propio host/contenedor con datos
persistentes (`uptime-kuma-data` en dev); quien lo despliegue en producción decide dónde vive esa
persistencia (specs/24 §6 no exige alta disponibilidad del propio monitor, solo que exista).
