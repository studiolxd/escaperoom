# Registro de decisiones (ADR)

Este documento recoge **por qué** se eligió cada tecnología y cada decisión estructural, junto con
las alternativas descartadas. Nace de la conversación de diseño original, para que el razonamiento
no se pierda al consolidar las specs.

Formato: contexto → decisión → consecuencias → alternativas descartadas.

---

## ADR-001 — Cliente de juego: Phaser 3 híbrido con React

**Contexto:** juego 2D isométrico, web-only, sin app móvil, con chat, webcam y micrófono, equipo que
domina TypeScript.

**Decisión:** Phaser 3 para el mundo (tilemap, avatares, objetos, cámara, efectos); **React (DOM)**
para toda la UI (HUD, inventario, diálogos, chat, webcam) y para los puzzles que se abren como panel.

**Consecuencias:**

- Todo el producto queda en TypeScript end-to-end.
- Tilemaps isométricos, cámara e input resueltos por Phaser.
- WebRTC y la UI rica son naturales en DOM.
- Los componentes React de puzzle se comparten entre editar, previsualizar y jugar.

**Alternativas descartadas:**

- **Godot 4:** mejor editor visual, pero exporta a WebAssembly y la comunicación JS↔Godot/React y
  WebRTC es incómoda en un producto web-only con chat/webcam. La carencia de editor se cubre con el
  propio runtime en modo edición.
- **Unity:** descartado (licencia al escalar, exportación web pesada).
- **PixiJS puro:** solo renderizador; obligaría a construir cámara, input, tilemaps y física a mano.
- **Todo en React** (isométrico en DOM/CSS): obligaría a reimplementar depth-sort, culling,
  animaciones y hit-testing con peor rendimiento.
- **Todo en Phaser** (UI en canvas): formularios, inputs, copiar/pegar, accesibilidad, chat con
  historial y i18n serían dolorosos fuera del DOM. Descartado.

---

## ADR-002 — Regla para decidir capa de un puzzle (mundo vs. panel)

**Contexto:** con la arquitectura híbrida, hay que decidir dónde vive cada puzzle.

**Decisión:** **¿el puzzle ocupa el mundo o abre una pantalla?**

- Parte del mundo → **Phaser** (llave escondida, placas, mural, engranajes, luz y espejos).
- Abre un panel/formulario → **React** (candado, memoria, deslizante, tuberías, circuito, balanza).

**Consecuencias:** los puzzles de panel se testean con testing-library; i18n/temas/accesibilidad se
resuelven con infraestructura estándar.

---

## ADR-003 — Multijugador: Colyseus sobre Node.js

**Contexto:** el equipo ya usaba Node + WebSocket + Yjs.

**Decisión:** **Colyseus** para las partidas.

**Consecuencias:** gestión de salas, sincronización de estado autoritativo (solo patches), reconexión
y matchmaking incluidos. Colyseus **es** Node + WebSocket: añade la capa que si no se escribiría a mano.

**Alternativas descartadas/valoradas:** Node WS propio (hay que construir salas, reconexión,
autoridad y anti-cheat a mano); Photon (lock-in, pricing); Nakama (más complejo de operar).
Migrar a Photon/Nakama en el futuro no sería traumático.

---

## ADR-004 — Yjs solo para el editor, no para la partida

**Contexto:** Yjs (CRDT) y Colyseus (autoridad central) resuelven problemas distintos.

**Decisión:** **híbrido.**

- **Editor colaborativo → Yjs** (convergencia sin autoridad; co-edición, offline, merge sin
  "último gana").
- **Partida → Colyseus** (el servidor decide si el código es correcto; un cliente hackeado no abre
  el relicario).
- **Chat de partida →** canal de la room de Colyseus.

**Consecuencias:** cada herramienta se usa para lo que está pensada. El editor gana autosave,
offline y versionado gratis; la partida gana autoridad.

---

## ADR-005 — Framework web: Next.js

**Decisión:** **Next.js** para todo lo que no es el canvas del juego (landing, catálogo, perfiles,
checkout, dashboard, editor UI).

**Consecuencias:** SSR para SEO del catálogo (canal principal de adquisición de jugadores). Next.js
no compite con React: es React con capacidades de servidor.

---

## ADR-006 — Voz y webcam: LiveKit self-hosted

**Contexto:** partidas cooperativas 1–N con voz y webcam; N pequeño (típico 2–8).

**Decisión:** **LiveKit** self-hosted (SFU), con coturn obligatorio. La room de medios se crea junto
a la de Colyseus y muere con ella.

**Consecuencias:** audio/vídeo de 1–N sin mesh routing; un DPA menos mientras se mantenga
self-hosted; posibilidad de grabar con Egress.

