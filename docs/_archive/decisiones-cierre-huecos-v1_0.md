# Decisiones de cierre — huecos y contradicciones detectados

Responde punto por punto al análisis de huecos anterior. Es un documento de **enmienda**: cada sección dice qué cambia y sobre qué documento previo, no repite lo que ya no cambia. Los documentos afectados deben leerse junto a esta adenda hasta que alguien haga la consolidación (§7, explícitamente fuera de alcance aquí).

---

## 1. Venta y licencia de salas entre creadores (resuelve la pregunta de reparto en eventos de terceros)

**Decisión:** un organizador solo puede montar un evento sobre una sala que **ya posee** (la creó él mismo, o adquirió su propia copia). Eso significa que el escenario problemático original — "¿quién cobra si el organizador usa la sala de otro?" — deja de existir: siempre hay una transacción explícita antes, con su propio reparto.

Dos vías nuevas para que un creador obtenga la copia de otro:

- **Compra de licencia**: el creador origen pone un precio a su sala como producto para otros creadores (no para jugadores). Otro creador la compra, y recibe **su propia copia independiente**, editable, que pasa a ser suya de cara al catálogo, a eventos y a reventa — no una referencia compartida a la sala original.
- **Envío directo/regalo**: el creador origen puede enviar una copia gratuita a otro creador concreto (por email o usuario), sin pasar por checkout. Mismo mecanismo de copia, precio 0.

**Cambios de esquema** (sobre `esquema-sql-migraciones-v1.0.md` §5, §7):

```sql
ALTER TABLE rooms ADD COLUMN licensable          boolean NOT NULL DEFAULT false;
ALTER TABLE rooms ADD COLUMN license_price_cents  int CHECK (license_price_cents IS NULL OR license_price_cents >= 0);
ALTER TABLE rooms ADD COLUMN forked_from_room_id    uuid REFERENCES rooms(id);
ALTER TABLE rooms ADD COLUMN forked_from_version_id uuid REFERENCES room_versions(id);
-- El linaje se conserva siempre (moderación, atribución interna), aunque la UI
-- decida no mostrarlo públicamente — eso es una decisión de producto, no de esquema.

ALTER TYPE purchase_type ADD VALUE 'room_license';

-- Las compras a precio 0 (regalo) necesitan poder existir sin Stripe de por medio:
ALTER TABLE purchases ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;
ALTER TABLE purchases ADD COLUMN resulting_room_id uuid REFERENCES rooms(id);
  -- se rellena cuando el fork se completa (síncrono: al confirmarse el pago,
  -- o inmediato en el caso del regalo)
ALTER TABLE purchases ADD CONSTRAINT chk_purchases_paid_needs_stripe CHECK (
  amount_cents = 0 OR stripe_payment_intent_id IS NOT NULL
);
```

El `CHECK` `chk_purchase_target` (§7 del esquema) se amplía: `purchase_type = 'room_license'` exige `room_version_id` (la versión origen que se licencia) y `event_id IS NULL`, igual que `'room'`.

**Endpoints nuevos** (sobre `api-rest-backend-v1.0.md` §4–5):

| Método | Ruta | Descripción |
|---|---|---|
| PATCH | `/api/rooms/:roomId` | (ampliación) añade `licensable`, `licensePriceCents` a los campos editables |
| POST | `/api/rooms/:roomId/license-checkout` | Un creador compra la licencia de la sala de otro → Stripe Checkout, `purchase_type: 'room_license'` |
| POST | `/api/rooms/:roomId/gift-copy` | El autor envía una copia gratuita a otro creador (`{ recipientEmail }`) — sin Stripe, fork inmediato |

**Supuesto que asumo y dejo marcado:** el reparto de la venta de licencia es el mismo 70/30 ya usado en venta individual (`purchases.creator_share_cents`), por coherencia con el resto del modelo — si el reparto de licencias debiera ser distinto, es un ajuste de un número, no de esquema.

**Decisión de producto que queda abierta:** la copia recién creada nace en `status: 'draft'` en la cuenta del comprador (para que la revise/personalice antes de publicarla como propia), no publicada automáticamente.

---

## 2. RoomPackage multiidioma

**Decisión:** un mismo RoomPackage puede contener varios idiomas a la vez (no un idioma por versión publicada).

**Cambio al formato** (sobre `especificaciones-escape-room-creator-v1.0.md` §9):

```typescript
// Antes:
meta: { ..., language: string, ... }

// Ahora:
meta: { ..., languages: string[], defaultLanguage: string, ... }

// LocalizedText deja de ser un string y pasa a ser un mapa por locale
// (también resuelve el punto 3, ver abajo):
type LocalizedText = Record<string /* locale, ej. 'es', 'en' */, {
  text: string;
  audioUrl?: string;
}>;
```

