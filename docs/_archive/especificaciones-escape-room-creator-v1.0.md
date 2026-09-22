# EscapeRoom Creator — Especificaciones v1.0

**Plataforma de creación, venta y juego de escape rooms 2D isométricos cooperativos (1–N jugadores) desde navegador.**

Documento consolidado de especificaciones. Fecha: 2026-09-21. Estado: v1.0 aprobado para iniciar desarrollo.

---

## 1. Resumen ejecutivo

Plataforma web donde:

- **Creadores** diseñan escape rooms estilo RPG isométrico con un editor visual, o **conversando con un agente IA** a través de un servidor MCP integrado.
- **Jugadores** juegan salas cooperativas en tiempo real (movimiento, chat, voz y webcam) resolviendo puzzles explorando escenarios.
- **Organizadores** (profesores, empresas, animadores) compran "eventos": pagajan ~1 € por jugador y reciben claves de acceso individuales para repartir entre sus asistentes, con panel de seguimiento en vivo.

Sin app móvil: solo navegador de escritorio en v1.

---

## 2. Actores y roles

| Rol | Descripción |
|---|---|
| **Jugador** | Juega salas. Puede comprar salas individualmente o entrar gratis con clave de evento. |
| **Creador** | Crea y publica salas con el editor visual o el MCP. Recibe 70 % de las ventas de su sala. Plan gratuito, sin premium. |
| **Organizador** | Crea un *evento* sobre una sala: compra N claves, las reparte, vigila el progreso en vivo. Puede jugar u observar. |
| **Moderador/Admin** | Revisión de contenido, reportes, retiradas. |

## 3. Modelo de negocio

### 3.1 Venta individual de salas (B2C)

- El jugador compra una sala (0,99–4,99 €, precio del creador) y puede jugarla con amigos (el comprador invita, los amigos entran gratis).
- Reparto 70 % creador / 30 % plataforma, gestionado con **Stripe Connect**.
- El creador marca si su sala admite venta individual, eventos, o ambos.

### 3.2 Eventos (B2B / B2Educación)

- El organizador paga **~1 € por jugador**, con descuentos por volumen (propuesta):

| Jugadores | Precio/unidad |
|---|---|
| 1–15 | 1,00 € |
| 16–50 | 0,90 € |
| 51–150 | 0,75 € |
| 151+ | 0,60 € |

- Si el organizador es el propio creador de la sala, las claves son gratuitas (no se paga a sí mismo).
- Hasta **10 sesiones simultáneas** por evento. Los asistentes se distribuyen en grupos: **específicos** (el organizador asigna), **aleatorios** (la plataforma equilibra) o **libre** (el asistente elige sesión al canjear, hasta aforo).
- Sin reembolso; saldo no consumido queda como crédito para futuros eventos.

### 3.3 Claves de acceso

Tipos:

| Tipo | Descripción |
|---|---|
| Individual (single-use) | Un asistente = una clave = un asiento. La clave muere al canjearse. |
| Rotativa | El organizador puede regenerarla cuando quiera; la anterior queda inválida. |
| De grupo | Un código compartido para N personas. |
| Lista masiva | Generación en lote + envío por email individual o descarga/impresión de tarjetas PDF. |

**Confirmación de invitaciones (opcional por evento):** el asistente debe hacer clic en "confirmar" en el email; el organizador ve en su panel cuántos han confirmado y puede reenviar/regenerar.

**Caducidad (reglas combinables, definidas al crear el evento):**

1. A las X horas tras la fecha de inicio de la jornada.
2. Al finalizar la partida de su sesión (superada o tiempo agotado).
3. Si el grupo completa la sala, las claves no usadas de ese grupo mueren.

### 3.4 Ciclo de vida de la clave

```
generada → enviada → [pendiente_confirmación →] confirmada → activa → usada | caducada
```

### 3.5 Panel del organizador

- Estado de cada sesión (en curso / finalizada / tiempo agotado).
- Progreso por grupo: puzzles resueltos y tiempo por puzzle (estadísticas, sin objetivos didácticos).
- Claves: enviadas / confirmadas / usadas / caducadas; reenvío y regeneración individuales o en lote.
- Ranking entre grupos del evento.
- Modos del organizador en partida: **jugador**, **observador** (salta entre sesiones, no ocupa plaza) e, híbrido v2: lanzar pistas a un grupo.

---

## 4. Referencia de diseño: "La Maldición del Rey Aldric"

Sala medieval de 3 salas (Salón del Trono → Bodega de los Vinos Encantados → Catacumbas), 2–4 jugadores, 60 minutos. Usa las 8 plantillas del MVP y sirve como caso de validación de editor, runtime y MCP (debe poder construirse entera desde el chat).

