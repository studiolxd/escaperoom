# Noche 2026-09-23 → 24 — decisiones y avances (coordinador)

Coordinador: Claude Code (no pica código; todo el código lo hacen agentes Orca en worktrees).
Revisar por la mañana. Cada decisión: qué, por qué, y si es reversible.

> ## ⚠️ Repo PÚBLICO temporalmente (desbloqueo de GitHub Actions)
> Desde ~11:30 los jobs de CI no arrancaban por facturación ("recent account payments have failed or your spending limit
> needs to be increased"). A petición del usuario, `studiolxd/escaperoom` se hizo **público** para usar los minutos gratis de
> Actions (antes se revisó el historial: sin `.env` ni claves con formato conocido). **Recordatorio:** volver a privado cuando
> se arregle la facturación: `gh repo edit studiolxd/escaperoom --visibility private --accept-visibility-change-consequences`.

## Decisiones tomadas (revisables)

- **D1 — Puertos fijos en tests (EADDRINUSE :2569):** se arregla YA como ticket de tooling
  independiente (`tooling/puertos-test`), no dentro de 2.12. Motivo: con varios worktrees en paralelo
  toda la noche, un CI/verify intermitente bloquearía los merges. Reversible: trivial.
- **D2 — 2.11 (LiveKit Cloud vs self-hosted):** NO se lanza. Necesita tráfico real con móviles,
  wifi doméstica y red corporativa; un agente no puede medirlo. Te queda a ti (no bloquea nada).
- **D3 — Orden:** oleada 1 = 2.7 pipes · tooling puertos · 3.2 Yjs backend (independientes).
  Oleada 2 = 2.8 → 2.9 → 2.10, y 2.12 tras 2.8 + tooling. Fase 3 avanza en paralelo donde no pisa
  runtime/fixture.
- **D4 — Merge:** el coordinador hace squash-merge de cada PR solo con CI `verify` en verde y tras
  revisar el diff por encima. Los conflictos los resuelve el agente del ticket (rebase), no el coordinador.

## Pendiente de ti (no bloquea)

- 2.11 prueba LiveKit en redes reales.

## Registro

- 01:40 Run `run_8bac028e0ca7`. Oleada 1 lanzada (agentes Claude en worktrees nuevos desde main 6a383ae):
  - 2.7 pipes → task_4a4eed0b4654 / ctx_6eaa47586e2a (rama fase-2/ticket-2.7-pipes)
  - tooling puertos → task_789553a793c2 / ctx_21a13fcbab20 (rama tooling/puertos-test-aleatorios)
  - 3.2 Yjs backend → task_2855f5cfc271 / ctx_9d92f92e006f (rama fase-3/ticket-3.2-yjs-backend)
- **D5 — Fase 3 antes de cerrar la 2:** el plan dice que la 3 depende de la 2 (runtime + validador);
  3.2 (persistencia Yjs + API de draft) no depende de ninguno de los dos, así que arranca ya para
  aprovechar la noche. 3.1/3.4+ esperan a que la fase 2 esté cerrada.
- 01:55 **3.2 integrado** → PR #37 squash `3a27879` (CI verde). Worker liberado, worktree limpio.
  - **Decisión del agente (a revisar, no bloquea):** permiso de edición = solo `room.authorId`; specs/14
    no tiene tabla de coeditores. Hay que decidir el modelo de coedición (¿tabla `roomCollaborator`?
    ¿organización?) antes de abrir la colaboración real a terceros. → **Te lo dejo a ti.**
  - El store Prisma del draft no tiene test contra Postgres (CI no levanta BD).
  - Se vio otro test intermitente: colyseus-server/chat-room. Pasado al agente de puertos (#36).
- 01:58 Oleada 1b lanzada: 3.3 colaboración → task_181d4542c1c5 / ctx_d2285438000b ·
  3.12 admin settings/pricing → task_264d198a93f9 / ctx_10ded9721560.
  - **D6:** 3.3 y 3.12 no dependen de runtime ni validador (igual criterio que D5). 3.3 sin UI (la UI es 3.1).
- 02:0x **D7 — #36 incluye también el arreglo del flake de chat-room** (no era puerto: waitForNextPatch cogía el patch del join; pasaba también en main). Mantenido: solo test.
- 02:2x **Tooling integrado** → PR #36 (puertos libres en tests colyseus-server + flake chat-room). Worker liberado.
- 02:3x **2.7 integrado** → PR #38 `f17665f`. Decisiones del agente (revisar):
  - El fixture trae `cellTypes` como **paleta** de 4 piezas, no tablero 5×5 → el servidor genera un
    tablero con camino garantizado por la compuerta y sin rodeos (roca interna). Formato sin tocar.
  - Compuerta abierta = cruce fijo no rotable; presentar la llave-oro no la consume.
  - Conexión a room-session/Colyseus y canal en Phaser → quedan para 2.8 (como 2.4–2.6).
- 02:3x Oleada 2: 2.8 Rey Aldric completo → task_bf16311dde62 / ctx_834cd1215a28 ·
  2.9 validador → task_36af5d9eefd4 / ctx_3f8a8d9b17a1.
  - **D8:** 2.8 y 2.9 en paralelo. 2.9 no toca el fixture; si 2.8 lo cambia, 2.9 rebasea y ajusta.
  - **D9:** 2.8 corrige también el bug de capas de catacumbas (ground 420 celdas vs 400) + test de capas.
- 03:0x **3.12 integrado** → PR #39 `5e892c8`. Decisiones del agente (revisar): `maxPlayersPerRoom` ∈ [1,8];
  PATCH de tramo = cerrar fila + crear sucesora (nunca reescribe); sin fechas retroactivas; el tramo
  que contiene el nº de jugadores fija el precio unitario de todos; sin audit log (no está en specs/14).
- Lanzado 3.6 grafo de reglas (React Flow) en packages/editor.
- 03:3x **3.3 integrado** → PR #40 `4a7b521`. Decisiones del agente (revisar): servidor de sync = proceso
  nuevo `pnpm dev:editor-sync` en packages/web (Next no admite upgrade WS); restaurar historial va por
  el WS (no REST) para que llegue a clientes conectados; sin auth por query string (solo cookie/cabeceras).
  - **Pendiente (no bloquea):** un `POST /update` de 3.2 con sesión WS viva no se notifica al proceso de
    sync (los conectados no lo ven hasta recargar). Habrá que decidir si REST de escritura se retira o se
    puentea al proceso de sync. **Te lo dejo a ti.**
  - **Para despliegue:** hay un proceso más que levantar (editor-sync) → afecta a infra/fase 6.
- Lanzado 3.10 multidioma del editor.
- 04:xx **3.10 integrado** → PR #42 `65ac705`. Decisiones del agente (revisar): retirar un idioma NO borra
  textos (se conservan en borrador y no se publican; borrar es acción aparte); no se puede retirar el idioma
  por defecto ni el último; filtro de catálogo por contención JSONB sobre `roomVersion.package` (sin columna
  `languages`, usa índice GIN existente, sin migración); forma provisional del doc Yjs para diálogos/pistas.
- Lanzado 3.11 audio (biblioteca + subida con moderación previa; IA fuera de alcance).
- 04:xx **2.9 integrado** → PR #41 `6f52209`. Decisiones del agente (revisar): puertas mandadas por `lockedBy`;
  objetos-puente se "gastan" en solitario (conservador); heurística de dígitos revelados → 🟡 si falla; ruta
  reportada = grupo más restrictivo (1 jugador: 16 pasos; 2–4 jugadores: 10 pasos); pesos de duración iniciales
  a recalibrar con playtest.
- **CI de main rojo 2 veces** (merges de 3.2 y 3.3): (1) flake chat-room → ya arreglado por #36;
  (2) `editor/test/sync.test.ts` restauración: `Length exceeded!` intermitente → **lanzado fix** con análisis de
  causa raíz (puede ser bug real de protocolo). **D10:** no se revierte 3.3; se arregla hacia delante.
- Lanzados: fix editor-sync (task_a527f1d842a3) y 2.10 solitario (task_5edfaeb13eca).
- 05:xx 3.6 PR #43 con CI verde pero en conflicto con 3.10 (mensajes i18n + index del editor) → reasignado al mismo agente para rebase (task_9d35bfa6c1f7). **D11:** los conflictos los resuelve el agente del ticket, nunca el coordinador.
- 05:xx **2.8 terminado** (PR #44, CI verde) pero en conflicto i18n con main → reasignado al mismo agente
  para rebase. Decisiones del agente a revisar:
  - `unlocks` abre puertas (objetos con `leadsTo`); el resto lo mueven reglas.
  - **Objetos-puente NO se consumen** (se presentan). **D12 (coordinador):** el motor manda; el validador
    (2.9 los "gastaba") se alinea en 2.10.
  - Escondite sin plantilla (`barril-espejo`): primera interacción entrega el contenido.
  - Placas por posición (±½ celda); split_clue por zona de mirilla.
  - **Protocolo pieza a pieza** para sliding/pipes (`{move}`, `{rotate}`) en vez de `{positions}`/`{rotations}`
    de specs/11 §5 → **hay que actualizar specs/11** (te lo dejo a ti: ¿se acepta la desviación?).
  - GameRoom carga solo `room-rey-aldric` del fixture hasta que haya catálogo con versiones.
  - Fuera: rate limiting por mensaje (specs/11 §9), reconexión con gracia (fase 6), cliente de red web (2.12).
  - Fixture: catacumbas/ground 420→400 y salon-trono/walls 260→280, con test de capas.
- 06:xx **2.8 integrado** → PR #44 (Rey Aldric completo: 3 salas, 8 plantillas en RoomSession + GameRoom, ruta crítica 14 pasos a victoria, solitario con puentes, canal Phaser). Avisados 2.10 y 3.6 para rebase.
- 06:xx **3.6 integrado** → PR #43 (grafo de reglas React Flow en packages/editor + demo dev en /[locale]/dev/rules-graph).
  Decisiones del agente (revisar): reglas en el doc como `Y.Map` por id; piezas sueltas = borradores locales
  (el formato no admite condición/acción sin regla); **posiciones de nodos no persistidas** (el formato no tiene
  dónde) → si quieres que se recuerde la maquetación habría que añadir metadatos de editor. Te lo dejo a ti.
- Lanzado 2.12 E2E de protocolo (2 clientes Colyseus, ruta crítica, assert victoria). **D13:** la protección de
  rama en GitHub ("bloquea el merge") NO la toca ningún agente; si hace falta, es un paso manual tuyo.
- 07:xx **Flaky de restauración arreglado** → PR #45 (causa: el test editaba en B antes de recibir el update de A;
  no era el protocolo; 41/100 fallos bajo carga → 100/100 verdes). Main estaba rojo por esto desde 3.3.
- Lanzados 3.1 (runtime modo edición + página /editor/[roomId] + doc Yjs ⇄ RoomPackage) y 3.9 (publicación).
  **D14:** 3.1 define la forma del doc Yjs para mapa/objetos (la de 3.10/3.6 era provisional); 3.9 usa una
  interfaz doc→RoomPackage que 3.1 implementa, para poder ir en paralelo.
- 07:xx **2.10 integrado** → PR #46 `444bdcc`. Validador alineado con el motor (puentes presentados, no gastados;
  el cáliz ya no es "doble uso"); nuevo error `solo_bridge_missing`. Actualizó la nota de diseño del Rey Aldric.
- Lanzado 3.7 validador en el editor (+ checks 🟡 que faltaban de specs/09 §5).
- 08:xx **3.11 integrado** → PR #47 (audio: biblioteca con placeholders + subida MP3 validada, moderación
  previa humana, migración `0011_audio_assets`, audio por idioma en el doc). Cambió specs/13 y specs/14 para
  reflejar las rutas y la tabla nueva. Pendiente para ti: **binarios definitivos de la biblioteca** y
  **proveedor real de moderación automática** + UI de la cola de moderación.
