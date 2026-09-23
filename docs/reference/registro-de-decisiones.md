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

**Revisión (2026-09-22) — se mantiene el isométrico, con dos guardas.** Se reconsideraron
**top-down/2.5D** y **3D** (cámara fija y primera persona) por coste de arte y autoría:

- **Se mantiene isométrico** por una razón de género: en top-down puro solo es visible la cara
  interior de la **pared norte** (una pared útil para murales/pistas), mientras que el isométrico
  muestra **dos** caras de pared. Y la oclusión —su principal contra— queda acotada porque cada
  habitación es un **diorama pequeño**, no un mundo abierto.
- **Guarda 1 — sin elevaciones/multinivel en v1:** rejilla plana + paredes en dos lados. Así la
  autoría (editor y MCP) es tan simple como un top-down; solo cambia la proyección.
- **Guarda 2 — política de oclusión:** desvanecer (hacer semi-transparentes) paredes/objetos que
  quedan por delante de un avatar.
- **Producción de arte:** puede hacerse como **sprites isométricos pre-renderizados desde 3D**
  (3D para producir, 2D para jugar), lo que da acabado 3D sin runtime 3D ni romper el UGC/MCP.
- **Descartado 3D en runtime:** multiplica coste (modelos × animaciones × LODs), exige motor 3D y
  rompe el editor por tiles y la generación por IA. **Descartado top-down** por perder la segunda
  pared. **Descartado *stills* estilo *Myst*** (imágenes pre-renderizadas + hotspots) como núcleo:
  gran acabado pero mata el UGC/IA y debilita el co-op; solo valdría para salas oficiales premium.

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

## ADR-010 — MCP del creador: los mismos servicios que el editor (revisado 2026-09-22)

**Contexto original:** el MCP se diseñó como cliente fino de la API REST, para garantizar la paridad
editor↔MCP. Al copiar el patrón de SLXD (ADR-022) se comprobó que compartir **contrato** es más débil
que compartir **lógica**.

**Decisión (revisada):** el MCP no tiene vía paralela ni contrato paralelo: sus tools **no
reimplementan lógica**. Igual que el router tRPC del editor y las rutas REST públicas, llaman a la
**misma capa de servicios de dominio** (`packages/shared/services`), con un
`actor {organizationId, userId, role}` como única diferencia — el patrón verificado en SLXD
(`specs/04` § "Mutar por MCP"). Las tools que mutan llevan `destructiveHint` y pasan por el gate de
confirmación; el agente sigue siendo un colaborador más del doc Yjs.

**Consecuencias:** la paridad editor↔MCP es literal (mismo código, no solo mismo contrato); no hay dos
superficies que sincronizar; se reutilizan `@slxd/mcp-server` y `@slxd/mcp-auth`. El transporte es
HTTP en `/mcp/creator` con OAuth 2.1, con variante stdio para Claude Desktop.

**Alternativa descartada (la anterior):** MCP como cliente fino de la API REST. Da un contrato público
único, pero obliga a que la REST exponga todo lo del editor, añade saltos HTTP y comparte contrato en
vez de lógica.

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

**Decisión:** los tramos de precio (`pricingTier`) y el tope de jugadores por sala
(`platformSetting.maxPlayersPerRoom`) dejan de ser constantes de código.

**Consecuencias:** cambiar precios no altera el histórico (filas con `activeFrom`/`activeUntil`);
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

---

## ADR-015 — ORM y migraciones: Prisma

**Contexto:** el plan original fijaba **Drizzle** sin ADR que lo justificara. Al decidir reutilizar el
subsistema de identidad, organizaciones y ledger de SLXD (ADR-014), y dado que `@slxd/kit` y el
contrato de derechos asumen Prisma, mantener Drizzle obligaba a reescribir ese port. `specs/14` exige
además "cero deriva de tipos" entre API, Colyseus y MCP.

**Decisión:** **Prisma** con `prisma migrate` en `packages/shared/prisma`, sobre una base de datos única
con varias tablas. Los tipos de Prisma Client se comparten entre web, editor, Colyseus y MCP.

**Consecuencias:** el port de identidad/ledger no se reescribe (Prisma→Prisma); tipos generados
consumibles por todos los procesos; PgBouncer operado con sentencias preparadas, como en SLXD.

**Alternativas descartadas:** Drizzle (SQL-like, ligero, cómodo con JSONB y con Zod, pero obligaba a
reescribir el port y a desalinearse del andamiaje de SLXD).

