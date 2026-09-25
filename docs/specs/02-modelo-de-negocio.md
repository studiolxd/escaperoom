# 02 — Modelo de negocio

Depende de `01-vision-y-alcance.md`. Los detalles de esquema están en
`14-modelo-de-datos-sql.md`; los endpoints, en `13-api-rest.md`.

---

## 1. Los cuatro modelos de ingreso

| Fuente | Modelo | Reparto |
|---|---|---|
| **Venta de salas (B2C)** | Precio fijo 0,99–4,99 € por **una partida** | 70 % creador / 30 % plataforma |
| **Eventos (B2B/Edu)** | ~1 €/jugador, tramos con descuento | 100 % plataforma (o licencia al creador si la sala es de otro) |
| **Licencia de sala entre creadores** | Precio libre por el autor de la sala | 70 % creador origen / 30 % plataforma |
| **Créditos IA** | Packs de créditos (p. ej. 5 / 10 / 25 €) | 100 % plataforma (margen sobre coste ElevenLabs) |

Ingreso futuro (v2): comisión de marketplace 20–30 % sobre licencias de evento entre terceros
(ver `23-motor-v2-marketplace-y-api-publica.md`).

---

## 2. Venta individual de salas (B2C)

### 2.1 Regla de acceso: una compra = una partida

Comprar una sala **no da derecho a jugarla indefinidamente**: da derecho a **una partida**.

**Resuelta (bloque 3 de la auditoría, 2026-09-25):** si el grupo abandona antes de terminar, la
partida **no se pierde**: la compra solo se consume al llegar a `game_ended` (victoria, derrota o
tiempo agotado), nunca por crear la sesión ni por una caída de conexión. Tres estados de
`purchase`:

- **Libre** (`play_session_started_at IS NULL`, o "en curso" pero caducada — ver más abajo): la
  compra está "sin estrenar" (o se puede reintentar).
- **En curso** (`play_session_started_at` fijado, `play_session_ended_at` `NULL`): la `GameRoom`
  de esa compra existe y sigue viva. Al crear la partida por primera vez (`GameRoom.onCreate`,
  ticket 2.8), el servidor comprueba esta condición con una escritura condicional; si la gana,
  rellena `play_session_started_at` y `play_session_colyseus_id`. Una segunda creación para la
  misma compra se rechaza mientras siga en curso — pero **si la `GameRoom` se cierra sin llegar a
  `game_ended`** (todos se fueron, se expulsó la room…), la reclamación se **libera**
  (`play_session_started_at`/`play_session_colyseus_id` vuelven a `NULL`) y la compra vuelve a
  estar libre. Reconectar a la MISMA `GameRoom` sigue funcionando mientras esté viva (mismo
  `gameToken` de la compra, cubierto por el protocolo).
- **Consumida** (`play_session_ended_at` fijado): definitivo. `playable` nunca vuelve a `true`.

**Caída del servidor sin `onDispose`:** una reclamación "en curso" mucho más vieja que la
duración máxima de una partida (`GAME_TIME_LIMIT_SEC`, 1 h) más un margen —
`PLAY_SESSION_STALE_AFTER_SECONDS` = 2 h, `packages/shared/src/services/game-access.ts`— se trata
como libre y se puede volver a reclamar. Vive en la propia condición de la escritura, no en un
job de limpieza.

- `GET /api/rooms/:roomId/access` devuelve `{ owned, playable, gameToken?, roomId? }`: libre y en
  curso son ambas `playable: true` (en curso además lleva `roomId`, para que el cliente se UNA a
  esa `GameRoom` en vez de crear otra); consumida es `playable: false` sin token.
- El comprador invita a sus amigos gratis: los invitados entran con enlace/código de sesión sin
  pasar por checkout.
- El botón de catálogo decide "Jugar"/"Reanudar" vs. "Comprar" a partir de esta misma ruta.

### 2.2 Publicación y precios