- Lanzado fix del flaky de lobby-room (3.º flake de tests de integración esta noche).
- 08:xx **2.12 integrado** → PR #48 (E2E de protocolo en `packages/colyseus-server/test/e2e.reyaldric.spec.ts`,
  ~6 s, 10/10 local; sin bugs de servidor). **FASE 2 CERRADA salvo 2.11 (tuyo).**
  - **Paso manual para ti:** marcar `verify` como *required status check* en la protección de rama de `main`
    para que el E2E bloquee merges (ningún agente toca la configuración de GitHub).
- Lanzado 4.1 servidor MCP (esqueleto del toolset + transportes stdio/HTTP; solo consulta real).
  **D15:** empiezo la fase 4 por su parte independiente del doc Yjs (el resto de 4.x espera a 3.1).
- 09:xx **3.7 integrado** → PR #50 (validación continua con debounce sobre el doc Yjs, panel, resaltado en el grafo,
  `POST /api/rooms/:roomId/validate`, 3 checks 🟡 nuevos). El Rey Aldric muestra ahora 🟡 "7 puzzles sin pista"
  (solo tiene pistas para los 2 candados) → **decide si quieres añadir `HintDef` al fixture** (no bloquea).
  Endpoint validate da 501 hasta que 3.1 conecte su serializador (pedido al agente de 3.1).
