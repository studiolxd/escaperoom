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
degrada; Daily/Twilio (pricing por minuto, menos control); LiveKit Cloud (plan B, probado y
descartado, ver actualización 2026-09-25).

**Actualización 2026-09-25:** el plan B (LiveKit Cloud) queda descartado; el servicio opera solo
en self-hosted. Deja de figurar como proveedor/subencargado en la política de privacidad y el DPA
(`packages/web/src/content/legal/`), y desaparece el caso especial de CSP para `*.livekit.cloud`
en `packages/web/src/lib/security-headers.ts`.

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

## ADR-013 — Moderación post-publicación con pre-check automático (revisado 2026-09-25)

**Decisión:** publicar es instantáneo; pre-check automático que solo bloquea casos claros;
moderación por reportes + muestreo; subida de assets custom con cola humana previa. Se añade
mecanismo de **apelación** (salvo casos críticos).

**Consecuencias:** preserva "de registro a sala publicada en <30 min" y protege el caso educativo.

**Revisión 2026-09-25 (A-3, bloque 6 de la auditoría de seguridad):** un reporte de usuario
`category: illegal_content | minor_safety` (severidad crítica) entra con **máxima prioridad** en la
cola (§4.2 de specs/17 ya lo prioriza por severidad), pero **ya no despublica la sala ni congela la
cuenta del creador de forma automática** al insertarse — eso lo decide un moderador humano al
revisar la cola, dentro del SLA de <1 h de §4.1.

**Motivo:** la severidad la fija la categoría que elige el propio reportante, sin verificación previa.
Con la cuota general de reportes (10/10 min por usuario), una única cuenta gratuita podía despublicar
hasta 60 salas ajenas por hora y dejar sus cuentas congeladas con una simple llamada a la API,
revertible solo por un moderador. El daño era inmediato, automatizable y desproporcionado frente al
coste de crear la cuenta que lo dispara.

**Consecuencia práctica:** `ModerationService.report()` ya no llama a `unpublishRoom`/
`setReviewHidden` ni el reporte crítico pendiente congela la cuenta (`publishBlocker` /
`ACCOUNT_FROZEN`); el reporte sigue creándose con `severity: "critical"` y ordena primero en
`listQueue()`. La acción (retirar la sala, ocultar la reseña) y el ban permanente de §5.1 solo se
aplican cuando un moderador confirma el reporte (`resolveReport`). La cuota de creación de reportes
para categorías críticas es más estricta que la general (política `report-write-critical`,
`packages/web/src/server/rate-limit.ts`) para acotar el spam de reportes falsos mientras la cola los
prioriza. specs/17 §4.1 y §5.1 quedan actualizadas en consecuencia.

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

**Convención (2026-09-25, auditoría F-6):** `packages/editor` no depende de `packages/web` (ni de
shadcn/ui), así que sus componentes (`Inspector`, `RulesGraph`, `ValidationPanel`,
`SchemaForm`/`schema-form-view`) pintan con `EditorUiKit` (`packages/editor/src/ui-kit.tsx`): un
`Button`/`Input`/`Textarea`/`Select`/`Checkbox` mínimo con elemento nativo por defecto (lo usan los
tests de `packages/editor` sin `web`), sustituible por el host vía la prop `components` (o
`uiKit` en `SchemaFormContext`). `packages/web` inyecta ahí sus shadcn
(`packages/web/src/components/room-editor/editor-ui-kit.tsx`) en los tres puntos de montaje del
editor real (`room-editor-inspector.tsx`, `room-editor-shell.tsx`, `puzzle-configurator.tsx`). Se
descartó mover esos componentes de UI a `packages/web`: habría roto la frontera de paquetes
(`packages/editor` es un paquete de dominio reusable, sin Next.js ni Tailwind) y estos componentes
(inspector genérico, grafo de reglas con React Flow, panel de validación) están profundamente
acoplados a la lógica y los tipos del editor, no son solo presentación.

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

---

## ADR-028 — `meta.packageFormat`: valor canónico fijado a `"roompackage/v1"`