- `dialogs` y `hints` usan este `LocalizedText` — cada entrada trae su texto y, opcionalmente, su audio **por idioma** (el narrador en español y en inglés no tiene por qué sonar igual, ni generarse en el mismo momento).
- El **catálogo** (`GET /api/rooms` en `api-rest-backend-v1.0.md` §3) cambia el filtro `language` de coincidencia exacta a "la sala incluye este idioma" (`languages @> ARRAY[...]`).
- El **editor** necesita un selector de idioma activo por campo de texto — no es un cambio de esquema, pero sí de UI (afecta al ticket 3.4/3.5 del roadmap, inspector y configuradores de plantilla).

---

## 3. Campo de audio en diálogos y pistas

Ya resuelto dentro del cambio de §2 (`LocalizedText.audioUrl`), porque el audio generado con ElevenLabs es inherentemente por idioma — no tenía sentido añadirlo como campo aparte sin resolver primero la pregunta de multiidioma.

**Conexión con el ledger de créditos** (`esquema-sql-migraciones-v1.0.md` §4): cuando el editor genera un audio, el `reference_id` del `credit_movement` correspondiente pasa a ser `{dialogId o hintId}:{locale}` — así un mismo diálogo con audio en dos idiomas genera dos movimientos de crédito distintos, cada uno trazable a su locale.

---

## 4. Tabla de tramos de precio editable

**Decisión:** los tramos de precio de eventos (`especificaciones-escape-room-creator-v1.0.md` §3.2) dejan de estar implícitos y pasan a ser filas editables.

```sql
-- adenda a esquema-sql-migraciones-v1.0.md §6
CREATE TABLE pricing_tiers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_players           int NOT NULL,
  max_players           int,                    -- null = sin límite superior (el tramo "151+")
  price_cents_per_player int NOT NULL,
  currency              char(3) NOT NULL DEFAULT 'EUR',
  active_from           timestamptz NOT NULL DEFAULT now(),
  active_until          timestamptz,            -- null = vigente
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_pricing_tiers_active ON pricing_tiers(active_from, active_until);
```

- `events.pricing_snapshot` (`esquema-sql-migraciones-v1.0.md` §6) sigue existiendo igual — es la copia congelada en el momento de la compra — pero ahora se construye consultando `pricing_tiers` en vez de una constante de código.
- Cambiar precios es crear una fila nueva con `active_from` futuro y cerrar la anterior con `active_until`, nunca un `UPDATE` sobre una fila vigente (para no alterar retroactivamente el histórico de lo ya vendido).
- Endpoint nuevo: `GET/POST/PATCH /api/admin/pricing-tiers` (adenda a `api-rest-backend-v1.0.md` §10, solo `is_admin`).

---

## 5. Un único máximo de jugadores, compartido entre capacidad de sala y tope de vídeo de LiveKit

**Decisión:** en vez de dos límites que podían divergir (el `players.max` libre del creador en `especificaciones-escape-room-creator-v1.0.md` §2.2, y el cap fijo de 6 publishers de `arquitectura-livekit-v1.0.md` §3), pasa a haber **un solo valor configurable desde la app** que alimenta a los dos sitios a la vez.

```sql
-- adenda a esquema-sql-migraciones-v1.0.md — tabla de configuración de plataforma
CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- fila inicial (seed):
INSERT INTO platform_settings (key, value) VALUES ('max_players_per_room', '6');
```

- **El validador de solvabilidad** (`plan-pruebas-qa-v1.0.md` §2 / `POST /api/rooms/:roomId/validate`) lee `max_players_per_room` y rechaza `players.max` por encima de ese valor — ya no es una regla de negocio fija en el código del validador, es una consulta.
- **LiveKit** (`arquitectura-livekit-v1.0.md` §3) deja de tener "cap duro de 6" como constante propia: usa exactamente el mismo valor. Si alguien lo sube a 8 desde el panel de administración, sube a la vez el techo de creación de salas y el cap de publishers — nunca pueden quedar desincronizados porque es la misma fila.
- Endpoint: `GET/PATCH /api/admin/settings/:key` (genérico, no solo para este valor — sirve para cualquier ajuste de plataforma futuro del mismo tipo).

---

## 6. Compra individual (B2C): acceso a **una sola partida**

**Decisión:** comprar una sala no da derecho a jugarla indefinidamente — da derecho a **una partida**. Esto sustituye la suposición implícita que tenían los documentos anteriores (acceso ilimitado tipo "compra digital estándar"). Aplica solo a la venta individual §3.1 — no afecta a eventos (que ya tienen su propio ciclo de sesiones vía `access_keys`) ni a la venta de licencia a creadores (§1, que no es "jugar", es "poseer una copia").

```sql
-- adenda a esquema-sql-migraciones-v1.0.md §7
ALTER TABLE purchases ADD COLUMN play_session_started_at   timestamptz;
ALTER TABLE purchases ADD COLUMN play_session_colyseus_id  text;
```