---

## ADR-016 — Autenticación: Better Auth con modelo canónico

**Contexto:** el plan pedía email mágico + Google, organizaciones con miembros y roles, y sesión por
cookie para web + Bearer para el MCP. *Corrección (2026-09-22):* el argumento original de "alinear
con SLXD" no se sostiene — **SLXD dejó de usar Better Auth** (usa su propio `account` como IdP; las
`BETTER_AUTH_*` que quedan son restos). La decisión se mantiene por **su plugin de organización**
(orgs, miembros, roles, invitaciones), que es justo lo que pide `specs/14` §3.

**Decisión:** **Better Auth** con su plugin de organización, adoptando su **modelo canónico** sin
mapeo: tablas `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`,
con **nomenclatura camelCase en todo el esquema** (ADR-017 y `specs/14` se actualizan en
consecuencia). Sesión por cookie httpOnly para el frontend y Bearer para el MCP y clientes externos;
rutas bajo `/api/auth/*`. La tabla de sesiones de partida pasa a `gameSession` para no chocar con la
`session` de auth.

**Consecuencias:** `organization`, `member`, roles e invitaciones salen del plugin sin glue; la
`password_hash` de `user` desaparece (Better Auth guarda la credencial en `account.password`);
`oauth_identities` lo sustituye `account`. Se sustituye el default previo (Auth.js/NextAuth).

**Alternativas descartadas:** Auth.js/NextAuth (maduro y con más proveedores, pero sin modelo de
organizaciones). Conservar nuestros nombres snake_case con mapeo (menos churn, pero deja dos
convenciones mezcladas y no enchufa plugins sin config).

---

## ADR-017 — Reutilización del andamiaje de SLXD

**Contexto:** SLXD es un monorepo maduro con el mismo stack base (TypeScript, Next.js, PostgreSQL,
Redis, Prisma, Better Auth, Docker). El proyecto comparte ese terreno pero **no** el modelo de suite
multi-producto.

**Decisión:** reutilizar de SLXD **copiando y adaptando** (el original es de solo lectura, jamás se
edita): tooling (`@slxd/config`, `@slxd/env`, `scripts/verify.sh`, `scripts/dev-env.sh`, `turbo.json`),
infra local (compose de Postgres/Redis/MinIO, podando y añadiendo LiveKit/coturn),
infraestructura de backend (`@slxd/kit`, `@slxd/mailer`, `@slxd/roles`) y el eje MCP/IA
(`@slxd/mcp-server`, `@slxd/mcp-auth`, `@slxd/ai-chat`).

**No** se reutiliza: plano de control `account` / Keycloak / claims multi-tenant, DS
`@studiolxd/brand`, `catalog`/`plans` de suite, textos en seis idiomas, ni Prisma-por-app con
`prisma-platform-sync`. El código adaptado usa **namespace propio** (sin `slxd` en identificadores).

**Consecuencias:** gran ahorro en Fase 0 (monorepo, infra, env, verificación) y en Fase 4 (MCP, OAuth
del agente, chat con créditos). El mapeo fichero a fichero y la lista de poda viven en
`reference/reutilizacion-slxd.md`.

**Alternativas descartadas:** reutilización total tipo fork (arrastra multi-tenant, Keycloak y el DS
ajeno); reutilización mínima (solo identidad y ledger), que encarece los tickets 0.1 y 4.x.

---

## ADR-018 — i18n: next-intl

**Contexto:** el `RoomPackage` es multiidioma desde el diseño (`specs/08` §2.2) y SLXD ya usa
**next-intl** con el set `en, es, fr, de, nl, pt`.

**Decisión:** **next-intl** con el mismo set de locales que SLXD y **`es` por defecto**. Los textos
de plataforma siguen el patrón de catálogo de SLXD (`messages`), pero **solo `es` es obligatorio al
principio**; los demás locales se abren a medida, sin la regla de SLXD de "los seis completos o no
hay merge".

**Consecuencias:** se reutilizan routing y patrones de SLXD; los códigos de locale coinciden con las
claves de `LocalizedText` y con el `reference_id = {id}:{locale}` del audio IA.

**Convención (2026-09-22):** **toda UI nueva usa next-intl** (nada de strings hardcodeados). El demo
`/lobby` de 0.5 conserva strings en español a propósito: es temporal y se sustituye por el lobby real
(`specs/19`).

**Alternativas descartadas:** react-i18next/FormatJS (más configuración); i18n casero.