**Contexto:** `specs/08` §6 dejaba `meta.packageFormat` como decisión abierta. En la práctica el
repo corría con dos valores distintos a la vez: `SUPPORTED_PACKAGE_FORMATS = ["1"]` en
`packages/shared/src/services/room-publish.ts` (el valor que el servidor validaba de verdad al
publicar) y `PACKAGE_FORMAT = "roompackage/v1"` en `packages/shared/src/schemas/roompackage.ts`
(una constante declarada pero nunca importada fuera de sus propios tests). El fixture del Rey
Aldric y los fixtures de demo usaban `"1"` hardcodeado.

**Decisión:** se fija `"roompackage/v1"` como valor único y canónico de `meta.packageFormat`,
promoviendo la constante ya existente en `schemas/roompackage.ts` a valor real. Se actualiza
`SUPPORTED_PACKAGE_FORMATS` a `["roompackage/v1"]` y todos los fixtures/tests que hardcodeaban
`"1"` (`docs/reference/roompackage-rey-aldric.v1.json`, `packages/web/src/lib/world-preview-fixture.ts`,
`DEFAULT_PACKAGE_FORMAT` del editor, fixtures de `game-runtime` y tests de `shared`/`web`).

**Consecuencias:** no se añade periodo de compatibilidad hacia atrás con `"1"` — el repo no tiene
salas publicadas por usuarios reales en producción, así que no hay nada que migrar y mantener dos
valores válidos solo añadiría superficie de confusión sin beneficio. Cualquier futuro bump breaking
del formato sigue la misma regla de `specs/08` §6: añadir el nuevo valor a
`SUPPORTED_PACKAGE_FORMATS` cuando el runtime lo soporte.

**Alternativas descartadas:** mantener `"1"` como valor final (pierde la semántica de namespace
`roompackage/vN` que ya usaba la constante sin usar, y que es más clara para futuros bumps);
aceptar ambos valores (`"1"` y `"roompackage/v1"`) con periodo de gracia (innecesario sin salas
publicadas reales que migrar).

---

## ADR-029 — Sincronización del editor entre procesos: Redis pub/sub, canal único, sin ack

**Contexto:** los tickets 3.2/3.3/4.2 dejaron un gap: lo que escriben el MCP (stdio o HTTP) y
`POST /api/rooms/:roomId/update` pasan por `RoomDraftService.appendUpdate` directamente — nunca por
el proceso `editor-sync` (`packages/web/src/server/editor-sync/`) —, así que un editor con
WebSocket abierto a `editor-sync` no veía esos cambios hasta recargar. Lo mismo pasaría entre dos
instancias de `editor-sync` si se escala horizontalmente: cada una solo ve sus propios WebSockets.

**Decisión:** Redis pub/sub, reutilizando la conexión y el patrón YA existentes de
`@escaperoom/kit/events` (canal namespaced con `redisPrefix()`, `getRedis()` para publicar,
`getSubscriberRedis()` — una única conexión de proceso en modo suscriptor — para escuchar), en un
módulo nuevo con la misma forma: `@escaperoom/kit/room-sync`.

- **Punto único de publicación:** `RoomDraftService.appendUpdate`/`restoreDraft`
  (`packages/shared/src/services/room-draft.ts`) reciben un puerto opcional `publish` y lo llaman
  tras persistir con `{ roomId, update, authorId }`. Como TODOS los escritores (REST, MCP, y el
  propio `editor-sync` al persistir un update de WebSocket) pasan por `appendUpdate`, un solo punto
  de publicación cubre los tres orígenes sin tocar cada adaptador.
- **Canal único, no uno por sala:** `editor-sync:draft-updates` lleva el `roomId` en el payload
  (JSON con el update en base64) en vez de una sala por canal — más simple de suscribir una vez por
  proceso (`SUBSCRIBE`, no `PSUBSCRIBE`) y barato mientras la mayoría de salas no tienen editores
  conectados en un momento dado.