Resumen de puzzles: llave escondida tras cuadro, candado numérico 4 dígitos (pistas en escenario), placas simultáneas (con objeto-puente para modo solitario: cáliz), mural deslizante, memoria de copas, reja con pista dividida entre mirillas (objeto-puente: espejo), canal de tuberías y candado final que repasa pistas de todo el castillo (4-5-3-8).

Lecciones de diseño adoptadas: progresión tutorial→clímax; objetos que viajan entre salas; cada mecánica cooperativa tiene objeto-puente para jugador solo; código final como repaso; estados visibles compartidos entre jugadores.

---

## 5. Stack tecnológico

```
Aplicación (catálogo, perfiles, checkout, dashboard, editor UI):  Next.js (TypeScript)
Juego (runtime de salas):                                         Phaser 3, embebido en Next.js
Editor de salas:                                                  Next.js + Yjs + el propio runtime en modo edición
Partidas (estado autoritativo, 1–N jugadores):                    Colyseus (Node.js + WebSocket)
Chat de texto:                                                    canal de la room de Colyseus
Voz y webcam:                                                     LiveKit (self-hosted, WebRTC)
Agente IA creador:                                                Servidor MCP (TypeScript, MCP SDK)
Colaboración en edición:                                          Yjs (CRDT) sobre PostgreSQL
Base de datos:                                                    PostgreSQL (JSONB para RoomPackage)
Caché / presencia:                                                Redis
Assets:                                                           Cloudflare R2
Pagos:                                                            Stripe + Stripe Connect
Emails transaccionales:                                           Resend o Postmark
PDF de tarjetas-clave:                                            @react-pdf/renderer
Auth:                                                             Auth.js (NextAuth) — email + OAuth
Infraestructura:                                                  Docker + VPS (Hetzner) + Cloudflare + GitHub Actions
```

Decisiones clave:

- **Phaser 3 (híbrido con React), no Godot ni PixiJS puro:** todo el código del producto queda en TypeScript; tilemaps isométricos, cámara e input resueltos; la integración webcam/WebRTC y la UI rica son naturales en DOM.
- **Colyseus y no solo Node WS:** añade gestión de salas, sincronización de estado autoritativo, reconexión y matchmaking sobre Node. **Yjs se reserva para el editor colaborativo** (CRDT = convergencia, ideal para co-edición y offline), no para la partida (que necesita autoridad central).
- **El editor ES el runtime** en modo edición: WYSIWYG absoluto, un solo código.

---

## 6. Arquitectura del cliente: Phaser + React (híbrido)

```
┌─────────────────────────────────────────────┐
│  Capa React (DOM, overlay sobre el canvas)  │
│  HUD, inventario, diálogos, chat, webcam,   │
│  menús y puzzles que se abren como panel    │
├─────────────────────────────────────────────┤
│  Capa Phaser (canvas)                       │
│  Mapa isométrico, avatares, objetos,        │
│  animaciones, efectos, cámara               │
└─────────────────────────────────────────────┘
```

- **Regla de oro:** ¿el puzzle es parte del mundo o abre un panel? Mundo → Phaser; panel/formulario → React.
- **Puente entre capas:** store Zustand conectado al cliente Colyseus. Ambas capas reaccionan al mismo estado de partida.
- **El overlay React** va sobre el canvas con `pointer-events: none` en el contenedor y `auto` en elementos interactivos.
- Colyseus vive en la capa React y alimenta a ambas (el servidor muta el estado; cliente nunca se autovalida).
- **Los componentes React de puzzle son compartidos** entre jugar, editar y previsualizar.

---

## 7. Multijugador y comunicación en partida

- **Estado de partida:** rooms de Colyseus con estado autoritativo; definición estática de la sala se descarga una vez (RoomPackage); la instancia viva (puzzles, inventario, posiciones) se sincroniza como patches.
- **Validación siempre en servidor** (puzzles, códigos, recetas, caducidades de clave).
- **Voz/webcam:** LiveKit self-hosted; la room de medios se crea junto a la room de Colyseus y muere con ella. Mesh WebRTC puro admisible solo si N ≤ 6 (no recomendado).
- **Chat de texto:** mensajes por el WebSocket de Colyseus (sin infra extra).
- **Anti-trampa:** el cliente jamás conoce soluciones (p. ej. el código del candado vive solo en el servidor); el servidor asigna posiciones ocultas (memoria); el servidor calcula conectividad (tuberías).
- **Modo solitario sin bloqueos:** cada mecánica cooperativa admite un `soloBridgeItemId` (objeto que sustituye a un jugador).

---

