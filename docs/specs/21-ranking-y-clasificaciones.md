# 21 — Ranking y clasificaciones

Depende de `02-modelo-de-negocio.md` (§7, panel del organizador), `11-protocolo-multijugador.md`
y `16-analitica.md`.

---

## 1. Decisiones

- **Ranking por escape room únicamente** (global por sala): cada sala tiene su propia tabla de
  clasificación. No hay ranking global multisala en v1.
- Métrica principal: **tiempo de finalización** (victoria). Desempates: nº de pistas usadas y, con
  penalización suave configurable por el creador, nº de jugadores.
- Categorías por sala:
  - **Cualquier grupo.**
  - **Tamaño fijo:** rankings separados por nº de jugadores (1P, 2P, 3P, 4P).

## 2. Modo clasificación

- Solo entran partidas con **pistas desactivadas** y en la **versión vigente** de la sala.
- El modo se activa explícitamente al crear la sesión (flag en la sesión).
- Cualquier partida con pistas usadas queda fuera del ranking competitivo (pero sigue disponible
  para el ranking "Cualquier grupo" con normalización, si el creador lo permite).

### 2.1 Duración modificada (ticket duración-salas)

Igual que las pistas usadas, una partida jugada con la **duración de partida modificada** por el
organizador de su evento (`event.config.timeLimitMinutes`, `02-modelo-de-negocio.md` §7) queda
fuera del ranking competitivo por sala: el "tiempo de finalización" (§1) de esa partida no es
comparable con el de una jugada con la duración propia de la sala.

- **Marca** (para cuando el ranking global por sala se implemente, hoy fuera de alcance — ver §5):
  presencia de la clave `timeLimitMinutes` en `event.config` (ausente = sin override = cuenta;
  presente, aunque sea `null`, = duración modificada = se excluye). No hace falta una columna
  nueva: es una consulta `event.config ? 'timeLimitMinutes'` (JSONB) al construir el ranking.
- **Reseñas**: si el usuario jugó la sala en algún evento con esta marca, su reseña queda marcada
  (`review.durationOverridden`, calculado al escribir/editar la reseña) — dato de
  moderación/visualización, no cambia el aspecto de la reseña ni la excluye de la media pública.
- El ranking **interno del evento** (§4) SÍ usa la duración modificada con normalidad: todos sus
  grupos juegan con el mismo límite, así que siguen siendo comparables entre ellos.

## 3. Anti-cheat

- Partida verificada por servidor: bitácora de eventos de puzzle (`progressEvent`) con tiempos
  por puzzle y orden de resolución.
- El panel permite a los moderadores ver el **replay de eventos** de una partida (reconstrucción
  de la bitácora, no un vídeo).
- El servidor es la única autoridad de tiempos; el cliente no reporta resultados.

## 4. Ranking en eventos

- Ranking interno del evento **entre sus grupos**, opcionalmente **no público** (lo decide el
  profe).
- Puede proyectarse en clase (el profe muestra el panel en la pizarra) — ver
  `specs/19-ux-pantallas-clave.md` §2.
- Además, cada grupo puede publicar su resultado en el ranking global **por sala** (si el
  organizador y el creador lo permiten).

## 5. Fuera de alcance v1

- Ranking global multisala, torneos oficiales de plataforma, temporadas y retos con clasificación
  (documentados como v2 en `specs/23-motor-v2-marketplace-y-api-publica.md`).
- Comptetitivo con anti-cheat reforzado más allá de la bitácora verificada.

## 6. Dependencias

- `specs/16-analitica.md` — eventos `session_ended` y `puzzle_solved` con tiempos.
- `specs/14-modelo-de-datos-sql.md` §8 — `progressEvent`.