- **Recepción:** `createEditorSyncServer` (`packages/editor/src/sync/server.ts`) acepta un puerto
  `remoteUpdates: { subscribe, originId }`. Al recibir un evento de una sala que tiene cargada,
  aplica el update a su doc Yjs en memoria con un origen que NO es un `ActorOrigin`
  (`Symbol("remote-draft-update")`): el `broadcast` a los WebSockets de ese proceso pasa igual, pero
  la rama que persiste (`appendUpdate`) y por tanto la que publica se salta — así un proceso nunca
  repersiste ni republica lo que acaba de recibir de Redis (evita el bucle de reenvío) sin necesitar
  lógica de deduplicación aparte. El filtro por `originId` (un id por proceso, generado una vez y
  compartido entre el publicador y el suscriptor de ESE proceso) es la segunda barrera: cada proceso
  ignora sus propios mensajes en vez de confiar solo en la idempotencia de Yjs.
- **Sin ack ni cola:** es fan-out best-effort, igual que `@escaperoom/kit/events`. Si un proceso está
  caído o su suscripción tarda en levantar, se pierde ese mensaje de propagación — no importa: la
  fuente de verdad sigue siendo Postgres (`roomUpdate`), y ese proceso la recarga entera la próxima
  vez que alguien abra la sala ahí. Lo único que se pierde es la actualización EN VIVO mientras tanto.
- **Degradación sin Redis:** sin `REDIS_URL` (o si Redis se cae), `publishDraftUpdate` y
  `subscribeDraftUpdates` son no-op — documentado y probado en `@escaperoom/kit/room-sync`. El
  draft se sigue persistiendo con normalidad y cada proceso `editor-sync` sigue sirviendo a sus
  propios clientes conectados con normalidad; lo único que se pierde es que un cambio hecho en OTRO
  proceso (otra instancia escalada, o el MCP/REST) no llega en vivo — el cliente lo ve al recargar,
  como antes de este cambio. Redis caído nunca rompe una escritura: `RoomDraftService` ignora en
  silencio cualquier error del puerto `publish`.

**Consecuencias:** un creador con el editor abierto ve en vivo lo que escribe el MCP (o un
coautor en otra pestaña que cayó a otro proceso) sin recargar. El cableado es explícito por
composition root (`packages/web/src/server/services.ts`, `packages/mcp-server/src/bin/stdio.ts`):
cada uno decide su propio `originId` — el de `stdio.ts` es uno por llamada (nunca se suscribe, no
necesita ser estable); el de web (`packages/web/src/server/room-sync.ts`) es uno por proceso,
compartido entre `getRoomDraftService()` (publica) y `createWebEditorSyncServer()` (se
suscribe y filtra su propio eco).

**Alternativas descartadas:** un canal Redis por sala (`editor-sync:room:<id>`) — más preciso pero
obliga a un `(P)SUBSCRIBE`/`UNSUBSCRIBE` por cada apertura/cierre de sala en vez de una suscripción
fija por proceso; se descartó por complejidad sin beneficio claro al volumen actual. Colas con ack
(BullMQ, ya usado en el repo para jobs) — pensado para "hay que procesar esto sí o sí", no encaja
con "mejor esfuerzo, la fuente de verdad ya está en Postgres". Deduplicar solo por idempotencia de
Yjs sin filtrar por `originId` — funciona (aplicar dos veces el mismo update Yjs es un no-op), pero
depende de un detalle interno de Yjs en vez de una invariante explícita del protocolo de sync.

---

## ADR-030 — Storage S3 de desarrollo: SeaweedFS en vez de MinIO (2026-09-25)

**Contexto:** MinIO Inc. dejó de publicar imágenes de contenedor listas para usar: `minio/minio` y
`minio/mc` pasaron a "solo fuente" el 2026-10-15 según su propio aviso, el repo se archivó en
2026-02, y el 2026-09-11 borraron ambas imágenes de Docker Hub (`quay.io/minio/minio` también
devuelve 401). `infra/docker-compose.dev.yml` no puede levantar `minio`/`minio-init` en ninguna
máquina nueva desde entonces. En producción se usa **Cloudflare R2** (API S3) vía
`packages/kit/src/storage` — eso no cambia.