---

## ADR-019 — UI y estilos: Tailwind CSS + shadcn/ui

**Contexto:** SLXD usa el DS propio `@studiolxd/brand` (BEM + tokens) atado a su suite. El proyecto
necesita su propia capa visual, con puzzles de panel en React y un editor WYSIWYG.

**Decisión:** **Tailwind CSS + shadcn/ui** (componentes copiados al repo, accesibles, con Radix por
debajo). Catálogo, HUD, puzzles de panel y editor construyen sobre estos primitivos.

**Consecuencias:** control total del código de UI, sin DS externo opaco; los mismos primitivos se
comparten entre editar, previsualizar y jugar (`specs/03` §3). Se descarta `@studiolxd/brand`.

**Convención (2026-09-22):** los `Button` de shadcn que lleven icono usan la prop `data-icon`
(p. ej. `data-icon="inline-start"`), y todo icono sobre **overlay oscuro** (HUD, paneles) debe tener
contraste suficiente en reposo, no solo en `:hover`. Nace del pulido del demo de 0.4 (el botón de
bajar la llama quedaba invisible hasta el hover). Aplica a HUD, paneles de puzzle y editor.

**Alternativas descartadas:** copiar el DS de SLXD (arrastra tokens y BEM de suite); MUI/Chakra.

---

## ADR-020 — Email: Nodemailer por defecto, Resend opcional

**Contexto:** `@slxd/mailer` ya abstrae un transporte con dos proveedores (SMTP y Resend).

**Decisión:** reutilizar y adaptar ese patrón: **Nodemailer (SMTP) por defecto**, con **Resend**
configurable por entorno si se quiere. Se descarta Postmark.

**Consecuencias:** en local sirve cualquier SMTP (Mailpit/MailHog); en producción se elige proveedor
por configuración, sin tocar código.

**Alternativas descartadas:** Resend-first (menos control/self-hosting); Postmark.

---

## ADR-021 — Tests: Vitest + Playwright

**Contexto:** `specs/22` ya describe la pirámide y menciona Vitest, pero el runner no estaba fijado
en el stack. SLXD trae presets de Vitest en `@slxd/config`.

**Decisión:** **Vitest** para unitario e integración (preset reutilizado de SLXD) y **Playwright**
para E2E. Se declara explícitamente en el stack.

**Consecuencias:** un solo runner en todo el workspace, rápido y con los helpers ya probados en SLXD.

**Alternativas descartadas:** Jest (más lento y más configuración); `node:test` (menos ecosistema).

---

## ADR-022 — Capas de API: servicios de dominio + tRPC (UI) + REST público

**Contexto:** tras revisar cómo hace SLXD su API y su MCP (`specs/01`, `specs/04`): **tRPC** para las
pantallas, **REST `/api/v1`** para terceros y webhooks, `/internal/*` para server-to-server, y una
**capa de servicios de dominio** que es la única con lógica; las tres puertas la llaman.

**Decisión:** adoptar ese patrón en este proyecto:

- `packages/shared/services` — **única lógica de dominio** (salas, objetos, puzzles, reglas, eventos,
  créditos…), siempre con un `actor` explícito.
- **tRPC (v11)** para la UI de web y editor (infraestructura tRPC de `@slxd/kit`).
- **REST** para lo público/anónimo, terceros y webhooks (API pública bajo `/api/*`, catálogo anónimo,
  `/api/webhooks/stripe`).
- **MCP** sobre los mismos servicios (`@slxd/mcp-server` / `mcp-auth`), en `/mcp/creator`.
- **Colyseus** consume también los servicios/reglas de dominio.

**Consecuencias:** una sola verdad lógica; los webhooks se emiten desde el servicio y no desde la
ruta; la API pública es una puerta más, no el centro. `specs/13` pasa a describir la superficie REST.

**Alternativas descartadas:** REST único como contrato de todo (pierde ergonomía tipada en la UI y
obliga a exponer de más); tRPC para todo (no sirve a terceros, webhooks ni MCP).

---

## ADR-023 — Chat en partida: censura + flag, no descarte

**Contexto:** `specs/11` §4.4 y `specs/17` §3 exigen un filtro de lenguaje en el chat en vivo, pero
no fijan qué hacer con un mensaje que contiene un término prohibido (descartarlo, censurarlo o
bloquear el envío).