- Al comprar (`purchase_type = 'room'`), `play_session_started_at` queda `NULL` — la sala está "sin estrenar".
- Cuando el comprador (el host) crea la partida por primera vez (matchmake contra el `LobbyRoom` de Colyseus), el servidor comprueba que `play_session_started_at IS NULL`; si lo está, lo rellena y guarda el id de la `GameRoom`. Una segunda llamada a matchmake para la misma compra se rechaza — **salvo que sea una reconexión a la misma `GameRoom`** (`allowReconnection`, ya cubierto por el protocolo, `protocolo-mensajes-colyseus.md` §8), que no cuenta como "otra partida".
- `GET /api/rooms/:roomId/access` (`api-rest-backend-v1.0.md` §5) cambia de devolver solo `{ owned }` a `{ owned, playable }` — `playable: false` cuando ya se consumió la única partida.

**Pregunta que dejo explícitamente sin cerrar** (no la decido por vosotros porque es un matiz de producto, no un vacío técnico): si el grupo abandona la partida sin terminarla — ¿"una vez" significa una vez literal (se pierde igual) o solo cuenta si llegan a `game_ended`? Tal como está escrito lo he implementado de la forma más literal (se consume al **crear** la sesión, no al terminarla) porque es lo que se dijo, pero es la primera cosa que un usuario real va a reclamar si se corta la conexión a mitad de partida — merece una frase explícita antes de lanzarlo.

---

## 7. Consolidación del esquema SQL — diferida

Todas las adendas de este documento (más las ya pendientes de `plan-moderacion-contenido-v1.0.md` §4, `arquitectura-livekit-v1.0.md` §5.3 y `api-rest-backend-v1.0.md` §7) siguen sin fusionarse de vuelta en `esquema-sql-migraciones-v1.0.md`. Queda fuera del alcance de este documento a propósito — se encarga otro agente. Lista de lo pendiente de fusionar, para que quien lo haga no tenga que releer seis documentos:

- `content_reports`: columnas `severity`, `category`, `source` (`plan-moderacion-contenido-v1.0.md` §4)
- `events`: columna `audience` (`plan-moderacion-contenido-v1.0.md` §7, `arquitectura-livekit-v1.0.md` §5.1), y las claves `allowVideo`/`recordingEnabled` dentro de `events.config` (`arquitectura-livekit-v1.0.md` §4–5)
- Tabla `event_recordings` completa (`arquitectura-livekit-v1.0.md` §5.3)
- Tabla `stripe_webhook_events` (`api-rest-backend-v1.0.md` §7)
- Todo lo de este documento: `rooms.licensable/license_price_cents/forked_from_*`, `purchase_type: 'room_license'`, `purchases.resulting_room_id/play_session_*`, tablas `pricing_tiers`, `platform_settings`, y la tabla de apelaciones de §9

---

## 8. Cabos sueltos ya reconocidos — se mantienen tal cual, sin resolver todavía

Confirmado: siguen abiertos, sin cambios sobre lo ya escrito en cada documento de origen. Se listan aquí solo para que no se pierdan de vista al planificar el trabajo:

- `packageFormat` en `meta` del RoomPackage, pendiente de añadir (`roompackage-rey-aldric-v1.0.md`).
- LiveKit self-hosted vs. Cloud: pendiente de prueba con tráfico real en Fase 2 (`arquitectura-livekit-v1.0.md` §2.2).
- Titularidad del audio generado con ElevenLabs, plazos fiscales de retención, plantilla de DPA — pendientes de asesoría (`legal-tos-rgpd-menores-v1.0.md` §5).
- Job de purga de `analytics_events` (la partición ya existe, falta el cron).

---

## 9. Mecanismo de apelación

**Decisión:** se añade. Un creador puede apelar tanto un bloqueo de pre-check al publicar como una retirada/strike ya aplicado.

```sql
-- adenda a esquema-sql-migraciones-v1.0.md §10
CREATE TABLE moderation_appeals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        uuid NOT NULL REFERENCES users(id),
  room_id           uuid REFERENCES rooms(id),          -- null si la apelación es sobre el estado de la cuenta, no una sala concreta
  content_report_id uuid REFERENCES content_reports(id), -- si apela la resolución de un reporte concreto
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'overturned')),
  reviewed_by       uuid REFERENCES users(id),
  resolution_note   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz
);
CREATE INDEX ix_moderation_appeals_status ON moderation_appeals(status) WHERE status = 'pending';
```

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/rooms/:roomId/appeal` | autor de la sala | Apela un bloqueo de pre-check o una retirada sobre esa sala concreta |
| POST | `/api/me/appeal` | usuario | Apela una suspensión de cuenta (sin sala concreta asociada) |
| GET | `/api/admin/appeals` | `is_admin \| is_moderator` | Cola de apelaciones pendientes |
| PATCH | `/api/admin/appeals/:id` | `is_admin \| is_moderator` | Resuelve: `upheld` (se mantiene la decisión) u `overturned` (se revierte — reincorpora la sala o levanta el strike) |

Entra en la misma cola y SLA de `plan-moderacion-contenido-v1.0.md` §4 (severidad `normal` salvo que la apelación sea sobre un caso `crítico`, donde no aplica — esos no tienen apelación, tal como ya fija ese documento en su §6, "no tiene primera falta").