**Decisión:** en desarrollo local y en CI, sustituir MinIO por **SeaweedFS**
(`chrislusf/seaweedfs`, servidor S3 embebido, imagen fijada por tag+digest) manteniendo el mismo
contrato que veían los desarrolladores: mismo endpoint (`http://localhost:9002`), mismas
credenciales de dev (`minioadmin`/`minioadmin`, fijas en `infra/seaweedfs/s3.json`, versionado) y
mismo bucket (`escaperoom-assets`). Ningún `.env` existente necesita tocarse. R2 real queda
reservado a **staging** (y producción), nunca a dev local: así se prueba de verdad la superficie S3
de R2 antes de desplegar. El job `verify` de CI arranca SeaweedFS con `docker run` (no como
`services:` de GitHub Actions: ese bloque no admite pasar el `CMD` que necesita `weed server -s3`) y
corre ahí los `*.integration.test.ts` de storage que antes se saltaban siempre (E-14).

**R2 no admite presigned POST** (formularios con `content-length-range` u otras condiciones): solo
firma GET/HEAD/PUT/DELETE. Se aprovechó el cambio para borrar `getUploadUrl` de
`packages/kit/src/storage/index.ts` (E-17 de la auditoría de 2026-09-24: sin consumidores) y dejar
un comentario explícito en el módulo para que nadie vuelva a añadir un presigned POST — funcionaría
contra SeaweedFS/MinIO en dev y fallaría en cuanto tocara R2 en staging/producción. Se revisó el
resto del código en busca de otras operaciones que R2 no soporta (ACLs por objeto, `CopyObject`
entre otras): no hay ningún uso.

**Consecuencias:** cualquier worktree nuevo puede volver a levantar `pnpm infra:up` sin depender de
que Docker Hub siga sirviendo MinIO. El volumen `minio-data` se retiró del compose sin borrarlo (son
datos de dev, no se migran); SeaweedFS arranca con su propio volumen (`seaweedfs-data`). La consola
web de MinIO no tiene equivalente exacto: el filer de SeaweedFS sirve un navegador de ficheros de
solo lectura en el mismo puerto (`59002`).

**Alternativas descartadas:** `localstack` (mucho más pesado, emula todo AWS cuando solo hace falta
S3); apuntar dev directamente a un bucket R2 real de staging (comparte datos entre desarrolladores,
sin aislamiento por worktree, y arriesga cuota/factura de un servicio real por un entorno local);
`garage` (S3-compatible más nuevo, con menos recorrido probado que SeaweedFS en este stack).
---

## ADR-031 — Avatares: 8 personajes seleccionables únicos, pivote 88,6 %, sombra y anillo del motor, producción desde 3D (2026-09-25)

**Contexto:** el primer personaje del pack gráfico (`caballero-m`, `pipeline-assets/entregas/
avatares/caballero-m/`) llegó con un cambio de criterio de producto: de "1 avatar tintable" (4
colores = 4 jugadores, `specs/04` §2 y §8 previos) a **8 personajes medievales cerrados**
(caballero/a, arquero/a, mago/a, campesino/a) entre los que cada jugador elige uno. Se producen de
uno en uno. La entrega también trajo, para los 8 personajes por igual, más fotogramas (80 por
personaje: idle 8, andar 8×4 direcciones, interactuar 4), un pivote distinto al resto del pack y la
decisión de que la sombra de contacto la pinte el motor, no el sprite.

