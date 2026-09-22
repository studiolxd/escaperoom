# 01 — Visión y alcance

## 1. Resumen ejecutivo

Plataforma web donde:

- **Creadores** diseñan escape rooms estilo RPG isométrico con un **editor visual**, o
  **conversando con un agente IA** a través de un servidor MCP integrado.
- **Jugadores** juegan salas cooperativas en tiempo real (movimiento, chat de texto, voz y
  webcam) resolviendo puzzles mientras exploran un escenario isométrico.
- **Organizadores** (profesores, empresas, animadores) compran **eventos**: pagan ~1 € por
  jugador y reciben claves de acceso individuales para repartir entre sus asistentes, con
  panel de seguimiento en vivo.

Sin app móvil: solo navegador de escritorio en v1. Sin descarga offline (descartado).

## 2. Propuesta de valor

| Para | Valor |
|---|---|
| Creador | Publica y monetiza salas sin saber programar; el editor es el propio motor del juego (WYSIWYG real) y el MCP permite crear una sala entera describiéndola al chat |
| Jugador | Escape rooms cooperativos 1–N en el navegador, con voz y webcam, sin instalar nada; compra una partida o entra gratis con la clave de un evento |
| Organizador (profe/empresa) | Compra por jugador con descuentos por tramos, reparte claves (individuales, rotativas, de grupo o por email), agrupa como quiera y vigila el progreso en directo |
| Plataforma | Ingresos B2C (reparto 70/30), B2B/Edu (100 % eventos) y créditos IA (con margen) |

Diferenciadores frente a Genially/Educaplay y a las herramientas genéricas de creación de
juegos: (1) el escape room isométrico cooperativo multijugador en tiempo real, (2) la creación
por conversación con IA (MCP), (3) el modelo de acceso por claves para aulas y empresas.

## 3. Actores y roles

| Rol | Descripción |
|---|---|
| **Jugador** | Juega salas. Puede comprar una partida individualmente o entrar gratis con clave de evento. |
| **Creador** | Crea y publica salas con el editor visual o el MCP. Recibe 70 % de las ventas individuales y de las licencias de su sala. Plan gratuito, sin premium. |
| **Organizador** | Crea un *evento* sobre una sala que posee: compra N claves, las reparte, vigila el progreso en vivo. Puede jugar u observar. |
| **Moderador / Admin** | Revisión de contenido, reportes, retiradas y apelaciones. |

Notas de modelo:

- "Creador" y "Organizador" **no son roles de tabla**: cualquier usuario puede publicar una
  sala o crear un evento. `is_admin` / `is_moderator` son los únicos roles de staff.
- Un mismo usuario puede ser las tres cosas a la vez.

## 4. Alcance de la v1

**Dentro de alcance:**

- Registro/login, catálogo público con SEO, compra individual (Stripe + Connect).
- Runtime de juego isométrico cooperativo 1–N con las 8 plantillas MVP.
- Chat de texto, voz y webcam (LiveKit).
- Editor visual colaborativo (Yjs) con validador y playtest.
- MCP del creador con paridad funcional con el editor.
- Eventos B2B/Edu completos: tramos de precio, claves, emails, PDF, panel en vivo.
- Licencias de salas entre creadores (compra y regalo de copia).
- Moderación post-publicación con pre-check automático y apelaciones.
- Analítica de producto instrumentada desde el diseño.

**Fuera de alcance de la v1** (documentado como v2 en `23-motor-v2-marketplace-y-api-publica.md`):

- App móvil.
- Descarga offline del escape room (descartada del producto).
- Subida de assets custom por el creador (imágenes/audio propios en el editor).
- Sistema de plugins de puzzles.
- Pistas lanzadas por el organizador a un grupo (modo híbrido).
- Condiciones anidadas AND/OR en el motor de reglas.
- Ranking global/multisala, torneos oficiales, temporadas.
- API pública, webhooks, SSO.
- Multi-región.

## 5. Sala de referencia: "La Maldición del Rey Aldric"

Toda la plataforma se valida contra una sala de referencia medieval de 3 habitaciones
(Salón del Trono → Bodega de los Vinos Encantados → Catacumbas), 1–4 jugadores, ~55 minutos.
Usa exactamente las 8 plantillas del MVP y sirve para cuatro propósitos simultáneos:

1. **Validar el formato RoomPackage**: demuestra que el JSON expresa una sala real completa.
2. **Fixture de pruebas permanente**: test E2E "cargar y completar el Rey Aldric".
3. **Plantilla de referencia** para el MCP, el onboarding ("desmóntala y mira cómo está hecha").
4. **Caso de aceptación del MCP**: debe poder construirse entera por chat en ~30 minutos.

Resumen de puzzles: llave escondida tras cuadro; candado numérico de 4 dígitos (`4732`) con
pistas repartidas por el escenario; placas simultáneas con objeto-puente (cáliz) para modo
solitario; mural deslizante 3×3; memoria de copas; pista dividida entre dos mirillas
(objeto-puente: espejo); canal de tuberías; y candado final (`4538`) que repasa pistas de todo
el castillo. El paquete completo está en `reference/roompackage-rey-aldric.v1.json`.

Lecciones de diseño adoptadas y aplicadas a todas las salas futuras:

1. **Progresión tutorial → clímax.**
2. **Objetos que viajan entre salas** (el cáliz de la Sala 1 a la Sala 2).
3. **Cada mecánica cooperativa tiene objeto-puente** para no bloquear al jugador solo.
4. **El código final repasa el recorrido** (rejugabilidad y puntuación).
5. **Estados visibles compartidos** entre jugadores (antorchas encendidas).

## 6. Principios de diseño transversales

1. **El servidor es la única autoridad.** El cliente nunca valida puzzles ni conoce
   soluciones. Host ≠ servidor: el host solo gestiona la sesión.
2. **El formato es declarativo.** El runtime ejecuta datos (reglas SI/ENTONCES), nunca código
   del creador. Seguridad, validación y paridad MCP/editor salen gratis de este principio.
3. **Un solo contrato de sala.** El mismo `RoomPackage` circula por editor, API, BD, MCP y
   runtime.
4. **Un solo código.** El editor **es** el runtime en modo edición; los componentes React de
   puzzle se comparten entre editar, previsualizar y jugar.
5. **Todo cooperativo es jugable en solitario** mediante `soloBridgeItemId` cuando aplique.
6. **Los textos son multidioma desde el diseño** (`LocalizedText`), incluido el audio por idioma.
7. **Todo lo que el editor visual puede hacer, el MCP puede hacerlo, y viceversa.**

## 7. Glosario

| Término | Significado |
|---|---|
| **RoomPackage** | Documento JSON completo que define una sala (meta, mapa, objetos, items, puzzles, reglas, diálogos, pistas). |
| **Plantilla (de puzzle)** | Tipo de puzzle reutilizable con esquema y componente propios (p. ej. `code_lock`). |
| **Definición vs. instancia** | La *definición* es estática (JSON, editable); la *instancia* es el estado en vivo en la room de Colyseus. |
| **World layer / Panel layer** | Capa donde vive un puzzle: en el mundo 3D isométrico (Phaser) o como panel/formulario (React). |
| **Objeto-puente** (`soloBridgeItemId`) | Objeto que sustituye a un segundo jugador en una mecánica cooperativa. |
| **Evento** | Jornada de organizador sobre una sala: sesiones, claves y panel. |
| **Sesión** | Una partida concreta (una `GameRoom` de Colyseus), hasta 10 por evento. |
| **Clave de acceso** | Código que da derecho a un asiento en una sesión (individual, rotativa, de grupo, batch). |
| **Draft vs. versión** | El draft es el doc Yjs vivo y colaborativo; la versión es el `RoomPackage` congelado e inmutable. |
| **MCP** | Model Context Protocol; servidor que expone el editor a un agente IA. |
| **Validador** | Motor que comprueba solvabilidad, dead ends, objetos huérfanos y pistas de una sala. |

## 8. Dependencias

- `specs/02-modelo-de-negocio.md` — qué se vende y cómo.
- `specs/03-arquitectura-y-stack.md` — con qué se construye.
- `specs/09-editor-de-salas.md`, `specs/10-mcp-del-creador.md` — cómo crea el creador.
- `reference/roompackage-rey-aldric.v1.json` — el ejemplo ejecutable de todo lo anterior.