- El creador marca en cada sala si es apta para venta individual, para eventos, o ambas
  (`rooms.sale_individual`, `rooms.sale_events`).
- Precio por sala definido por el creador (`rooms.price_cents`, 0,99–4,99 € sugerido).
- El reparto 70/30 se liquida vía **Stripe Connect** (`stripeTransferId` del creador en el
  webhook, no en la creación del checkout).

---

## 3. Eventos (B2B / B2Educación)

El pago no lo hace quien juega: **el organizador paga por adelantado y reparte acceso**.

### 3.1 Flujo del organizador

1. Elige una sala **que ya posee** (la creó él o adquirió su copia; ver §5).
2. Configura la jornada: título, nº de sesiones simultáneas (hasta 10), jugadores por sesión
   (1–N), modo de agrupación, si exige confirmación de invitación, reglas de caducidad de claves.
3. Paga: nº de jugadores × tarifa según tramos vigentes (§3.2).
4. Recibe las claves (por email a una lista o descarga/imprime tarjetas PDF).
5. Vigila la jornada en su panel en vivo (§4).

Reglas de negocio:

- Si el organizador **es el propio creador** de la sala, las claves son gratuitas (no se paga a
  sí mismo) y el evento pasa directo a activable sin checkout.
- **Sin reembolso**: el saldo no consumido queda como crédito para futuros eventos.
- Hasta **10 sesiones simultáneas** por evento.

### 3.2 Tramos de precio (tabla editable)

Los tramos dejan de ser constantes de código y pasan a ser **filas editables** en
`pricingTier` (ver `14-modelo-de-datos-sql.md`). Valores iniciales (seed):

| Jugadores | Precio / unidad |
|---|---|
| 1–15 | 1,00 € |
| 16–50 | 0,90 € |
| 51–150 | 0,75 € |
| 151+ | 0,60 € |

Ejemplo de negocio: un instituto de 120 alumnos paga ~90 € por una actividad completa, con 10
sesiones simultáneas cubriendo una clase entera.

Regla de edición: cambiar precios = crear fila nueva con `activeFrom` futuro y cerrar la
anterior con `activeUntil`; **nunca `UPDATE` de una fila vigente** (no se altera el histórico).
`events.pricing_snapshot` congela los tramos en el momento de la compra.

### 3.3 Distribución en grupos

El organizador decide cómo reparte a la gente (`events.grouping_mode`):

- **Específicos** (`specific`): asigna "estos correos → Sesión 3, Grupo A".
- **Aleatorios** (`random`): la plataforma equilibra por tamaño.
- **Libre** (`free`): el asistente elige sesión al canjear, hasta agotar aforo.

---

## 4. Claves de acceso

### 4.1 Tipos

| Tipo | Descripción | Caso de uso |
|---|---|---|
| **Individual** (single-use) | Un asistente = una clave = un asiento; muere al canjearse | Profe reparte tarjetas impresas; control de asistencia |
| **Rotativa** | El organizador la regenera cuando quiere; la anterior queda inválida | Sesiones sucesivas o filtración de código |
| **De grupo** | Un código compartido para N personas | Grupos pequeños sin lista previa |
| **Batch (lista masiva)** | Generación en lote + envío por email individual o descarga/impresión de tarjetas PDF | Empresas: RRHH pega la lista y cada uno recibe su invitación |

### 4.2 Ciclo de vida

```
generada → enviada → [pendiente_confirmación →] confirmada → activa → usada | caducada
```

| Estado | Significado |
|---|---|
| `generated` | Creada junto al evento, aún sin asignar correo |
| `sent` | Email enviado (individual o masivo) |
| `pending_confirmation` | Esperando que el asistente confirme asistencia (solo si el organizador activó requerir confirmación) |
| `confirmed` | El asistente confirmó — visible ✅ en el panel del organizador |
| `active` | Puede canjearse por un asiento en la partida |
| `used` | Canjeada → asiento ocupado, clave muerta (single-use) |
| `expired` | Caducada por cualquiera de las reglas de §4.3 |

