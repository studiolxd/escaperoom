# Deuda técnica

Tareas pendientes que no bloquean pero hay que resolver.

- [ ] **Salas en 3D, además de 2D (muy largo plazo).** Permitir crear y jugar salas en
      3D, además de las 2D isométricas actuales, tanto en el creador (editor y MCP) como
      en el juego. Implica también una etiqueta **2D/3D** en cada sala y un **filtro
      2D/3D en el catálogo**. Antes de implementar: spec propia (motor de render 3D —
      Phaser 4 no trae 3D real, ADR-001 —, formato de la sala en el `RoomPackage`,
      assets y pipeline de `tools/assets-generator`, rendimiento en equipos modestos
      de colegios, paridad editor↔MCP y compatibilidad con las mecánicas y plantillas
      de puzzles existentes).
- [ ] **Extraer el motor de creación y de juego a un paquete compartido `@studiolxd` (muy
      largo plazo).** Sacar a un paquete propio de `@studiolxd` todo el motor de creación
      y de juego, para consumirlo desde aquí y desde una futura aplicación de la suite
      slxd:
      - **Aquí** se queda solo lo propio del SaaS (catálogo, compras y pagos, eventos y
        claves, organizaciones, reseñas, moderación, cuentas, páginas públicas y legales).
      - **En slxd**, un producto nuevo que consume el mismo paquete y permite crear escape
        rooms exportables a **SCORM** y con **xAPI** dentro de la suite.
      Antes de implementar: decidir qué entra en el paquete (candidatos: esquemas del
      `RoomPackage`, motor de reglas y sesión de `shared`, `game-runtime`, `editor` y
      plantillas de puzzles, validador, packs gráficos y, en parte, el toolset MCP y el
      protocolo de partida), cómo se publica y versiona (registro privado, semver, ADR-035),
      qué queda acoplado hoy a Prisma, Next o Colyseus y hay que abstraer, y cómo se
      empaqueta una partida para SCORM/xAPI (jugar sin servidor en red, con
      `createLocalGameClient`, y reportar progreso y resultado al LMS).
- [ ] **Usar los motores 2D/3D para otros géneros: RPG educativo (muy largo plazo).**
      Aprovechar el motor 2D actual (y el 3D, cuando exista) para crear, además de escape
      rooms, juegos tipo **RPG** como el onboarding de Studio LXD
      (`/Users/suvi/Dev/apps/onboarding`: Phaser + React, diálogos, paneles de
      información, pantallas interactivas y SCORM con `@studiolxd/scorm`): **NPC** con
      los que hablar, **diálogos** ramificados, **objetivos/misiones** y su seguimiento,
      progreso guardado y resultado reportable. Encaja con el paquete compartido
      `@studiolxd` (entrada de arriba): el motor sería común y cada producto (escape room,
      RPG) aportaría sus mecánicas. Antes de implementar: spec del modelo de juego
      genérico (qué es común — mapa, objetos, inventario, reglas, diálogos, sesión — y qué
      es propio de cada género), cómo se amplían el editor y el MCP, y si el catálogo y
      los eventos del SaaS admiten otros tipos de experiencia además de salas.
