# Fase 5 — Negocio: pagos y eventos (semanas 17–20)

**Objetivo:** B2C, eventos B2B/Edu, claves, panel del organizador y licencias entre creadores.
**Depende de:** puede empezar en paralelo desde la Fase 2.
**Hito:** un profesor compra un evento de 30 claves, las reparte, confirma asistencias y supervisa
las partidas en vivo. Primer cobro real end-to-end.

Referencias: `specs/02-modelo-de-negocio.md`, `specs/13-api-rest.md`, `specs/14-modelo-de-datos-sql.md`,
`specs/19-ux-pantallas-clave.md`.

---

| # | Ticket | Detalle | Spec | Criterio de aceptación |
|---|---|---|---|---|
| 5.1 | **Stripe B2C + Connect** | Checkout de sala con `purchase_type: 'room'`, reparto 70/30, `stripe_transfer_id` en el webhook | `13` §5, §7 | Compra de prueba (4242) concede acceso y registra el reparto |
| 5.2 | **B2C "una partida"** | `play_session_started_at`/`colyseus_room_id`; `GET /access` → `{owned, playable}` | `02` §2.1, `13` §4 | Tras jugar una vez, `playable: false`; reconectar a la misma room sí se permite |
| 5.3 | **Catálogo + reseñas + SEO** | Listado/detalle SSR, filtros (idioma, dificultad, precio, jugadores), reseñas (upsert) | `13` §3 | El catálogo es indexable y el filtro de idioma usa `languages @>` |
| 5.4 | **Eventos + tramos** | Crear evento, `pricing_snapshot` desde `pricing_tiers`, hasta 10 sesiones, `grouping_mode`; autoventa gratis si el organizador es el autor | `02` §3, `13` §6.1 | Un evento calcula el total por tramos correctamente |
| 5.5 | **Claves** | Generación individual/rotativa/grupo/batch; estados; caducidad por job; rotación con `regenerated_from` | `02` §4, `14` §6 | Una clave individual muere al canjearse; una rotativa invalida la anterior |
| 5.6 | **Emails + confirmación** | Resend/Postmark: invitaciones individuales/masivas, confirmación opcional, reenvío; panel "28/30 confirmados" | `02` §4.4, `13` §6.2 | El email de confirmación cambia la clave a `confirmed` |
| 5.7 | **PDF de tarjetas** | Export directo (<50) o job async con URL firmada en R2 | `13` §9 | Un lote de 100 claves genera un PDF descargable |
| 5.8 | **Canje + agrupación** | `redeem` → `joinToken`; asignación específica/aleatoria/libre; `SESSION_FULL` | `02` §3.3, `13` §6.2 | Un invitado sin cuenta canjea y entra en la sesión asignada |
| 5.9 | **Panel del organizador** | Dashboard, progreso por grupo, ranking del evento, modo observador (SpectatorRoom), reenvío/export | `19` §2, `21` §4 | El panel refleja el progreso en vivo de varias sesiones |
| 5.10 | **Licencias entre creadores** | `license-checkout` y `gift-copy`; fork independiente en `draft`; linaje `forked_from_*` | `02` §5, `13` §4 | Un creador compra/recibe una copia editable propia |
| 5.11 | **Precios/settings/DPA admin** | `admin/pricing-tiers`, `admin/settings/:key`, `organizations/:id/dpa/sign` | `13` §10, `18` §3.1 | Se firma DPA y se habilitan claves individuales con email |

## Hito 5

Un profesor compra un evento de 30 claves, las reparte, confirma asistencias y supervisa las
partidas en vivo desde su panel. Primer cobro real end-to-end (B2C y B2B).

## Paralelizable

- El **catálogo (5.3)** puede entrar antes que eventos si la Fase 3 ya publica salas.
- El **panel del organizador (5.9)** depende del modo observador de Colyseus (protocolo ya definido).

## Reutilización SLXD (ADR-017)

- **5.6** → `@slxd/mailer` (un transporte, SMTP + Resend).
- **5.9 / 5.11** → `@slxd/roles` (roles y permisos de organización).
- **5.4 / 5.7 / webhooks Stripe** → colas, webhooks salientes y storage de `@slxd/kit`.

## Decisión abierta a cerrar en esta fase

El matiz de "una partida" B2C al abandonar (¿se consume al crear la sesión o al terminarla?) debe
cerrarse antes del lanzamiento — ver `specs/02-modelo-de-negocio.md` §2.1.