## 8. Plantillas de puzzle (MVP)

Base común:

```typescript
interface PuzzleDefinition {
  id: string;                    // "sala1-arca-candado" (IDs legibles)
  type: PuzzleType;
  layer: 'world' | 'panel';      // Phaser o React
  roomId: string;
  position?: { x: number; y: number };
  requiresSolved: string[];      // encadenamiento
  grantsItems: string[];
  unlocks: string[];
  timeLimitSec?: number;
}

type PuzzleState = 'locked' | 'available' | 'in_progress' | 'solved' | 'failed';
```

| # | Plantilla | Capa | Validación en servidor |
|---|---|---|---|
| 1 | Llave escondida (`hidden_key`) | world (Phaser) | Click en escondite válido → otorga item |
| 2 | Candado numérico (`code_lock`) | panel (React) | Compara código (secreto solo en servidor); maxAttempts + lockoutSec |
| 3 | Botones simultáneos (`simultaneous_plates`) | world (Phaser) | Todas las placas activas dentro de `windowMs`; `soloBridgeItemId` fija una placa |
| 4 | Combinar objetos (`combine_items`) | React (inventario) | Recetas: valida posesión de inputs → consume/otorga |
| 5 | Puzle deslizante (`sliding_puzzle`) | panel (React) | Orden de piezas; mezcla garantizada resoluble (barajar con movimientos válidos) |
| 6 | Memoria (`memory`) | panel (React) | Parejas y turnos; símbolos asignados por el servidor, revelados al voltear |
| 7 | Pista dividida (`split_clue`) | híbrido | El servidor decide qué fragmentos ve cada jugador según posición; espejo como puente solitario |
| 8 | Tuberías (`pipes`) | panel (React) | Flood fill start→end (admite múltiples soluciones válidas) |

Componentes React puros y reutilizables: `<CodeLockPuzzle>`, `<SlidingPuzzle>`, `<MemoryPuzzle>`, `<PipesPuzzle>`, `<InventoryPanel>`, `<SymbolInput>`.

---

## 9. Formato de sala (RoomPackage) y sistema de reglas

Contrato único entre editor, API, base de datos, MCP y runtime:

```typescript
interface RoomPackage {
  meta: { id, title, authorId, version, theme, description, language,
          estimatedMinutes, difficulty, players: {min,max}, assetsManifest };
  map: { tileset, layers, rooms: SubRoom[], spawnPoints, lighting };
  objects: WorldObject[];   // puertas, cajones, placas, escondites…
  items: ItemDef[];
  puzzles: PuzzleDefinition[];
  rules: Rule[];            // lógica declarativa SI/ENTONCES
  dialogs: LocalizedText[]; // i18n
  hints: HintDef[];
}
```

**Declarativo, no scripting:** el runtime y el servidor evalúan datos, nunca código del creador.

Vocabulario de reglas (MVP):

- **Triggers:** `on_interact`, `on_enter_room`, `on_puzzle_solved`, `on_item_collected`, `on_timer`, `on_all_players_in_zone`.
- **Conditions:** `item_in_inventory`, `puzzle_state_is`, `flag_is`, `player_count_min/max`, `time_remaining_below`.
- **Actions:** `set_object_state`, `unlock_door`, `grant_item`, `consume_item`, `show_dialog`, `start_timer`, `play_sound`, `spawn_effect`, `open_panel_puzzle`.

Ejemplo (brasero del Rey Aldric):

```json
{
  "id": "rule-encender-brasero",
  "trigger": { "type": "on_interact", "objectId": "brasero" },
  "conditions": [{ "type": "item_in_inventory", "itemId": "antorcha", "consumed": true }],
  "actions": [
    { "type": "set_object_state", "objectId": "brasero", "state": "lit" },
    { "type": "reveal_number", "objectId": "brasero-inscription", "value": "3" },
    { "type": "show_dialog", "dialogId": "brasero-encendido" }
  ]
}
```

---

## 10. Editor de salas

### 10.1 Arquitectura

- El editor es una página Next.js (`/editor/[roomId]`) que monta el runtime de Phaser con `mode: 'edit'` — WYSIWYG real.
- **Yjs doc = fuente de verdad en memoria**; updates binarios persistidos incrementalmente en PostgreSQL (tabla `room_updates`) + snapshots periódicos (historial/restauración, autosave continuo, trabajo offline con merge al reconectar).
- **Yjs Awareness:** cursores de colaboradores y quién edita qué.

### 10.2 Flujo de creación