- [ ] **Texto de la introducción de la sala fuera de la gestión de idiomas del editor.** El
      texto de `meta.intro` (#180, ADR-040) aún no entra en `findMissingTranslations` ni en
      `purgeLanguageTranslations` del editor: no avisa de idiomas sin traducir ni se purga al
      quitar un idioma.
- [ ] **Limpieza periódica de vídeos de introducción `pending`.** Las subidas de vídeo de
      introducción que se reservan pero nunca se completan (`introMediaAsset` en `pending`, #180)
      no tienen limpieza periódica (specs/14 §10.2): falta un job del worker que borre el
      registro y el objeto del bucket pasado un plazo.
- [ ] **Revisar todo el SEO.** Auditoría completa de SEO de la web pública antes de producción. Hoy existe:
      `app/robots.ts`, `app/sitemap.ts` (salas × 6 idiomas), metadatos por página
      (`lib/catalog-seo.ts` → `buildPageMetadata`, ~11 páginas con `generateMetadata`), JSON-LD en la ficha de
      sala (con hasta 5 reseñas) y `noindex` en páginas legales y de desarrollo. Revisar: títulos y descripciones
      de todas las páginas públicas e idiomas, `canonical` y `hreflang`/`alternates` entre los 6 idiomas,
      Open Graph y Twitter cards (imagen de portada por sala), datos estructurados (sala, reseñas, organización,
      breadcrumbs) validados con las herramientas de Google, sitemap (paginación, `lastModified`, solo salas
      publicadas e indexables, caché — ver F-39), robots, páginas que no deben indexarse (juego, editor, panel,
      canje, playtest, admin), URLs amigables (¿slug en la ficha de sala en vez del UUID?), 404/410 de salas
      retiradas, rendimiento y Core Web Vitals de catálogo y ficha, y textos alternativos de imágenes. Depende
      de decidir el dominio de producción (entrada de abajo) para las URLs absolutas.
- [ ] **Reiniciar las versiones de las páginas legales antes de producción.** Como aún no hay usuarios reales,
      antes del primer despliegue se pueden devolver todas las páginas legales a su **primera versión**: una
      única fecha de versión común (la de publicación) en `versionDate` de `packages/web/src/content/legal/*.ts`
      (términos, privacidad, cookies, aviso legal, DPA) y en las constantes de reaceptación
      (`CURRENT_TERMS_VERSION` en `legal-acceptance.ts`, `CURRENT_DPA_VERSION`), quitando el historial de
      versiones intermedias de dev (p. ej. `2026-09-26-2`) y sus comentarios. Con la base de producción vacía no
      hay aceptaciones previas que invalidar. Hacerlo junto con el resto de textos legales definitivos (incluido
      el dominio, entrada de abajo).
- [ ] **Partidas de 1 jugador sin paneles multijugador.** En una partida con un solo jugador (sala de
      máximo 1 jugador, o partida en la que solo hay uno) no deben mostrarse el panel de audio y vídeo
      (LiveKit, `media-overlay`/`media-tiles`), el de jugadores (`PlayersAside`) ni el chat (`ChatWindow`),
      ni en el lobby ni en la partida. Decidir el criterio exacto: por `meta.players.max === 1` de la sala,
      o por número de jugadores conectados (y qué pasa si alguien entra tarde a una partida que empezó con
      uno). Aplicar también al playtest del editor (un jugador).
- [ ] **Decidir el dominio de producción.** Pendiente operativo, sin fecha. El Aviso
      Legal (`packages/web/src/content/legal/legal-notice.ts`) lleva un `[PENDIENTE]`
      con el dominio; al decidirlo, sustituirlo y revisar el resto de sitios que lo
      necesiten (`BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`, CSP, Plausible, emails, OAuth
      de Google y del MCP, Stripe).
- [ ] **Claves reales de analítica antes de desplegar en producción.** En
      desarrollo se activan Plausible y Google Analytics con valores de prueba
      (para ver el banner de consentimiento de cookies). Antes del primer
      despliegue en producción hay que poner los reales: dominio de Plausible
      registrado y el ID de medición de Google Analytics (`G-…`) de la
      propiedad real. El arranque en producción debe fallar si faltan o si
      siguen siendo los de desarrollo (mismo mecanismo que `requireInProduction`,
      PR #117); revisar también que los textos legales (`privacy.ts`,
      `cookies.ts`) describen la configuración real (dominio, retención de GA,
      transferencias internacionales de Google).
- [ ] **Definir la generación de assets con Magnific en la plataforma.** Magnific va a
      usarse (decisión del usuario, 2026-09-25): los textos legales ya lo declaran como
      proveedor activo. Falta definir la funcionalidad: qué podrá generar o editar un
      creador desde el editor (imágenes de objetos, fondos, retratos…), con qué flujo
      (prompt, referencias, aprobación por paso como en `tools/assets-generator`), cómo
      se cobra (créditos, como el audio de ElevenLabs en specs/15), moderación del
      resultado (specs/17), titularidad y licencia de lo generado (specs/18 §2),
      integración con la API de Magnific (credenciales, cuotas, reintentos), almacenamiento
      en R2 y cómo entra en el `RoomPackage`/pack. Escribir la spec antes de implementar.
      Referencia del uso interno actual: `tools/assets-generator/CLAUDE.md` ("Normas de
      trabajo con Magnific").
- [ ] **Publicar en R2 los packs generados por `tools/assets-generator`.** Hoy la salida
      de la herramienta (`packs/<pack>/salida/`) se copia a mano a
      `packages/web/public/packs/<pack>/` y se empaqueta con `pnpm pack:build`; el
      `manifest.json` y los atlas no se versionan, así que ni CI ni producción los tienen
      (en un clon limpio se ven placeholders). Definir e implementar el camino a
      producción (specs/26 §9): build del pack → subida de atlas y manifiesto a
      Cloudflare R2 con ruta versionada por pack y versión, cabeceras de caché/CDN, que
      el runtime cargue el pack desde R2 (URL del manifiesto por pack/versión) en vez de
      `public/`, credenciales y quién lo ejecuta (script manual o paso de CI). Decidir
      también el almacenamiento definitivo de los binarios de la herramienta (`fuentes/`,
      `entregas/`, `referencias/`, hoy solo en local y con copia en `pipeline-assets`).
      **Ojo (#184):** los 7 personajes provisionales del pack `medieval-v1` son enlaces simbólicos
      (git `120000`) a los frames y el retrato de `caballero-m`: el script de subida debe seguirlos
      (dereferenciar) o se perderán en R2; desaparecen cuando se generen los personajes reales.
- [ ] **API pública para terceros (auditoría 2026-09-24, A-8).** `specs/13` describe una superficie
      REST también pensada para integradores externos (Bearer/API key, `Idempotency-Key`,
      `/api/me/purchases`, `/api/me/rooms`, alta de organización y miembros por REST, CRUD de salas
      por REST, grupos de sesión por REST, grabaciones, progreso de sesión por REST) que hoy no
      consume nadie: la UI usa tRPC y el creador el MCP (ADR-022). Decidido (2026-09-26): no se
      implementa hasta tener una versión chequeada del proyecto; se diseñará con el primer
      integrador real, probablemente un LMS vía LTI (también agencias de eventos o revendedores).
      Piezas que faltan cuando se retome:
      - Emisión y revocación de API keys por organización (hoy no hay ningún modelo de API key).
      - Cuotas por cliente (rate limiting propio, distinto del de sesión de usuario).
      - Idempotencia real vía cabecera `Idempotency-Key` (persistir la respuesta 24 h).
      - Documentación pública del contrato (OpenAPI o similar) y un compromiso de estabilidad
        (`specs/13` "el contrato evoluciona de forma aditiva" ya lo anticipa).
      - Las rutas en sí, marcadas "API pública — futura" en `specs/13`.
- [ ] **Sustituir los 7 personajes provisionales del pack `medieval-v1` por los reales.** Para
      poder probar la elección de los 8 personajes del reparto (`tools/assets-generator/packs/medieval-v1/docs/personajes.md`)
      mientras solo existe `caballero-m`, `caballero-f`, `arquero-m`, `arquero-f`, `mago-m`,
      `mago-f`, `campesino-m` y `campesina-f` son **el mismo personaje**: reutilizan los frames
      y el retrato de `caballero-m` mediante enlaces simbólicos (`avatar/<id>/*.png` del pack en
      `packages/web/public/packs/medieval-v1/`, generados con
      `tools/assets-generator/scripts/empaquetar/empaquetar_avatar_alias.py`; su
      `pack.config.fragment.json` en `entregas/` lleva `"alias_de": "caballero-m"`). Cuando cada
      personaje real tenga su master + render (pipeline de `tools/assets-generator/CLAUDE.md`
      §"Pipeline de personajes jugables"), sustituir su carpeta de enlaces por la entrega real
      (`empaquetar_avatar.py` + `empaquetar_retrato.py`) y quitar la entrada correspondiente de
      `tools/assets-generator/packs/medieval-v1/entregas/avatares/`.
- [ ] **Smoke E2E (`game.reyaldric.spec.ts`) intermitente en el último paso (cruzar
      `puerta-bodega`).** El pathfinding real ya está implementado (BFS con
      simplificado de ruta, `packages/game-runtime/src/world/pathfinding.ts`,
      `findPath`/`simplifyPath`, revisión en vivo) y sustituye a la vieja heurística de
      "rectángulo delimitador libre" (`hasClearPath`, insuficiente en salas no
      rectangulares) — el avatar ya no se queda clavado contra una estatua u otro
      obstáculo con el destino detrás, ni al ir a `cuadro-aurelio` desde el spawn ni al
      ir de las placas a la puerta. En 3 ejecuciones seguidas del smoke test tras el
      arreglo, los pasos 1–5 (candado, cuadro, armario, combinar, brasero) pasaron las
      3 veces; el registro del juego confirma que ambos jugadores llegan a cruzar de
      verdad a la Bodega ("Entras en La Bodega de los Vinos Encantados"), pero el
      `page.waitForFunction` de `UiPlayer.goTo` (`packages/e2e/support/game.ts`) que
      espera a que la puerta deje de estar en la sala visible falló por timeout en 1 de
      esas 3 veces pese a que el cruce sí ocurrió — parece timing del propio arnés de
      pruebas (dos `BrowserContext`, sincronización de red) más que un bug de
      movimiento. Revisar si `goTo` necesita más margen o una espera distinta antes de
      dar el smoke test por estable.