**Decisión — personajes únicos por sesión:** dos jugadores de la misma sesión no pueden tener el
mismo personaje. El servidor es la autoridad: valida `characterId` contra `manifest.avatars` y
contra los ya ocupados en esa sesión (resuelve la carrera de dos que eligen a la vez procesando las
uniones/selecciones en el orden en que llegan a la room de Colyseus), y lo difunde en el estado
(`GamePlayerState.characterId`). El lobby (`specs/19` §1) muestra los personajes ocupados como no
disponibles. Mientras falten personajes (hoy solo `caballero-m`): al unirse sin elegir, el servidor
asigna el primer personaje libre; si no queda ninguno libre, ese jugador usa el **maniquí SVG
tintado** que existía antes de esta decisión, ahora como personaje de reserva (`characterId`
`maniqui`) — no es único, no aparece en `manifest.avatars` (no seleccionable), y varios jugadores
pueden compartirlo. La identidad visual entre jugadores que comparten personaje (o el maniquí) se
resuelve con un **anillo de color bajo los pies** (el mismo color que ya usaba el chat), no
tintando el sprite del personaje: tintar arruinaría los colores propios de cada personaje.

**Decisión — pivote al 88,6 % del alto del frame:** excepción a "abajo-centro" del resto del pack
(`specs/26` §3.1). El punto de apoyo del avatar está al 88,6 % del alto del frame (desde arriba),
centrado en horizontal — `avatarOrigin: [0.5, 0.886]` en el manifiesto, mismo valor para los 8
personajes. En proyección isométrica, el pie adelantado y la puntera quedan por debajo del punto de
apoyo en pantalla: pivotar en el borde inferior obligaría a cortar los pies; dejando el espacio y
pivotando al 88,6 %, el personaje se apoya en el suelo sin flotar ni hundirse. El runtime lee
`avatarOrigin` del manifiesto con `[0.5, 1]` por defecto (compatibilidad con packs sin el campo).

**Decisión — sombra de contacto en el motor:** los sprites de avatar no llevan sombra horneada; el
runtime dibuja una elipse de sombra en su propia capa bajo el avatar, en el mismo punto de apoyo del
pivote. Una sombra pegada al sprite se movería con el cuerpo al andar, parpadearía entre frames, se
dibujaría por encima de otros objetos en el orden isométrico y quedaría falsa en desniveles. Los
objetos estáticos del mundo pueden seguir llevando sombra horneada (no cambia para ellos).

**Decisión — producción desde 3D (aclara ADR-001):** para los avatares, la vía elegida es master 2D
→ modelo 3D → rig/animación → render isométrico, porque garantiza la luz y la proyección exactas en
las 4 direcciones y la coherencia entre los 80 frames de cada personaje. No es obligatoria para el
resto del pack (tiles, sprites de objetos siguen su propio flujo). De cada personaje se conserva
además un master 2D a 1536×2048 y su modelo 3D, para reutilizar (retrato del lobby/chat, nuevas
animaciones o direcciones) sin regenerar desde cero.

**Titularidad (aclara `18` §2.3):** las imágenes de los avatares las genera el equipo (no los
usuarios) con herramientas bajo licencia comercial (Magnific plan de pago, Blender, Mixamo); su
titularidad es de la plataforma. `18` §2.3 trata específicamente el audio de voz generado por IA
para jugadores (ElevenLabs), un caso distinto. Cada personaje documenta herramientas y fecha en su
`LEEME.md`.

**Consecuencias:** `build-pack.ts` acepta subcarpetas `avatar/<characterId>/…` (un personaje por
carpeta) además de ficheros sueltos en `avatar/` (el maniquí); exige 80 frames por cada personaje
declarado en `pack.config.json → avatars` (error si la entrega es parcial, aviso si aún no llegó
ninguno). `AvatarController` (Phaser) recibe `characterId`; `avatarAnimKey`/`avatarFrameName` pasan
a incluirlo en el nombre del frame (`avatar-<characterId>-<dir>-<acción>-<n>`). Se corrigió además
un fallo preexistente e independiente del arte en `directionFromGridDelta` (B2): con un paso de
rejilla de un solo eje, el desempate entre ejes de pantalla siempre caía en e/w, así que la
dirección nunca daba "n" ni "s" al moverse en vertical.