- 09:xx **4.1 integrado** → PR #51 (servidor MCP: toolset completo de specs/10 §2 registrado; `get_room`/`validate`
  reales; resto `NOT_IMPLEMENTED ticket 4.x`; stdio con README para Claude Desktop y HTTP en `/mcp/creator`;
  identidad por env en stdio / sesión en HTTP; OAuth en 4.7). Pendiente de 3.1: cablear `roomDocToPackage`.
- 10:xx **3.9 integrado** → PR #49 (publicación: versión inmutable en `roomVersion`, validate en servidor → 422 con informe,
  audios pendientes/rechazados bloquean, assets direccionados por contenido, `assetsHash` determinista, semver automático).
  Decisiones a revisar: `packageFormat` soportado = "1" (convive con `PACKAGE_FORMAT = "roompackage/v1"` en schemas: **decisión
  abierta que conviene cerrar**); historial de versiones público salvo sala `removed`. `/publish` responde 501 hasta que 3.1
  conecte el serializador (pedido).
- 10:xx **D16 — Fase 5 en paralelo** (el plan lo permite desde la fase 2). Lanzados 5.3 catálogo+reseñas+SEO y
  5.4 eventos+tramos. **Stripe (5.1) NO se lanza**: necesita claves/cuenta Connect y decisiones de negocio →
  **te lo dejo a ti**. 5.4 deja el pago detrás de un puerto `PaymentGateway` con fake.