**Decisión:** el servidor **censura** el término (lo sustituye por `*`) y difunde el mensaje con
`filtered: true`; nunca reenvía el texto original. El filtro es una lista de términos con variantes
simples (acentos, mayúsculas, leetspeak y separadores entre letras), y antes de censurar desinfecta
HTML y caracteres de control. El rate limit (2 msg/s, `specs/11` §9) se evalúa antes del schema y
del filtro, con una ventana móvil de los últimos 50 mensajes como historial.

**Consecuencias:** el grupo ve que hubo un mensaje filtrado (transparencia y pedagogía) sin exponer
el término; el original no viaja por el WebSocket. Un filtro básico no sustituye al clasificador de
toxicidad de `specs/17` §3, que se integrará más adelante. No es moderación retroactiva: el chat no
se persiste ni pasa por cola humana (`specs/17` §8).

**Alternativas descartadas:** descartar el mensaje completo (el usuario no entiende por qué y se
pierde contexto no tóxico); bloquear el envío con error (misma fricción y peor UX).

---

## ADR-024 — Generación de audio por IA (ticket 4.9): tarifa, síntesis y alcance del MCP

**Contexto:** `specs/15` §2 fija la fórmula de coste («nº de caracteres × tarifa ElevenLabs →
créditos internos, redondeo a la unidad, mínimo 1 crédito, margen ≥ 50 %») pero deja abierta la
tarifa exacta: ni `specs/02` ni `specs/15` fijan cuántos caracteres vale un crédito, y el precio en
euros de un crédito depende de los packs de compra (tickets 5.1/5.2), aún sin implementar.
`specs/10` (MCP del creador) tampoco prevé una tool de generación de audio; `specs/15` §3 describe
la integración como un botón en el editor («texto → previsualización → confirmar»).

**Decisiones:**

1. **Tarifa provisional: 1 crédito = 40 caracteres** (redondeo hacia arriba, mínimo 1 crédito por
   generación), en `CHARACTERS_PER_CREDIT` (`packages/shared/src/services/audio-generation.ts`).
   Es una cifra de trabajo para poder implementar y testear el servicio; **hay que revisarla contra
   el contrato real con ElevenLabs y el precio en euros de un crédito cuando 5.1/5.2 fijen los
   packs de compra**, para garantizar el margen ≥ 50 % que pide la spec.
2. **Cuenta que se cobra:** si el actor tiene una organización activa, se cobra a la cuenta de esa
   organización; si no, a su cuenta personal. No hay lógica adicional de reparto (no hace falta:
   una única cuenta por organización, migración 0004).
3. **Síntesis y confirmación son síncronas** (mismo patrón que la subida manual de audio, 3.11):
   no se encola en BullMQ/worker. La llamada a ElevenLabs (unos segundos) ocurre dentro de la
   petición HTTP de `/api/audio/generate/preview` y `/api/audio/generate/confirm`. No hace falta
   cola: no hay generación en lote ni fan-out, y la UX pedida (previsualizar antes de confirmar) ya
   es una interacción síncrona en el editor.
4. **El audio generado reutiliza la tabla `audioAsset`** (migración 0011) con una columna `source`
   nueva (`'upload' | 'ai_generated'`, migración 0017) en vez de una tabla o un espacio de
   referencias (`ref`) aparte: así reutiliza sin cambios el MISMO pipeline de moderación de 3.11
   (nace `pending`, cola humana, bloquea publicación hasta aprobarse) y la MISMA resolución de
   referencias del editor (`upload:<id>`) — la publicación, el editor y el MCP no distinguen el
   origen del audio.
5. **Sin tool MCP nueva en esta iteración.** `specs/10` no la pide y `specs/15` describe la
   generación como una interacción de editor (previsualizar antes de cobrar), que no encaja bien en
   una tool MCP de una sola llamada sin exponer también el paso de previsualización al agente.
   Queda para una iteración futura si el creador necesita pedirlo desde el chat.

**Consecuencias:** el coste en créditos de una generación cambiará cuando se revise el punto 1 (es
un cambio de constante, no de arquitectura). El endpoint de generación bloquea la petición HTTP
mientras dura la síntesis (unos segundos); si en el futuro se generan lotes de audio (p. ej. localizar
una sala entera a la vez) sí hará falta una cola, como el resto de trabajos largos del repo.

**Alternativas descartadas:** cola BullMQ desde ya (sobreingeniería para una interacción de un solo
audio con previsualización síncrona); tabla `audioAssetGeneration` separada (duplica moderación,
referencias y publicación sin necesidad); tool MCP de generación de una sola llamada (no puede
ofrecer la previsualización sin cobrar que pide la spec).