**Alternativas descartadas:** tintar también el sprite del personaje para distinguir jugadores que
comparten personaje (descartado: arruina el color propio de cada personaje, además de que el anillo
ya resuelve la identificación sin ese coste); permitir personajes repetidos sin restricción
(descartado por decisión de producto, ver contexto); crear un modelo Prisma nuevo solo para
persistir `characterId` por jugador (descartado: no hay tabla de participante por `sessionId` de
Colyseus en vivo donde encaje, y no se justifica crearla solo para este campo — queda documentado
como no persistido en `specs/14` §6.3, vive en `GameRoomState` mientras dura la partida).

---

## ADR-032 — Iconos de inventario: vista 3/4 común, "mechero" pasa a "yesquero", `icon-busto` entra en la spec (2026-09-25)

**Contexto:** ampliación del mismo encargo de avatares (misma entrega gráfica, mismo pack): llegaron
los 10 iconos de inventario definitivos (`pipeline-assets/entregas/iconos/`, PNG a 1×/2×/master),
sustituyendo los SVG provisionales de `specs/26` §4.3. La entrega trajo tres correcciones sobre lo
documentado hasta ahora.

**Decisión — vista 3/4 común (C1):** los 9 iconos (más `icon-busto`) comparten una misma vista de
cámara (3/4 desde arriba, ≈30°), toon 3D como los personajes, sin contorno ni sombra propia, luz
arriba-izquierda, cada objeto ocupando ≈80 % del lienzo, legibles sobre fondo claro y oscuro. Antes
la spec solo pedía "formato cuadrado, legible sobre panel oscuro", sin fijar cámara. Una vista común
hace que los iconos se sientan del mismo juego cuando se ven juntos en el inventario, y la 3/4 lee
mejor los objetos verticales (cáliz, vela, busto) que una vista frontal pura.

**Decisión — "mechero" pasa a llamarse "yesquero" (C2):** el item `mechero`/`icon-mechero` del
fixture del Rey Aldric pasa a `yesquero`/`icon-yesquero` ("Yesquero" en vez de "Mechero de
pedernal"). Un mechero no existe en la época del juego; el yesquero (cajita de hierro con yesca,
pedernal y eslabón) es el útil medieval equivalente y es lo que dibuja el icono entregado. Cambia el
id en `docs/reference/roompackage-rey-aldric.v1.json` y toda referencia a él (specs, fixtures y
tests de `colyseus-server`, `e2e`, `editor` y `mcp-server`). El icono `icon-mechero` (copia temporal
del yesquero, para que el pack siguiera validando mientras no se renombraba) se retira del pack una
vez completado el renombrado.

**Decisión — `icon-busto` entra en la spec (C3):** el fixture ya usaba `icon-busto` (item
`busto-piedra`) pero `specs/26` §4.3 y `reference/pack-grafico-lista-assets.md` solo enumeraban 9
iconos, sin él — un hueco de documentación, no de producto (el frame llevaba tiempo entregado). Se
añade a ambos documentos; ya no hace falta el aviso de "frame declarado pero no existe" que lanzaba
`pack:build`.

**Consecuencias:** `ItemIcon` (`packages/web/src/components/puzzles/item-icon.tsx`) prueba primero
`.png` y luego `.svg` (antes al revés, disparaba un 404 de más por icono ahora que el pack entrega
PNG) y declara `srcSet="<url> 2x"` — el pack entrega un único PNG por frame ya a escala ×2, así que
marcarlo como tal evita que una pantalla retina pida algo que no existe. El inventario del HUD
(`game-session-shell.tsx`) sube el icono de 16 a 28 px para que se lean las ilustraciones nuevas.

**Alternativas descartadas:** mantener `icon-mechero` indefinidamente como alias del yesquero
(descartado: arrastra confusión de nombres sin motivo una vez que todo el repo puede renombrarse en
la misma PR); versionar `icon-busto.svg` a partir del PNG entregado (descartado por la nota de la
coordinadora: usar el PNG entregado tal cual, no crear un SVG que no existe en origen).

---

## ADR-033 — Nota: `DROP TABLE "waitlistSignup"` (con emails) sin registrar en su momento (E-23, 2026-09-25)