- 11:xx **3.1 integrado** → PR #52 (modo edición: tiles en mapa disperso por celda para convergencia CRDT, RLE por filas,
  capas ground/walls/decor, ids propuestos `sprite-habitación`, renombrar solo si nadie lo referencia; página
  `/[locale]/editor/[roomId]`, demo sin BD `?demo=rey-aldric`). **Ya cableado:** validate, publish y MCP usan
  `roomDocToPackage` (adiós a los 501). Nota: el arrastre en navegador no se probó a mano (solo tests) → **pruébalo tú**.
- Lanzados 3.4 inspector (incluye renombrar con reescritura de referencias) y 4.2 toolset MCP de estructura/contenido.
- 11:xx **Flaky lobby-room arreglado** → PR #53 (el cliente recibe el patch de su propio onJoin; 2/1200 natural → 0/200).
  El agente anota que el **test de teletransporte de colyseus-server compara la misma referencia de PlayerState**
  (siempre pasa: test sin valor) → pendiente, no bloquea.
- Lanzado 3.8 playtest (room temporal desde el draft + link de prueba con caducidad).
- 12:xx **5.4 integrado** → PR #54 (eventos: `pricingSnapshot` congelado, autoventa del autor activable sin checkout,
  pago detrás de `PaymentGateway` → 501 hasta 5.1). Decisiones a revisar: estado de pago en `event.config` JSONB (sin
  migración); `saleEvents` no aplica al autor sobre su propia sala; grabación prohibida en eventos `educational`.
- Lanzado 5.5 claves.
- 13:xx **5.3 integrado** → PR #55 (catálogo SSR `/[locale]/rooms` y detalle con hreflang, JSON-LD Product+Game con rating,
  sitemap/robots; filtros combinables con cursor; reseñas con upsert). Decisiones a revisar: **reseñar exige compra
  `succeeded` o partida jugada, nunca el autor**; el filtro de lenguaje de 2.1 bloquea la reseña; el listado cambia a
  `{ items, nextCursor }`. Fuera: rate limiting de reseñas y cola de reportes.