---

## ADR-025 — Objetos-puente: se consumen al usarse (revierte ADR de 2.8/2.10)

**Contexto:** en 2.8/2.10 se decidió que el objeto-puente de una mecánica cooperativa en modo
solitario (el cáliz sobre una placa de `simultaneous_plates`, el espejo en una mirilla de
`split_clue`) **no se consumía**: quedaba en el inventario y podía reutilizarse. Se revisó esa
decisión: en un escape room un objeto normalmente se usa una sola vez, y "se presenta sin gastarse"
rompía esa expectativa para cualquiera que probara el modo solitario.

**Decisión:** el puente **se consume** (se retira del inventario) al fijarse en la placa/mirilla,
tanto en el motor (`RoomSession.useItemOnObject` → `consumeInventoryItem`) como en el validador
(`oracles.ts` mueve el ítem a `itemsConsumed`, no a un `itemsUsed` sin gastar — ese campo se ha
eliminado de `StepEffects`/`RouteStep` por quedar sin uso). Como el inventario no admite copias
duplicadas del mismo ítem (`grantItem`/`addItem` son idempotentes), un objeto-puente consumible solo
puede cubrir **una** placa que falte por jugador ausente; si `plates.length - playerCount > 1`, el
validador lo marca como irresoluble en solitario aunque el ítem exista (`oracles.ts`,
`simultaneous_plates`).

El Rey Aldric reutilizaba el mismo cáliz para dos interacciones (puente de `p-placas-estatuas` +
ranura del mural en `bodega`), con la regla `r-recoger-caliz` devolviéndolo tras las placas para
evitar un soft-lock — un patrón que solo funcionaba porque el puente no se gastaba. Consumirlo a la
primera interacción habría dejado la ruta en solitario irresoluble. Se evaluaron dos soluciones:

1. **Dos objetos distintos** (elegida): `p-candado-arca` ahora otorga también `busto-piedra`
   (temáticamente coherente con "placas de las estatuas"), que pasa a ser el `soloBridgeItemId` de
   `p-placas-estatuas`. `caliz-real` sigue yendo a la ranura del mural, sin cambios. Es la solución
   más simple y explícita: cada puzzle tiene su propio objeto, sin lógica adicional de recuperación
   ni orden de pasos que razonar.
2. **Gastar solo en el último uso** (descartada): habría exigido que el motor supiera cuántos usos
   le quedan a un ítem multiuso antes de consumirlo, y que el validador modelara esa cuenta — mucha
   más complejidad de diseño y de implementación para un caso (un mismo objeto con dos destinos
   distintos) que ya era, por sí mismo, una señal de diseño confusa (el validador histórico ya lo
   marcaba con 🟡 como "doble uso potencialmente conflictivo").

`r-recoger-caliz` se mantiene (permite volver a sacar el cáliz de la ranura por lore) pero deja de
ser necesaria para la resolubilidad.

**Consecuencias:** los objetos-puente se comportan como cualquier otro objeto de un solo uso, más
predecible para creadores y jugadores. Un puzzle cooperativo con más de 1 plaza sin cubrir en
solitario ya no se puede resolver con un solo objeto-puente: hace falta subir `players.min` o
rediseñar el puzzle (p. ej. varias placas con distinto `soloBridgeItemId` no es posible hoy — el
esquema solo admite uno por puzzle). `docs/reference/roompackage-rey-aldric.v1.json` gana el ítem
`busto-piedra`; `docs/reference/rey-aldric-notas-diseno.md` documenta el cambio.

**Alternativas descartadas:** ver arriba (gastar solo en el último uso); mantener el comportamiento
de 2.8/2.10 (rechazada por no reflejar cómo se comporta un escape room real).

---

## ADR-026 — `sliding_puzzle` y `pipes`: `attempt` pieza a pieza, no estado final

**Contexto:** `specs/11` §5 describía originalmente el `attempt` de `sliding_puzzle` como
`{positions}` (array con la disposición completa de todas las fichas) y el de `pipes` como
`{rotations}` (todas las rotaciones a la vez) — es decir, el cliente resuelve el puzzle localmente y
manda el estado final ya resuelto. El ticket 2.8 (`packages/shared/src/templates/sliding-puzzle.ts`,
`pipes.ts`, y su despacho en `packages/shared/src/session/room-session.ts` /
`packages/colyseus-server/src/rooms/game-room.ts`) se implementó distinto: cada clic manda una sola
acción y el servidor lleva el tablero.