### 4.3 Reglas de caducidad (combinables, definidas al crear el evento)

1. **Por jornada:** a las X horas tras la fecha/hora de inicio (`hours_after_start`).
2. **Por sesión con límite de tiempo:** al terminar la partida (superada o tiempo agotado)
   todas las claves de esa sesión mueren (`on_session_end`).
3. **Por grupo completo:** si el grupo supera la sala, las claves no usadas de ese grupo mueren
   (`on_group_complete`).

Detalle fino: si el organizador configuró `grouping_mode: 'free'`, las reglas 2/3 aplican a la
sesión en la que se canjeó, no al evento entero.

### 4.4 Confirmación de invitaciones (opcional por evento)

```
Organizador activa "Requerir confirmación"
  → sube lista de correos (o genera claves sin correo)
  → cada asistente recibe email: "Has sido invitado a [Sala].
     Tu clave: XXXX-XXXX. Confirma tu asistencia aquí."
  → el asistente hace clic → clave pasa a confirmada
  → panel muestra: 28/30 confirmados (con opción de reenviar a los 2 pendientes)
```

- El profe sabe que sus 30 alumnos recibieron de verdad la clave antes del día D; RRHH obtiene
  confirmación formal de asistencia.
- *Fallback:* si alguien nunca confirma, el organizador puede regenerar esa clave y asignarla a
  otro. Los eventos sin confirmación obligatoria saltan directo a `activa`.

### 4.5 Canje

`POST /api/access-keys/redeem` valida estado y caducidad, marca `used`/`active` según
`single_use` y devuelve un `joinToken` (JWT corto, **no la clave en claro**) que el cliente
presenta al `join` de Colyseus.

---

## 5. Licencias de salas entre creadores

Un organizador solo puede montar un evento sobre una sala que **ya posee**. Para que un creador
obtenga la copia de otro hay dos vías:

- **Compra de licencia:** el autor pone precio a su sala como producto para otros creadores
  (`rooms.licensable`, `rooms.license_price_cents`). Otro creador la compra y recibe una
  **copia independiente, editable y suya** (no una referencia compartida). Reparto 70/30 igual
  que la venta individual.
- **Envío directo / regalo:** el autor envía una copia gratuita a otro creador concreto (por
  email o usuario), sin checkout. Mismo mecanismo de copia, precio 0.

Cambios de esquema (ver `14-modelo-de-datos-sql.md`): `rooms.licensable`, `rooms.license_price_cents`,
`rooms.forked_from_room_id`, `rooms.forked_from_version_id`; `purchase_type = 'room_license'`;
`purchases.resulting_room_id`; `purchases.stripe_payment_intent_id` deja de ser obligatorio
(compras a precio 0). Endpoints: `POST /api/rooms/:roomId/license-checkout` y
`POST /api/rooms/:roomId/gift-copy` (ver `13-api-rest.md`).

- El **linaje** se conserva siempre (moderación, atribución interna) aunque la UI no lo muestre.
- La copia recién creada nace en `status: 'draft'` en la cuenta del comprador (para revisarla
  antes de publicarla como propia).
- Supuesto asumido: el reparto de licencias es el mismo 70/30; si debiera ser distinto, es un
  ajuste de un número, no de esquema.

---

## 6. Créditos IA

- La app vende **créditos** que los creadores gastan en generaciones IA (ElevenLabs y futuros
  servicios: imágenes, música).
- Los créditos son **a nivel de plataforma**: un pool de tokens internos (no créditos
  ElevenLabs directos) que la plataforma canjea en su cuenta global de ElevenLabs, con margen.
- **Todo el subsistema de usuarios, organizaciones y ledger de créditos ya está desarrollado en
  SLXD** y se copia/adapta: cuentas personales y de organización ilimitadas, saldo, histórico,
  compra y consumo. Detalle en `15-audio-y-creditos-ia.md` y `14-modelo-de-datos-sql.md` §4.