1. **Escenario:** pintar tiles (brush/fill/layers), definir subrooms y spawn points.
2. **Objetos:** colocar desde palette (puertas, cajones, placas…), IDs legibles propuestos automáticamente (`arca-trono`).
3. **Puzzles:** insertar plantillas y configurarlas en su panel (mismos componentes React que en juego).
4. **Lógica:** grafo de reglas (vista nodo): conectar trigger → condiciones → acciones arrastrando.
5. **Probar y publicar:** playtest en vivo (room temporal de Colyseus), link de prueba para un amigo, checklist y `publish`.

### 10.3 Validador automático (continuo)

- Objetos/puzzles huérfanos (requieren algo que nadie otorga).
- Dead ends (puertas que jamás se abren).
- Puzzles sin pista asociada (avisos).
- Estimación de ruta de solución y duración.
- Mismo validador corrige al editor humano **y al agente MCP**.

### 10.4 Draft vs. publicado

- `room_drafts`: doc Yjs vivo, mutable, colaborativo.
- `room_versions`: inmutable, una fila por versión publicada; assets empaquetados en R2 con hash. Los parches crean versiones nuevas; los eventos vendidos pueden fijar versión.

---

## 11. MCP del creador (agente IA en el chat)

El MCP es un cliente más de la misma API del editor: **todo lo que el editor visual puede hacer, el MCP puede hacerlo.**

### Toolset

**Estructura:** `create_room(meta)` · `set_map(...)` · `paint_tiles(...)` · `define_subrooms(...)`

**Contenido:** `add_object(...)` · `define_item(...)` · `add_puzzle(...)` · `add_dialog(...)` · `add_hint(...)`

**Lógica:** `add_rule(...)` · `get_room_graph()`

**Verificación/publicación:** `validate()` · `preview()` · `publish({versionNotes})`

**Consulta:** `get_room()` · `get_template_catalog()` · vistas filtradas (`get_puzzle(id)`, `get_rules_for(objectId)`) para ahorrar tokens.

### Reglas del MCP

- Esquemas Zod **compartidos** en monorepo (`packages/shared`) — cero deriva de tipos entre editor, API y MCP.
- Cada mutación: valida → dry-run → validador incremental → commit al Yjs doc (el agente aparece como colaborador, puede co-editar con humanos).
- Errores accionables: "el objeto 'salida-bodega' no existe. Disponibles: [...]".
- Solo opera sobre drafts; `publish()` exige validación en verde + confirmación humana.
- Transporte stdio (Claude Desktop, desarrollo) + HTTP streamable (chat del creador integrado en Next.js).
- Auth OAuth; actúa con los permisos del creador autenticado.

### Caso objetivo

El escape room de ejemplo completo construido por conversación en ~30 minutos, jugable y publicable. Si el agente puede construir una sala, el editor visual también puede (test E2E perpetuo).

---

## 12. Modelo de datos (resumen de entidades)

```
users            (id, email, role, stripe_account_id)
rooms            (id, author_id, status)           -- cabecera
room_drafts      (room_id, yjs updates/snapshots)
room_versions    (id, room_id, semver, package_json, assets_hash)
objects/puzzles/rules/items/dialogs/hints  -- dentro de RoomPackage (JSONB)
events           (id, organizer_id, room_version_id, config, pricing)
sessions         (id, event_id, colyseus_room_id, status, started_at, ended_at)
groups           (id, session_id, name, assigned_key_ids)
access_keys      (code, event_id, session_id?, email?, status, expires_at,
                  confirmed_at, require_confirmation, single_use)
purchases        (user_id, room_version_id | event_id, stripe refs)
progress_events  (session_id, puzzle_id, solved_at, duration_ms)  -- panel organizador
reviews          (user_id, room_version_id, rating, text)
```

## 13. Infraestructura

- Monorepo: `packages/{web, game-runtime, editor, mcp-server, colyseus-server, shared}`.
- Docker Compose en VPS Hetzner (v1): web, colyseus, LiveKit, PostgreSQL, Redis, R2 como almacenamiento externo.
- Cloudflare: CDN + SSL + protección. GitHub Actions: CI/CD.
- Coste estimado MVP: 10–20 €/mes + LiveKit (self-hosted, en el mismo VPS).

## 14. Seguridad y moderación

- Servidor autoritativo en todo (puzzles, claves, pagos, reglas).
- Código de candados y soluciones nunca en el cliente.
- Claves single-use + caducidades + regeneración.
- Moderación de contenido publicado (reportes + revisión), términos para UGC.
- Rate limiting (Redis) en API y MCP.

---

## 15. Fuera de alcance (v1)

App móvil, assets custom del creador (v2), plugin system de puzzles (v2), pistas lanzadas por el organizador (v2), condiciones anidadas AND/OR (v2), puzzles custom en world-layer deslizante (v2).