**Decisión:** el `attempt` de `sliding_puzzle` es `{move: <índice de celda>}` (desliza la ficha
adyacente al hueco) y el de `pipes` es `{rotate: <índice de celda>, turns?}` o `{gate: <índice de
celda>}` (gira una tubería 90° o presenta un objeto en una compuerta). El servidor valida y aplica
cada acción contra el tablero autoritativo y devuelve el desenlace (`moved`, `rotated`, `opened`,
`solved`, etc.); nunca confía en un tablero final calculado por el cliente. Se documenta como la
verdad vigente en `specs/11` §5.1; no se cambia código, solo se corrige la spec para que refleje la
implementación real.

**Consecuencias:** dos jugadores con el mismo panel de `sliding_puzzle` o `pipes` abierto a la vez se
ven mover las piezas el uno al otro en tiempo real, porque cada movimiento se sincroniza y anima en
cuanto el servidor lo confirma — central en un escape room cooperativo. El servidor revalida cada
paso (más mensajes, pero cada uno trivial de validar) en vez de una sola validación cara del estado
final.

**Alternativas descartadas:** mandar el estado final completo tal como decía la spec original
(peor UX cooperativa: un jugador no ve moverse las piezas del otro hasta que termina, o nunca, si
resuelve de un tirón sin re-render intermedio; y obliga a validar una permutación completa en vez de
un movimiento).

---

## ADR-027 — Catálogo público: cache de la consulta en Redis, no del HTML (ticket 6.4)

**Contexto:** la CSP con nonce por petición (ticket 6.3, ADR sin número dedicado — `specs/13` §11)
obliga a renderizar dinámico TODO el segmento `[locale]` (`connection()` en su layout), incluida
`/[locale]/rooms`, el catálogo público SSR con JSON-LD para SEO (ticket 5.3). Antes de la CSP esa
ruta era candidata a cachearse/prerenderizarse; con nonce por petición, el HTML ya no se puede
cachear sin romper la CSP.

**Decisión:** no tocar la CSP (el nonce y `'strict-dynamic'` de `script-src` no son negociables) y en
su lugar cachear la CONSULTA cara a Postgres del listado del catálogo en Redis
(`createCachedPublishedRoomListing`), reutilizando la MISMA conexión/patrón de
`@escaperoom/kit/redis` que ya usan rate limiting y colas (ticket 6.3) — sin integración de Redis
nueva. TTL de 60 s (el mismo presupuesto de frescura que el `Cache-Control` de `GET /api/rooms`),
clave por `filter`/`page` normalizados, y falla abierto ante cualquier error de Redis.

**Consecuencias:** el render sigue siendo dinámico y el navegador recibe HTML fresco en cada
petición (nonce válido siempre), pero la consulta SQL más cara (CTE con joins y filtro JSONB) no se
repite mientras el cache esté caliente. Medición local aproximada: ~7 ms la consulta a Postgres en
caliente vs. ~1–1.5 ms un `GET` a Redis; el ahorro relativo crece con el tamaño del catálogo. Sin
`REDIS_URL` (dev sin Redis) el comportamiento es idéntico al de antes (sin cache).

**Alternativas descartadas:**

- **Partial Prerendering (PPR) de Next** (shell estático + huecos dinámicos con `Suspense` solo
  donde hace falta el nonce): en Next 16.3.5 sigue siendo experimental, no estable para producción.
  Además el nonce hoy viaja al `<html>` raíz vía cabeceras de la petición en `proxy.ts` — un
  mecanismo pensado para 100% dinámico — y adoptar PPR exigiría rediseñar esa propagación con riesgo
  de debilitar la CSP (un nonce mal cacheado la rompe) para un beneficio que el cache de consulta ya
  cubre sin tocar la CSP. Queda como opción a revisar cuando PPR/Cache Components sea estable.
- **Cachear la respuesta HTTP completa** (CDN o `Cache-Control` en la página): requeriría un nonce
  fijo o `'unsafe-inline'`, prohibido por la restricción de seguridad del ticket.
- **Sin cache** (aceptar la consulta a Postgres en cada petición): descartado porque el catálogo es
  la puerta de entrada pública y de SEO; el coste crece con el número de salas y de filtros
  combinados sin necesidad, cuando Redis ya está disponible y en uso para lo mismo (rate limit).