**Contexto:** al eliminar la funcionalidad de waitlist de la landing (#96), la migración
`20260923110132_remove_waitlist` hace `DROP TABLE "waitlistSignup"` — una tabla con emails de
personas que se habían apuntado — sin que quedara una línea en este registro explicando el borrado
de esos datos. La auditoría de 2026-09-24 (bloque 9, E-23) lo señaló como hueco de documentación,
no de producto: la migración en sí es correcta (la funcionalidad se retiró de verdad, specs y
tests incluidos) y ya llevaba meses en `main`.

**Decisión:** ninguna acción sobre el dato (ya inaplicable: la tabla y sus filas ya no existen desde
`main` en `8f50aa6`/`d3b22ad`); se deja esta nota para que el histórico de "por qué se borraron
esos emails" quede en el registro en vez de solo en el mensaje de commit de la migración.

**Consecuencias:** ninguna sobre el código. Sirve de recordatorio: una migración que hace `DROP
TABLE`/`DROP COLUMN` sobre datos de usuarios reales (no solo un cambio de esquema vacío) debería
traer su línea en este registro en la misma PR, no después.

---

## ADR-034 — Índices parciales/CHECKs/triggers manuales: solo `migrate diff` + edición a mano, nunca `migrate dev` a ciegas (E-18, 2026-09-25)

**Contexto:** varios índices únicos/parciales, `CHECK`s y triggers (`setUpdatedAt`) se crean a mano
en SQL porque `schema.prisma` no los puede representar (dedupe de webhooks de Stripe, colas de
moderación filtradas por `status`, purgas RGPD que solo indexan lo aún no purgado…). La auditoría de
2026-09-24 (E-18) señaló que esto es drift estructural entre el esquema y la BD real, y que
`ixAudioAssetPending` ya arrastraba el síntoma concreto: `schema.prisma` lo describía como un
`@@index` normal cuando en la BD era parcial (`WHERE status = 'pending'`), además de no cubrir las
colas de `approved`/`rejected` que sí consulta `listModerationQueue`.

**Decisión:** política documentada en `docs/reference/migraciones-prisma.md` — nunca `prisma migrate
dev` contra estas tablas sin revisar a mano el SQL que propondría (`prisma migrate diff` en su lugar,
editar y pegar la migración); cada construcción manual lleva un comentario `///` junto al `model` en
`schema.prisma` (nunca un `@@index` que la describa a medias); las que protegen dinero/RGPD llevan
además un caso en el test de integración
`packages/shared/test/schema-manual-constraints-prisma.integration.test.ts`, que consulta
`pg_indexes`/`pg_constraint`/`pg_trigger` directamente. Se resuelve además el drift de
`ixAudioAssetPending`: se sustituye por `ixAudioAssetStatusCreatedAt` (`status`, `createdAt`, sin
`WHERE`), representable sin ambigüedad y que cubre los tres `status`.

**Consecuencias:** cualquier `DROP INDEX`/`DROP TRIGGER`/`DROP CONSTRAINT` que un `migrate dev` mal
revisado proponga sobre estos objetos se detecta en CI (test de integración, corre en el job
`verify` desde E-14) en vez de en producción. Añadir una construcción manual nueva implica ahora dos
pasos más además del SQL: el comentario `///` y, si protege algo con impacto real, su caso en el
test.

---

## ADR-035 — Semver automático al publicar; se retira el semver pedido por el autor (2026-09-25)

**Contexto:** `nextSemver(existing, requested?)` (`packages/shared/src/services/room-publish.ts`)
aceptaba un semver pedido por el autor o, si no se pedía, subía el parche sin mirar qué había
cambiado en el `RoomPackage`. Eso obligaba a quien publica a decidir a mano si un cambio era MAJOR/
MINOR/PATCH (nadie lo hacía: en la práctica todo el mundo dejaba el auto-incremento de parche, hasta
para añadir o quitar puzzles) y dejaba una superficie de API (`PublishInput.semver`) que ni el editor
ni el MCP llegaban a exponer — solo se podía forzar llamando directamente a `POST
/api/rooms/:roomId/publish` con un cuerpo a mano.

**Decisión:**

- Se añade `classifyRoomPackageChange(previous: RoomPackage | null, candidate: RoomPackage):
  "major" | "minor" | "patch" | "none"` (`packages/shared/src/services/room-version-diff.ts`), función
  pura sin acceso a la base de datos:
  - **MAJOR**: se añade o elimina algún `puzzles[]`, comparando por `id` (reordenar sin añadir ni
    quitar no cuenta).
  - **MINOR**: mismo conjunto de ids de `puzzles[]`, pero algún puzzle existente cambia de contenido
    (cualquier campo — sin granularidad fina), o una regla de `rules[]` se añade, elimina o modifica
    y referencia (en su `trigger`, alguna `condition` o alguna `action`, incluida la recursión dentro
    de `delay`) un `puzzleId` presente en ambas versiones.
  - **PATCH**: hay alguna diferencia de contenido (`objects`, `map`, `items`, `dialogs`, `hints`,
    `meta.assetsManifest`, otros campos de `meta`, o una regla añadida/eliminada/modificada que no
    referencia ningún puzzle) pero nada de lo anterior.
  - **`"none"`**: los dos paquetes son idénticos, ignorando `meta.id`/`meta.authorId`/`meta.version`
    (los fija siempre el servidor al congelar, nunca el contenido del draft).
- `nextSemver(existing, change)` ya no acepta un semver pedido: aplica el bump según `change`
  (`X.Y.Z` + MAJOR → `(X+1).0.0`; + MINOR → `X.(Y+1).0`; + PATCH → `X.Y.(Z+1)`), y `1.0.0` siempre en
  la primera publicación (no llama a `classifyRoomPackageChange`: no hay versión previa que
  clasificar).
- **Caso "sin ningún cambio" (`change === "none"`), decidido:** en la publicación real
  (`RoomPublishService.publish`) se rechaza con un error explícito, `NOTHING_TO_PUBLISH` (409) — no
  se permite crear una versión idéntica a la anterior con un PATCH vacío. Motivo: cada `roomVersion`
  es inmutable y pública (specs/13 §3); una versión sin ningún cambio de contenido no aporta nada al
  histórico y confundiría a quien lo lee ("¿qué cambió en la 1.0.5?"). En cambio,
  `checkPublishable` (la vista previa que usan tanto el editor como `inspect` de la confirmación
  humana del MCP, ticket 4.5) **no** lanza este error: si no hay cambios, informa `nextSemver` igual
  al `latestSemver` actual (publicar ahora repetiría la versión vigente) en vez de bloquear la mera
  consulta de estado — el error solo aparece si de verdad se intenta escribir sin haber cambiado
  nada.
- Se quita `semver` de `PublishInput`, de la validación de `POST /api/rooms/:roomId/publish` (el
  campo, si llega, se ignora) y de los tests que lo ejercitaban; el MCP (`publish`) y el editor ya no
  lo exponían (comprobado: no había ningún campo de semver manual en ninguno de los dos).

**Consecuencias:** publicar ya no requiere que nadie decida a mano el nivel de cambio; el semver
resultante siempre refleja el contenido real. Republicar sin haber tocado el draft es ahora un error
explícito en vez de una versión vacía silenciosa. `RoomPublishErrorCode` gana `NOTHING_TO_PUBLISH`
(409 en REST, `NOT_PUBLISHABLE` en el código de error del MCP).

**Alternativas descartadas:** permitir que "sin cambios" publique igual como PATCH — se descarta
porque banaliza el historial de versiones y no hay ningún caso de uso real que dependa de poder
"republicar" contenido idéntico (el hash de assets tampoco cambiaría). Clasificar por campo dentro de
cada puzzle (en vez de "cambió sí/no") — se descarta por ser mucho más código y mucho más frágil
(cualquier campo nuevo de una plantilla de puzzle habría que enseñárselo al clasificador) para un
beneficio que DEUDA.md no pedía: la granularidad puzzle-a-puzzle ya es suficientemente informativa
para MAJOR/MINOR/PATCH.