- Coste contable por generación: nº caracteres × tarifa ElevenLabs → conversión a créditos
  internos (redondeo a la unidad, mínimo 1 crédito por generación). Margen objetivo ≥ 50 %.

---

## 7. Panel del organizador

Definición funcional (el diseño de pantalla está en `19-ux-pantallas-clave.md` §2):

- Estado de cada sesión (en curso / finalizada / tiempo agotado).
- Progreso por grupo: **qué puzzles se han resuelto y cuánto se tardó en cada uno**
  (estadísticas puras: % resolución, media de tiempo por puzzle; **sin** etiquetado de objetivos
  didácticos).
- Claves: enviadas / confirmadas / usadas / caducadas; reenvío y regeneración individual o en lote.
- Ranking entre grupos del evento (opcionalmente no público, lo decide el profe).
- Modos del organizador en partida:

| Modo | Qué hace |
|---|---|
| **Jugador** | Entra con clave-organizador en un grupo y juega normalmente |
| **Observador** (`SpectatorRoom`) | Ve las sesiones en vivo sin ocupar plaza; salta entre las 10 sesiones |
| **Híbrido** (v2) | Observa y puede lanzar pistas globales a un grupo desde el panel |

---

## 8. Casos de uso y marketing

- 🏫 **Instituto:** profe crea una sala de historia, paga ~90 €, 120 alumnos en 10 grupos, panel
  para ver qué grupo va ganando.
- 🏢 **Empresa:** RRHH contrata team-building, reparte claves por email, grupos aleatorios
  mezclando departamentos.
- 🎉 **Cumpleaños / escape room virtual:** anfitrión paga 10 claves, invita por WhatsApp.
- 🏆 **Campeonato:** un creador organiza un torneo con 10 sesiones simultáneas y ranking por tiempo.

El profe que organiza un evento **es un creador potencial**: tras su primer evento, el panel
muestra una CTA contextual al wizard de creación (ver `25-estrategia-de-contenido-y-lanzamiento.md` §3.1).

---

## 9. Business plan (detalle)

### 9.1 Fuentes de ingreso

Ver tabla de §1. Reparto de eventos: si la sala es de tercero, el creador percibe según la
modalidad de licencia; si es del propio organizador, 100 % plataforma o gratis (autoventa).

### 9.2 Costes principales

- Infra: 20–60 €/mes (VPS + R2 + LiveKit) hasta ~1.000 CCU.
- ElevenLabs: coste variable cubierto por créditos (margen objetivo ≥ 50 %).
- Stripe: 1,5 % + 0,25 € por transacción europea.
- Moderación: tiempo humano (cola de revisión).

### 9.3 Palancas de crecimiento

- SEO del catálogo (Next.js SSR) → "escape room online de historia/matemáticas".
- El profe que organiza un evento → onboarding a creador.
- Salas oficiales temáticas por asignatura (hechas con el propio MCP) como contenido de marketing.
- Programa de referidos: créditos gratis por organizador referido (a ambos lados).

### 9.4 Riesgo fiscal/legal a resolver

- Stripe Connect + repartos multi-país (retenciones, KYC de creadores).
- Facturación B2B para institutos/empresas (IVA, factura con datos fiscales).
- RGPD: voz y webcam de menores en aulas → consentimiento del organizador + modo "sin cámara
  por defecto" (ver `18-legal-rgpd-y-menores.md`).

---

## 10. Dependencias

- `specs/14-modelo-de-datos-sql.md` — tablas, constraints y ledger.
- `specs/13-api-rest.md` — endpoints de compras, eventos, claves, licencias.
- `specs/12-voz-y-webcam-livekit.md` — defaults de audio/vídeo por tipo de evento.
- `specs/19-ux-pantallas-clave.md` — panel del organizador y canje del invitado.