- Lanzado 5.10 licencias entre creadores (fork a draft propio con linaje; pago por PaymentGateway fake).
- 14:xx **4.2 integrado** → PR #56 (9 tools de estructura/contenido + `get_template_catalog`, transacción Yjs por tool,
  errores accionables, `beforeCommit` para 4.4, `RoomDraftService.createDraft`, `EditorSyncServer.applyUpdate`).
  **Pendiente (no bloquea): sync en vivo ENTRE procesos** — lo que escriben la ruta MCP de Next y stdio se persiste, pero los
  editores conectados al proceso editor-sync solo lo ven al reconectar (mismo problema que el `POST /update` de 3.2).
  Solución probable: bus (Redis pub/sub) entre procesos → **decisión de infra tuya**.
- Lanzado 4.3 toolset MCP lógica/consulta.
- 15:xx **5.5 integrado** → PR #57 (claves individual/rotativa/grupo/batch, `seats`/`redeemedCount`, job de caducidad
  BullMQ en worker, migración `0012_access_keys`). Pendiente: quién escribe `group.completedAt` (servidor de partida).
- Lanzado 5.8 canje + agrupación (joinToken firmado, invitados sin cuenta, SESSION_FULL, GameRoom exige token en eventos).
- 15:xx **3.8 integrado** → PR #58 (playtest: `PlaytestRoom` extiende GameRoom, paquete congelado al crear, token HMAC con TTL 2h,
  invitados con link permitidos, botón "Jugar" en el editor; probado a mano en navegador). Pendientes que conviene conocer:
  **nueva variable `PLAYTEST_SECRET`** compartida web↔colyseus (en producción obligatoria; sin ella el playtest se desactiva);
  **registro de playtests en memoria** (no multi-proceso → Redis cuando escale); **no existe aún el cliente Phaser en red** para
  jugar salas publicadas contra `GameRoom` (la web sigue con playtest local en el cliente) → es trabajo gordo pendiente.
- **D17 — Hueco detectado: no existe el cliente de juego en red.** Ningún ticket del plan lo cubre explícitamente
  (2.8/2.12/3.8 lo dejaron fuera) y sin él no hay demo del hito 2. Lanzado como ticket propio
  `fase-2/cliente-red-gameroom`. **Revisa si quieres añadirlo al plan de fase 2** como 2.13.
- 16:xx **3.4 integrado** → PR #60 (inspector generado desde Zod, "reglas que lo tocan" enlazando al grafo, renombrado
  atómico que reescribe referencias; pestañas Mapa/Reglas). No probado a mano en navegador. Fuera: renombrar items/diálogos/estados.
- Lanzado 3.5 configuradores de plantillas (mismos componentes que en juego, en modo demo).
- 17:xx **4.3 integrado** → PR #61 (`add_rule`, `get_room_graph`, `get_puzzle`, `get_rules_for`). Lanzado 4.4 dry-run.
  **D18:** en 4.4, los errores ya existentes de un draft a medio construir no bloquean mutaciones que no los empeoran
  (solo se rechaza lo que introduce ❌ nuevos).
- 18:xx **5.8 integrado** → PR #62 (canje → joinToken JWT HS256 15 min, invitados `guest:<uuid>`, SESSION_FULL atómico,
  room `event` que exige token). **Nueva variable `JOIN_TOKEN_SECRET`** (web↔colyseus). Pendientes: **la room `event` aún
  no carga el paquete publicado del evento**, pantalla de canje del invitado, rate limiting del canje.
- Lanzado 5.6 emails + confirmación. **D19:** `@slxd/mailer` no está en este repo → el agente implementa el equivalente
  (Nodemailer SMTP por defecto, Resend opcional) en vez de copiarlo.
- 19:xx **3.5 integrado** → PR #63 (configuradores de las 8 plantillas con los paneles de juego reutilizados sin modificar,
  preview local, avisos del oráculo). **FASE 3 COMPLETA (3.1–3.12).** Nota: "sliding impar" no es expresable (la mezcla
  siempre corrige paridad); el caso irresoluble probado es `fixed_seed` sin seed.