**Alternativas descartadas/valoradas:** mesh WebRTC puro (SimplePeer) solo válido para N ≤ 6 y
degrada; Daily/Twilio (pricing por minuto, menos control); LiveKit Cloud (plan B, probar en Fase 2).

---

## ADR-007 — Formato declarativo, no scripting

**Decisión:** el `RoomPackage` es **JSON declarativo**; el runtime y el servidor evalúan datos
(reglas SI/ENTONCES), nunca código del creador.

**Consecuencias:** validación, seguridad (sin código arbitrario), y el servidor evalúa las mismas
reglas que el cliente descarga sin confiar en él. Habilita el validador y el MCP.

---

## ADR-008 — El editor ES el runtime en modo edición

**Decisión:** el editor no es un programa aparte; es `/editor/[roomId]` montando el runtime con
`mode: 'edit'`, con herramientas y escritura en el doc Yjs en lugar de lectura.

**Consecuencias:** WYSIWYG absoluto; un solo código; mismos componentes de puzzle y mismo
`<PhaserRuntime>` para editar y para playtest. Elimina el riesgo "en el editor se ve bien, en el
juego falla".

**Alternativa valorada:** editor externo tipo Tiled (buena opción para mapas, pero no resuelve
objetos, puzzles, reglas ni WYSIWYG del juego). Se mantiene Tiled como editor de mapas opcional.

---

## ADR-009 — Grafo de reglas con React Flow

**Decisión:** la vista de nodos del grafo de reglas usa **React Flow**.

**Razones:** los nodos son exactamente `trigger → conditions → actions`; el validador resalta nodos
con estilos por dato; el MCP edita el mismo grafo (datos en Yjs) sin capa de sincronización extra.

---

## ADR-010 — MCP del creador como cliente de la misma API

**Decisión:** el MCP no tiene vía paralela; sus tools son wrappers finos sobre la API REST y el canal
Yjs, con el token OAuth del creador. Esquemas Zod compartidos en `packages/shared`.

**Consecuencias:** paridad garantizada editor/MCP; el agente es un colaborador más del doc Yjs; el
validador que corrige al humano corrige al agente. Se construye desde el primer momento.

---

## ADR-011 — Modelo de negocio: eventos B2B/Edu y claves

**Contexto:** el creador puede ser un profesor que quiere que sus alumnos jueguen gratis.

**Decisión:** el organizador paga ~1 €/jugador (tramos con descuento) y reparte **claves**;
los jugadores nunca ven un checkout. Coexiste con la venta individual B2C.

**Consecuencias:** mercado B2B/Edu claro; claves individuales/rotativas/grupo/batch con estados y
caducidades; panel del organizador con progreso en vivo.

**Decisiones asociadas:**

- **Sin plan premium de creadores** (descartado).
- **Sin reembolso**; saldo no consumido como crédito.
- **Confirmación de invitación opcional** por email (panel muestra "28/30 confirmados").
- **Sin descarga offline** (descartado): v1 web-only.
- **Venta B2C = una sola partida** (no acceso indefinido); se consume al crear la sesión (decisión
  literal, pendiente de cerrar el matiz de abandono).
- **Licencias entre creadores**: un organizador solo monta eventos sobre salas que posee; adquiere
  la copia por compra de licencia o regalo, con fork independiente.

---

## ADR-012 — Tramos de precio y tope de jugadores como datos editables

**Decisión:** los tramos de precio (`pricing_tiers`) y el tope de jugadores por sala
(`platform_settings.max_players_per_room`) dejan de ser constantes de código.

**Consecuencias:** cambiar precios no altera el histórico (filas con `active_from`/`active_until`);
el tope de jugadores alimenta a la vez el validador de creación de salas y el cap de publishers de
LiveKit — **una sola fuente de verdad**, nunca se desincronizan.

---

## ADR-013 — Moderación post-publicación con pre-check automático

**Decisión:** publicar es instantáneo; pre-check automático que solo bloquea casos claros;
moderación por reportes + muestreo; subida de assets custom con cola humana previa. Se añade
mecanismo de **apelación** (salvo casos críticos).

**Consecuencias:** preserva "de registro a sala publicada en <30 min" y protege el caso educativo.

---

## ADR-014 — Créditos IA como pool interno de plataforma

**Decisión:** la app vende créditos internos que la plataforma canjea en su cuenta global de
ElevenLabs, con margen. El subsistema de usuarios, organizaciones y ledger se copia de SLXD.

**Consecuencias:** control del margen, precio estable para el usuario, reutilización de código ya
desarrollado. Audio trazable por locale (`reference_id = {id}:{locale}`).