- Lanzado 5.7 PDF de tarjetas.
- 20:xx **5.10 integrado** → PR #59 (licencias: `gift-copy` y `license-checkout` crean una sala nueva en draft del receptor con
  linaje `forkedFrom*`, sembrada con el paquete congelado; pago por `PaymentGateway` → 501 hasta 5.1). **Aviso importante para 5.1:**
  el CHECK `chkPurchasePaidNeedsStripe` exige referencia de Stripe incluso en compras `pending` → habrá que revisarlo al
  hacer Stripe. Fuera: UI y el PATCH del flag `licensable`.
- Main tuvo otro rojo intermitente: test de caducidad del playtest (3.8). Lanzado fix con análisis de causa raíz.
- 21:xx **4.4 integrado** → PR #64 (pipeline de mutación MCP: dry-run, validador incremental, `dryRun` en las 10 tools; los ❌ previos
  no bloquean; caché LRU por hash Yjs). Corrigió un fixture de test de 4.2 (referencia rota).
- Lanzado 4.5 (validate/preview/publish por MCP). **D20:** `publish` por MCP nunca publica directo: crea una solicitud que el
  humano confirma en la web, ligada al hash del paquete (si el draft cambia, se invalida).
- 22:xx **5.6 integrado** → PR #66 (mail propio Nodemailer/Resend, plantillas en 6 idiomas, cola BullMQ con 5 reintentos, confirmación
  con token HMAC, migración `0013_access_key_sent_at`). Fuera: rate limiting de confirm/resend, anonimización a 12 meses.
- Lanzado 5.11 (DPA: bloquea claves individuales con email e invitaciones por email hasta firmarlo).
- 22:xx **Flaky playtest arreglado** → PR #67: **era bug real** (el token del link redondeaba `exp` hacia abajo y caducaba hasta
  999 ms antes que el registro); una línea (`Math.ceil`) + test de regresión.
- Lanzado 4.7 OAuth + límites del MCP. **D21:** `@slxd/mcp-auth` no está en el repo → equivalente propio (OAuth 2.1 + PKCE
  sobre la sesión de Better Auth).
- 23:xx 5.7 terminado (PR #68, CI verde; pdf-lib + qrcode, URL firmada HMAC 24 h por la app en vez de presignada de R2) pero en conflicto con 5.6 en el worker → reasignado al mismo agente para rebase.
- 23:xx **Cliente de juego en red terminado** (PR #65, CI verde): `GameClient` red/local intercambiable, `/[locale]/play` (game y event con
  joinToken) y playtest en red con los 8 paneles, chat, LiveKit, reintento; probado a mano en 2 pestañas. Cambios de servidor
  justificados: chat y token de medios también en `GameRoom` (solo existían en `lobby_test`) y endpoint interno del paquete de
  playtest. En conflicto i18n con 5.6 → reasignado al mismo agente para rebase.
- 00:xx **Cliente de juego en red integrado** → PR #65. Con esto el hito 2 (demo con 4 jugadores, voz y webcam) es técnicamente jugable de extremo a extremo; falta probarlo a mano con 4 personas (**tú**).
- 00:xx **5.7 integrado** → PR #68 (tras rebase sobre 5.6). Lanzado 5.9 panel del organizador (progreso en vivo, ranking,
  observador sin soluciones, CSV). **D22:** 5.9 puede cargar el paquete publicado en la room `event` (hueco de 5.8) si lo necesita.
- 01:xx 5.11 terminado (PR #69, CI verde; migración 0014; DPA por organización activa del organizador porque el evento no modela organización — **revisar**; cambio de versión exige re-firma) pero en conflicto con 5.7 → reasignado para rebase.
- 02:xx **5.11 integrado** → PR #69 (DPA, migración 0014).
- **D23 — Arranco fase 6 por lo que no necesita decisiones tuyas:** 6.3 seguridad (rate limiting que varios tickets dejaron
  pendiente, CSP, auditoría admin, doc de rotación de secretos) y 6.11 particiones/purga de analítica. **No lanzo** 6.2 legal
  (textos legales), 6.4 observabilidad (elegir Sentry/Uptime Kuma, cuentas), 6.8/6.9/6.12 (contenido, beta, lanzamiento): son tuyos.
- 02:xx **4.5 integrado** → PR #70 (validate/preview/publish por MCP; confirmación humana con token HMAC sin estado ligado a
  autor + huella del paquete + versión, un solo uso). **Riesgo detectado y encargado a 4.7:** `/api/publish-confirm` debe aceptar
  solo cookie de navegador y rechazar el Bearer OAuth del MCP (si no, el agente se auto-confirmaría). Fuera: `preview` por stdio.
- Lanzado 4.6 chat del creador en web. **D24:** proveedor de modelo detrás de interfaz; implementación Anthropic (`claude-sonnet-5` por defecto, `ANTHROPIC_API_KEY`) + fake para tests. **Para usarlo de verdad necesitas poner la clave.**
- 03:xx **4.7 integrado** → PR #71 (OAuth 2.1 + PKCE, metadata RFC 8414/9728, registro dinámico, refresh con rotación, revocación,
  consentimiento en 6 idiomas; rate limit por token; tope 64 KB → `RESPONSE_TOO_LARGE`; **publish-confirm rechaza Bearer**
  con test). Fuera: panel para revocar autorizaciones, rate limit distribuido, detección de reutilización de refresh tokens.
- Lanzado 4.8 test de paridad (Rey Aldric construido solo por MCP ≡ fixture).
- 04:xx **6.11 integrado** → PR #72 (job mensual BullMQ: crea particiones del mes actual y siguiente, DETACH+DROP > 24 meses, advisory lock).
- Nuevo flaky en `shared/test/invitations.test.ts` (enlace manipulado, 5.6) → lanzado fix; también revisa joinToken/playtest/publish-confirm
  por si comparten el problema (p. ej. base64 no canónico).
- 05:xx 5.9 terminado (PR #73, CI verde: dashboard, ranking specs/21, observador solo lectura con PERMISSION_DENIED y sin soluciones,
  CSV) pero en conflicto i18n con 4.7 → reasignado para rebase. **Sigue sin hacerse:** la room `event` no carga
  `roomVersion.package` y `progressEvent` no se persiste (sin replay) → ticket propio en cuanto entre 5.9.
- 06:xx **4.6 integrado** → PR #74 (chat del creador `/[locale]/creator/chat`, streaming NDJSON, bucle modelo↔tools contra el MCP real
  por HTTP con la sesión del creador; proveedor Anthropic `claude-sonnet-5` + fake). Pendiente: conversaciones solo en memoria del
  proceso, enlace desde el editor, cobro por créditos (4.9). **Necesita `ANTHROPIC_API_KEY` para usarse de verdad.**
- 06:xx **4.8 integrado** → PR #75 (Rey Aldric construido solo por MCP ≡ fixture; solvable 1–4 jugadores; ruta de 16 pasos idéntica).
  Sin bugs en las tools. **Hueco destapado:** ni editor ni MCP pueden escribir `decorations`/`lighting` → lanzado ticket de paridad.
  **FASE 4: 4.1–4.8 hechos; queda 4.9 (créditos IA + ElevenLabs) → te lo dejo a ti** (ledger de créditos de SLXD que no está
  en el repo, cuenta de ElevenLabs y precios de créditos son decisiones tuyas).
- 07:xx **Flaky de tokens arreglado** → PR #76 (era el test: sustituía el 1.er carácter por 'x' y 1/64 veces ya lo era; 11/500 → 0/500). Revisados todos los tokens firmados: comparación en tiempo constante y rechazo de base64 no canónico, producción sin cambios.
- 07:xx **5.9 integrado** → PR #73 (tras 2 rebases). Lanzado "eventos de extremo a extremo": room `event` carga el paquete publicado
  del evento, `progressEvent` persistido, `group.completedAt` escrito al terminar (dispara caducidad `on_group_complete`).
- 08:xx 6.3 terminado (PR #77, CI verde: rate limit Redis en kit, 429+Retry-After en redeem/reseñas/invitaciones, límite por mensaje
  en GameRoom, CSP con nonce, auditoría de /api/admin/*, docs `seguridad.md` y `rotacion-de-secretos.md`). Decisiones a revisar:
  **el layout `[locale]` pasa a render dinámico** (necesario para el nonce de CSP → afecta a caché/rendimiento del catálogo SSR);
  el E2E de 2.12 desactiva el límite de mensajes; el canje cuenta solo fallos 4xx por IP (clases detrás de NAT). En conflicto con
  5.9 en `game-room.ts` → reasignado para rebase conservando observador + límite.
- 09:xx **6.3 integrado** → PR #77 (tras rebase: el observador recibe PERMISSION_DENIED antes del limitador y no consume cuota).
- Lanzados 6.1 moderación (reportes, cola con SLA, despublicación automática por reporte crítico, strikes, apelaciones) y 6.5 suite E2E Playwright (juego, evento, editor; compra saltada hasta 5.1; carga de 10 sesiones).
- 10:xx **Paridad decoración/iluminación integrada** → PR #78 (comandos puros + herramientas Decorar/Antorcha y panel de habitación en el editor + tool MCP `decorate_subroom` con dry-run; la paridad ya compara decorations/lighting byte a byte). Mejora futura: arrastrar decoraciones en el lienzo.
- 11:xx **Eventos de extremo a extremo integrados** → PR #79 (room `event` juega el paquete publicado del evento, hitos persistidos en `progressEvent`, `group.completedAt` + caducidad `on_group_complete`, panel sobrevive a reinicios; migración 0015). Fuera: replay/restaurar partidas tras reinicio, analítica de gameplay desde la room.
- 12:xx 6.1 terminado (PR #80: reportes sala/reseña/usuario, crítico despublica y congela, cola con SLA, strikes aviso→suspensión 14 d→ban, apelaciones, pre-check local, muestreo diario, UI /[locale]/admin/moderation, migración 0016) — **sin merge por el bloqueo de facturación de GitHub**.
- 13:xx **6.5 terminado** (PR #81, sin CI por facturación): `packages/e2e` con Playwright (juego Rey Aldric completo por clics, flujo
  de evento, editor+publicación; compra saltada hasta 5.1), carga 10 sesiones 10/10, job `e2e-smoke` en CI + `e2e-nightly.yml`.
  **Destapó y arregló 5 bugs de producción:** paleta de mirillas incompleta, receta de 1 ingrediente imposible por UI, Phaser
  tomaba el mouseup sobre HTML como clic, el HUD tapaba objetos, y `/redeem` daba 404 (página nueva). Pendiente: `gh run rerun 35828463486` + merge.

## Resumen final de la noche

**Integrado en main (en orden):** tooling puertos (#36), 3.2 (#37), 2.7 (#38), 3.12 (#39), 3.3 (#40), 2.9 (#41), 3.10 (#42), 3.6 (#43),
2.8 (#44), fix sync (#45), 2.10 (#46), 3.11 (#47), 2.12 (#48), 3.9 (#49), 3.7 (#50), 4.1 (#51), 3.1 (#52), fix lobby (#53), 5.4 (#54),
5.3 (#55), 4.2 (#56), 5.5 (#57), 3.8 (#58), 5.10 (#59), 3.4 (#60), 4.3 (#61), 5.8 (#62), 3.5 (#63), 4.4 (#64), cliente de red 2.13 (#65),
5.6 (#66), fix playtest (#67), 5.7 (#68), 5.11 (#69), 4.5 (#70), 4.7 (#71), 6.11 (#72), 5.9 (#73), 4.6 (#74), 4.8 (#75), fix tokens (#76),
6.3 (#77), paridad decoración (#78), eventos e2e 5.12 (#79), 6.1 (#80), 6.5 (#81).
**#80 y #81** se integraron tras hacer el repo público (CI desbloqueado); #81 se re-probó en CI tras actualizar su rama con #80.
**Estado por fase:** F2 completa salvo 2.11 (tuyo). F3 completa. F4 completa salvo 4.9 (tuyo). F5 completa salvo 5.1/5.2 Stripe (tuyo).
F6: hechos 6.1, 6.3, 6.5, 6.11; tuyos 6.2, 6.4, 6.6–6.10, 6.12.
