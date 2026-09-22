User: Quiero redactar las especificaciones para crear una aplicación de crear scapes room. La idea es Que una persona cree scapes room desde su cuenta gratis y pueda venderlos a los jugadores de podrá jugar de 1 a N players. El campo de juego es un rpg isométrico donde se van explorando cosas, accediendo a salas y resolviendo puzzles.
Kimi: ¡Excelente proyecto! Aquí tienes una primera versión de las especificaciones, estructurada como un documento base que podemos ir afinando juntos.

---

# EscapeRoom Creator — Especificaciones (v0.1)

## 1. Visión general

Plataforma donde **creadores** diseñan, construyen y monetizan escape rooms en 2D isométrico estilo RPG, y **jugadores** compran/juegan salas en modo **multijugador cooperativo (1 a N jugadores)**.

## 2. Actores y roles

| Rol | Descripción |
|---|---|
| Creador (plan gratis) | Usuario con cuenta gratuita que puede crear salas, publicarlas y venderlas (con comisión de plataforma). |
| Jugador | Compra y juega salas; puede dejar reseñas y puntuaciones. |
| Moderador/Admin | Revisión de contenido, reportes de abuso, retiros de contenido. |

**Monetización sugerida:** precio por sala (p. ej. 0,99–4,99 €) con reparto 70/30 a favor del creador; plan premium para creadores con más slots de salas y cero comisión de pago extra. Definir si los jugadores pagan por sesión o por sala permanente.

## 3. Experiencia del jugador

1. Explorar catálogo (por categoría, dificultad, valoración, idioma).
2. Comprar/activar una sala → crear o unirse a una partida.
3. Partida cooperativa en tiempo real: avatar isométrico, exploración, colección de objetos, puzzles encadenados.
4. Sistema de pistas limitadas (timed hints), cronómetro opcional, clasificación por tiempo.
5. Al finalizar: puntuación, logros, reseña.

## 4. Experiencia del creador (editor)

Flujo tipo "construir → probar → publicar":

- **Escenario isométrico:** editor de tiles/salas conectadas (puertas, llaves, transiciones).
- **Objetos y combinaciones:** inventario de elementos clásicos (llaves, códigos, engranajes, cartas) con lógica tipo: *objeto A + objeto B → resultado C*.
- **Puzzles:** plantillas (códigos numéricos, secuencias, acertijos de lógica, sincronización entre jugadores) + condiciones de activación (al entrar a sala X, al recolectar Y).
- **Condiciones y eventos:** editor visual de reglas `SI (condición) ENTONCES (acción)`; soporte de variables globales por partida.
- **Multijugador en diseño:** definir mecánicas cooperativas obligatorias (botones simultáneos, información dividida: cada jugador ve una pista distinta).
- **Prueba local:** modo "jugar como jugador" antes de publicar.
- **Publicación:** metadatos (título, descripción, idioma, duración estimada, dificultad, capacidad 1–N), precio, versiónado (parches tras lanzamiento).

## 5. Requisitos funcionales (resumen)

**Núcleo multijugador**
- Salas con invitación por código/enlace.
- Estado de partida compartido en tiempo real (movimientos, inventario, estado de puzzles).
- Límite configurable de jugadores por sala (definido por el creador).

**Sistema económico**
- Monedero del creador, pagos, retiro de fondos.
- Catálogo, reseñas, devoluciones opcionales.

**Cuenta y seguridad**
- Registro/login (email, Google, etc.).
- Moderación de contenido publicado + reportes.

## 6. Requisitos técnicos (propuesta)

- **Cliente:** motor 2D isométrico (ej. Godot, Unity o PixiJS/Phaser para web). Soporte inicial: web (y móvil como fase 2).
- **Servidor:** autoridad del estado de partida (WebSockets o matchmaking con relays) para prevenir trampas en modo competitivo de clasificación.
- **Persistencia:** salas y progreso en BD relacional + assets en almacenamiento de objetos.
- **Editor:** MVP web-first con assets predefinidos (tilesets, sprites, iconos de objetos); subida de assets custom en fase posterior.

## 7. Alcance por fases (MVP)

| Fase | Entregable |
|---|---|
| Fase 1 | Registro, editor básico (1 sala, 3 tipos de puzzle), modo 1–4 jugadores en tiempo real, compra por sala. |
| Fase 2 | Salas múltiples conectadas, mecánicas cooperativas forzadas, catálogo con reseñas, panel del creador. |
| Fase 3 | App móvil, assets custom, UGC destacado, eventos/retos temporales, mercado secundario de salas. |

## 8. Preguntas abiertas que conviene resolver antes de escribir el PRD completo

1. **Motor/plataforma objetivo:** ¿web, móvil, desktop, o multi?
2. **Precio del juego:** ¿las salas las paga el host y sus amigos juegan gratis, o cada jugador paga?
3. **Capacidad máxima:** ¿N es 4, 8, más?
4. **Éxito de un puzzle:** ¿siempre por resolver el acertijo, o también por habilidad/reflejos?
5. **Moderación:** ¿contenido pre-aprobado o post-publicado con reportes?

---

¿Quieres que profundice en alguna sección (por ejemplo, el modelo de datos del editor o las mecánicas multijugador), o prefieres que te genere el documento como archivo descargable (Markdown o DOCX)?
User: Quiero ahora un listado de juegos que puedan hacerse
Kimi: ¡Perfecto! Aquí tienes un catálogo de minijuegos y puzzles organizados por tipo, pensado para el editor isométrico de tu app. Está pensado para que el creador pueda elegirlos como "plantillas".

---

# Catálogo de minijuegos / puzzles para salas de escape

## 1. Puzzles clásicos de un solo jugador (1+ jugadores)

| Juego | Descripción | Dificultad |
|---|---|---|
| Código numérico | Combinación de candado de 4–6 dígitos, pistas repartidas por la sala | ⭐ |
| Código con símbolos/colores | Secuencia de colores o símbolos encontrados en cuadros, alfombras o decoración | ⭐ |
| Adivinanza / acertijo | Texto cifrado, jeroglíficos o adivinanza escrita en un pergamino | ⭐ |
| Puzle deslizante (15-puzzle) | Reordenar piezas para formar una imagen o mapa | ⭐⭐ |
| Memoria | Tablero de cartas: encontrar pares iguales | ⭐⭐ |
| Rompecabezas de piezas | Completar un mosaico, mapa o pintura | ⭐⭐ |
| Laberinto | Laberinto de papel o baldosas que traza un camino (números ocultos) | ⭐⭐ |
| Secuencia musical | Repetir una melodía con notas o campanas en orden | ⭐⭐ |
| Pesas y balanza | Equilibrar objetos de peso desconocido usando una balanza | ⭐⭐ |
| Tangram / formas | Encajar piezas en un hueco con forma específica | ⭐⭐⭐ |
| Tuberías / cables | Conectar conductos o cables de un punto a otro | ⭐⭐ |
| Lógica tipo Sudoku | Rejilla de colores/símbolos sin repetir en filas o columnas | ⭐⭐⭐ |
| Circuito eléctrico | Cerrar un circuito moviendo piezas | ⭐⭐⭐ |
| Reflejos / timing | Pulsar botones en el instante justo (luz que pasa por un punto) | ⭐⭐⭐ |
| Quitar palitos / coincidencias | Contar y reordenar elementos (familia de "Palillos chinos") | ⭐ |
| Palabra oculta / sopa de letras | Letras escondidas en la escena que forman una palabra-clave | ⭐⭐ |

## 2. Puzzles de exploración e interacción con el escenario

| Juego | Descripción |
|---|---|
| Llave escondida | La llave está tras un cuadro, bajo una alfombra, dentro de un libro |
| Ordenar objetos | Colocar libros, jarrones o espadas en un orden concreto (pista en retratos) |
| Espejo / proyección | Alinear un espejo para reflejar luz hacia un objetivo |
| Cajones con mecanismo | Abrir cajones en el orden correcto según pistas |
| Símbolos ocultos en el entorno | Símbolos pintados en el suelo solo visibles desde un ángulo o con luz |
| Fósforos / agua / plantas | Interacción tipo "física simple": encender antorchas en orden, llenar cubos, crecer una planta |
| Mapa del tesoro | Un mapa incompleto se completa encontrando fragmentos por la sala |
| Reloj / mecanismo | Girar engranajes para alinear agujas de un reloj a una hora clave |

## 3. Puzzles de inventario y combinación

| Juego | Descripción |
|---|---|
| Combinar objetos | Vela + mechero = antorcha encendida |
| Usar objeto en el sitio | Usar la palanca en la escotilla, el imán para sacar una llave de un desagüe |
| Desmontar / inspeccionar | Examinar un objeto para encontrar un número escrito dentro |
| Receta / ritual | Mezclar ingredientes en orden para crear el componente mágico |

## 4. Puzzles cooperativos (requieren 2+ jugadores) ⭐ multijugador

| Juego | Descripción | Mín. jugadores |
|---|---|---|
| Botones simultáneos | Dos jugadores deben pisar placas al mismo tiempo | 2 |
| Pista dividida | Cada jugador ve un fragmento de un código (hay paredes que tapan la visión) | 2 |
| Simetría | Un jugador ve un patrón y lo describe; otro lo replica en su lado | 2+ |
| Relé de activación | Jugador A abre una puerta durante X segundos para que pase B | 2 |
| Puzle en cadena | Cada jugador resuelve una parte seguida (el tiempo total cuenta) | 2+ |
| Espejo y sombra | Uno guía a otro a través de un laberinto guiándolo por voz | 2 |
| Desafío contrarreloj por equipos | Pistas repartidas: cada equipo resuelve su mitad para abrir la caja central | 2+ |
| Intercambio de objetos | Ningún jugador puede resolver su sala sin un objeto que solo tiene el otro | 2 |

## 5. Juegos narrativos / de deducción

| Juego | Descripción |
|---|---|
| Misterio de asesinato | Interrogar NPCs, cruzar coartadas y acusar al culpable |
| Causa y efecto histórico | Reconstruir la línea temporal de un evento ordenando momentos |
| Cartas / notas encontradas | Leer diarios, cartas y periódicos para inferir el código final |
| Alibi falso | Detectar la mentira en tres testimonios contradictorios |

## 6. Variantes por tiempo y presión (modo clasificación)

- **Contrarreloj estricto:** pistas limitadas y penalización por usarlas.
- **Pistas degradadas:** cada pista usada reduce la puntuación final.
- **Efecto dominó:** fallar un puzzle añade tiempo penal al siguiente.

---

## Recomendación de MVP

Para la Fase 1 del editor, te sugiero implementar solo estas 8 plantillas: **código numérico, puzle deslizante, memoria, tuberías, combinar objetos, llave escondida, botones simultáneos y pista dividida**. Con ellas se puede construir casi cualquier sala sencilla y cubren lo individual y lo cooperativo.

¿Quieres que detalle las **reglas y estados internos** de alguna plantilla (para documentar cómo la implementaría el editor), o que añada puzzles temáticos (terror, fantasía, ciencia ficción, misterio victoriano)?
User: Para no crear a ciegas, con los 8 juegos que has elegido hagamos la narrativa de un escape room que incluya dos o tress salas. Elige una temática medieval y plantéala
Kimi: ¡Buena idea, diseñar jugando! Aquí tienes la propuesta completa de un escape room medieval de 3 salas usando exactamente las 8 plantillas del MVP. Sirve como caso de prueba para validar el editor.

---

# 🏰 "La Maldición del Rey Aldric" — Escape Room Medieval (3 salas, 2–4 jugadores)

## Premisa narrativa

*El rey Aldric fue traicionado por su hermano, el mago oscuro **Malrec**, quien selló su alma en un relicario escondido en las mazmorras del castillo. Vuestra orden de caballeros ha recibido una profecía: solo un grupo de héroes que atraviese el **Salón del Trono**, la **Bodega de los Vinos Encantados** y las **Catacumbas del Rey** podrá romper el sello antes de que Malrec consiga el poder absoluto. Disponéis de 60 minutos.*

**Objetivo final:** romper el sello del relicario y liberar el alma del rey.

---

## 🗝️ SALA 1 — El Salón del Trono (nivel de entrada)

**Propósito de la sala:** enseñar mecánicas básicas al jugador y activar el portal a la bodega.

### Escena isométrica
Sala rectangular: trono al fondo, 4 retratos de reyes en las paredes, alfombra central, un armario con cajones, dos estatuas de caballeros a los lados y un brasero apagado.

### Puzzles

**1. Llave escondida (plantilla: llave escondida)**
Una llave de bronce sobresale apenas tras el cuadro del Rey Aurelio. Interactuar con el cuadro la revela. *Sirve de tutorial: "¡Explora! Algunos objetos se esconden en la escena."*

**2. Cajones del armario (plantilla: código numérico)**
Con la llave de bronce se abre el armario... que contiene un pequeño arca con candado de 4 dígitos. Las pistas del código están repartidas:
- El retrato del Rey Aurelio tiene una inscripción: *"El más grande de los cuatro reinos."* → **reloj del reino con 4 torres = 4**
- Un tapiz del trono muestra **7 dragones** bordados.
- El brasero tiene marcado el número de brasas: **3**... pero hay que encender el brasero para verlo (**combinar objetos**: mechero + vela → antorcha → encender brasero).
- El orden correcto está dado por los retratos de izquierda a derecha.

**Código: 4-7-X-3** (el brasero es la tercera pista). Dentro del arca: **el cáliz real** y un pergamino que habla de los vinos encantados.

**3. Las estatuas de los caballeros (plantilla: botones simultáneos)**
La puerta a la bodega está sellada con un mecanismo de dos placas de piedra. Un caballero a cada lado. **Dos jugadores deben pisar las placas al mismo tiempo** (si es un jugador solo, la placa necesita un objeto pesado... ¡el cáliz real encaja!). Esto enseña la mecánica cooperativa sin frustrar a quien juega en solitario.

✅ *Salida desbloqueada → Bodega.*

---

## 🍷 SALA 2 — La Bodega de los Vinos Encantados (dificultad media)

**Propósito de la sala:** combinar inventario con observación; introducir la pista dividida.

### Escena isométrica
Bodega subterránea: estanterías de barriles, mesa de cata con 6 copas, un mural de la vendimia, una escalera de caracol bloqueada por una reja, y un arca bodega con un mecanismo de tuberías de vino.

### Puzzles

**4. El mural de la vendimia (plantilla: puzle deslizante)**
Un mosaico de azulejos de cerámica está desordenado. Reordenarlo revela la escena: los campesinos llevando uvas **al barril número 5**. Debajo del mosaico, una ranura con forma de cáliz.

→ **Combinar objetos:** usar el **cáliz real** (de la Sala 1) en la ranura → un compartimento se abre con la **llave de plata**.

**5. Los 6 barriles y las 6 copas (plantilla: memoria)**
La llave de plata abre un armario con 6 **fichas de madera** con símbolos: 🌙 sol, llave, luna, dragón, corona, espada. En la mesa de cata hay 6 copas tapadas. Las fichas se insertan en la mesa y se revela un juego de memoria: cada copa oculta un símbolo; encontrar los 3 pares correctos (los que aparecen bordados en el mantel de la mesa). Cada pareja correcta ilumina una antorcha de la escalera de caracol.

**6. La reja de la escalera (plantilla: pista dividida)** ⭐ cooperativo
La reja tiene un mecanismo con **dos mirillas opuestas**. Cada mirilla muestra la mitad de un código de 4 símbolos:
- Jugador A ve: 🌙 _ luna _
- Jugador B ve: _ corona _ espada
- Un muro central impide que un solo jugador vea ambas mitades. **Deben comunicarse** (o, en solitario, usar un **espejo encontrado en un barril** para reflejar la otra mitad — truco de diseño para no bloquear al jugador solo).

Combinar ambas mitades en orden (indicado por el dibujo del mecanismo): **🌙 corona luna espada** → la reja se abre.

✅ *Subida desbloqueada → Catacumbas.*

---

## ⚰️ SALA 3 — Las Catacumbas del Rey (clímax)

**Propósito de la sala:** puzzle final en cadena con presión de tiempo.

### Escena isométrica
Cripta circular: sarcófago del Rey Aldric al centro con el relicario encima, antorchas, un canal de agua que recorre la sala, 8 vasijas sagradas, y un altar con el mecanismo del sello.

### Puzzles

**7. El canal de agua sagrada (plantilla: tuberías)**
El agua bendita debe llegar al altar para romper el sello, pero el canal está bloqueado con bloques de piedra. Girir las piezas del canal (tuberías) para crear un camino continuo hasta el altar. Algunas piezas están rotas: hay que **combinar objetos** (la **llave de oro** hallada dentro de la llave de plata... sí, una llave dentro de otra — sorpresa final) para abrir una compuerta de repuesto.

**8. El sello del relicario (plantilla: código numérico final)**
Con el agua fluyendo, el relicario se desbloquea parcialmente y pide el **código final de 4 dígitos**. Las pistas estaban repartidas por todo el castillo (la narrativa hace que reviséis lo aprendido):
- **Primer dígito:** *"El más grande de los cuatro reinos"* → 4
- **Segundo dígito:** barriles del mural → **5**
- **Tercer dígito:** pares de copas correctos → **3**
- **Cuarto dígito:** las 8 vasijas sagradas → **8**

**Código final: 4-5-3-8.**

💥 Introducir el código correcto → el relicario se abre, luz dorada, **¡Maldición rota!** → pantalla final con tiempo, puntuación y logro desbloqueado: *"Héroes del Rey Aldric"*.

---

## 🧩 Mapa de uso de las 8 plantillas

| # | Plantilla | Dónde se usa |
|---|---|---|
| 1 | Llave escondida | Llave de bronce (Sala 1) |
| 2 | Código numérico | Arca del armario + sello final |
| 3 | Botones simultáneos | Estatuas de caballeros (Sala 1) |
| 4 | Combinar objetos | Mechero+vela, cáliz en ranura, llave dentro de llave |
| 5 | Puzle deslizante | Mural de la vendimia (Sala 2) |
| 6 | Memoria | Copas y barriles (Sala 2) |
| 7 | Pista dividida | Reja de la escalera (Sala 2) |
| 8 | Tuberías | Canal de agua sagrada (Sala 3) |

---

## Lecciones de diseño que esto valida

1. **Progresión de dificultad:** tutorial → exploración → combinación → clímax.
2. **Reutilización narrativa:** el cáliz viaja de la Sala 1 a la 2 (objetos con historia).
3. **Cooperativo sin bloquear al solitario:** cada puzzle cooperativo tiene un "objeto puente" para jugador solo.
4. **Pistas de repaso:** el código final exige recordar todo el castillo (rejugabilidad con puntuación).
5. **Estados compartidos:** las antorchas encendidas en Sala 2 son un estado visible sincronizado entre jugadores — perfecto para probar el motor multijugador.

---

¿Quieres que ahora documente los **estados internos y reglas de una de estas plantillas** (por ejemplo, cómo el editor guardaría la lógica del puzle de memoria o de la pista dividida), o que diseñemos el **guion del jugador** (textos, diálogos y descripciones que vería el jugador al explorar)?
User: Antes de documentar eso debemos elegir el stack tecnológico
Kimi: ¡Correcto, primero el cimiento! Te propongo las decisiones clave y mis recomendaciones para este proyecto concreto (escape rooms 2D isométricas, editor web, multijugador en tiempo real, monetización).

---

# 🛠️ Decisión de stack tecnológico

## 1. Cliente (el juego y el editor) — la decisión más importante

| Opción | Pros | Contras |
|---|---|---|
| **Godot 4** | Gratis, open source, exporta a web, móvil y desktop con el mismo código; excelente para 2D isométrico; GDScript fácil; túnel de exportación a HTML5 (WebAssembly) | Comunidad menor que Unity; editor web integrado no existe (el editor de salas habría que construirlo como parte del juego) |
| **Unity** | Ecosistema enorme, assets store maduro, URP 2D isométrico sólido, WebGL exportable | Licencia fee si el proyecto escala; exportación web pesada |
| **Phaser (JS) + React** | Puro web, el editor es fácil con React; nada de installs para el jugador | Rendimiento limitado en escenas muy grandes; móvil como app requiere wrapper (Capacitor) |
| **PixiJS + React** | Similar a Phaser pero más ligero, render WebGL rápido | Menos "baterías incluidas" |

**Mi recomendación: Godot 4**, por tres razones concretas de tu proyecto:
1. **Multiplataforma desde el día uno** — si mañana quieres app móvil, no reescribes nada.
2. **El editor de salas se construye dentro del propio motor** (herramientas del propio Godot como base), unificando runtime y editor.
3. **Coste cero** hasta escala comercial.

*Alternativa si el equipo domina JavaScript: Phaser/React para web-first y evaluar móvil después.*

## 2. Multijugador en tiempo real (1–N jugadores)

| Opción | Pros | Contras |
|---|---|---|
| **WebSocket propio (Node.js + ws)** | Control total, barato | Hay que gestionar salas, reconexión, autoridad |
| **Colyseus (framework multiplayer)** | Hecho exactamente para esto: salas, estado sincronizado automático, matchmaking; funciona con Node | Menor comunidad que alternativas genéricas |
| **Photon (Unity/Godot)** | Muy maduro, gratis hasta 20 CCU | Lock-in, pricing escala rápido |
| **Nakama** | Open source, self-hosted, completo (auth, chat, storage) | Más complejo de operar |

**Mi recomendación: Colyseus sobre Node.js.** Su modelo de "room state sincronizado automáticamente con los clientes" encaja perfecto con escape rooms (todos ven el mismo estado de puzzles). El estado del juego se serializa y sincroniza solo — menos código de red que escribir.

*Si en el futuro creces mucho, migrar a Photon/Nakama no es traumático.*

## 3. Backend y base de datos

| Componente | Recomendación | Por qué |
|---|---|---|
| Lenguaje backend | **Node.js (TypeScript)** | Mismo lenguaje que Colyseus; tipado con TS |
| Base de datos principal | **PostgreSQL** | Salas (JSON para definiciones de niveles), usuarios, compras, reseñas — todo encaja; JSONB para datos flexibles del editor |
| Cache / sesiones | **Redis** | Rooms activas, presencia, rate limiting |
| Assets (imágenes, tiles) | **S3 / Cloudflare R2** | Almacenamiento de assets de salas publicadas |
| Auth | **Auth propio + JWT** o **Clerk/Supabase Auth** | MVP: JWT propio es suficiente y gratis |

**Recomendación: PostgreSQL + Redis + S3/R2.** Stack clásico, barato, escalable.

## 4. Pagos y monetización

| Opción | Notas |
|---|---|
| **Stripe** | Pagos web (tarjetas), Stripe Connect para pagar a creadores (reparto automático) — el estándar |
| **RevenueCat** | Si hay app móvil, gestiona suscripciones/compras in-app en iOS/Android |
| **PayPal** | Opcional como método adicional |

**Recomendación: Stripe + Stripe Connect** (soluciona la parte más delicada: repartir dinero a creadores).

## 5. Infraestructura y despliegue

| Capa | Recomendación |
|---|---|
| Hosting | **Docker + un VPS (Hetzner/DO)** al inicio; migrar a Kubernetes solo si escala |
| CDN | Cloudflare (gratis, assets y web) |
| CI/CD | GitHub Actions |
| Dominio/SSL | Cloudflare o Let's Encrypt |

**MVP:** un VPS con Docker corriendo Node/Colyseus + PostgreSQL + Redis. Coste inicial: **~10–20 €/mes**.

---

## 📋 Stack final propuesto (resumen)

```
Cliente (juego + editor):  Godot 4 (GDScript/TypeScript, export Web + futuro móvil)
Multijugador:              Colyseus (Node.js, WebSockets, rooms con estado sincronizado)
Backend API:               Node.js + Express/Fastify + TypeScript
Base de datos:             PostgreSQL (JSONB para definiciones de salas)
Caché/estado en vivo:      Redis
Assets:                    Cloudflare R2 (compatible S3)
Pagos:                     Stripe + Stripe Connect (reparto a creadores)
Auth:                      JWT propio (MVP)
Infra:                     Docker + VPS (Hetzner) + Cloudflare CDN + GitHub Actions
```

## ⚠️ Decisiones pendientes que afectan al stack

Antes de cerrarlo, confírmame:

1. **¿Equipo técnico?** ¿Cuántas personas, y con qué dominan (Godot, Unity, web/JS)? Esto puede cambiar la recomendación del cliente.
2. **¿Web-first o app móvil desde el inicio?** Si móvil es prioridad absoluta → Unity o Godot con export móvil; si web-first → Phaser/React es tentador.
3. **¿Escala esperada?** Si esperas picos grandes (streamers jugando en directo), Colyseus puede necesitar Redis en modo cluster pronto.
4. **¿Pagos en qué países/regiones?** Stripe no opera igual en Latinoamérica/España — si el mercado es LATAM, añadir MercadoPago podría ser necesario.

---

¿Confirmas el stack (o quieres que compare Godot vs Phaser/React con más profundidad), y seguimos con la documentación de estados de las plantillas?
User: Hay unos detalles que pueden ayudarnos a concretar el stack: no necesitamos app móvil, se juega desde ordenador, los usuarios estarán conectados en el juego mediante chat, webcam y micrófono. Antes ya he usado node como web socket e yjs para sincronizar estados, pero collyseum no lo conozco, cuéntame qué aporta frente a otro stack o a usar solo node. Estoy acostumbrado a usar next.js ¿sería mejor que react, no? Y he utilizado en algún proyecto phaser e incluso pixi.js de godot he oído hablar pero habría que comparar los 3. Descartaría unity. Para pagos basta con stripe y stripe connect. El usuario pagaría la sala e invita a sus amigos. No hace falta modo premium para creadores. Pero sí incorporaría un modo en que si quieres descargarte el escape room pagues por el.
Kimi: Con estos detalles el stack se clarifica bastante. Voy por partes:

---

# 1. Colyseus vs. tu stack actual (Node WS + Yjs)

Antes de nada, una aclaración importante: **tu stack actual y Colyseus no son excluyentes** — Colyseus *es* Node.js + WebSockets. Lo que añade son capas que hoy escribirías a mano:

| Capa | Con Node WS + Yjs a mano | Con Colyseus |
|---|---|---|
| Gestión de salas | La construyes tú (join, leave, códigos de invitación, expiración) | Incluida: `Room` classes, matchmaking por nombre, allow-list de códigos |
| Sincronización de estado | Yjs lo resuelve, pero es un CRDT: pensado para *convergencia* (colaboración), no para *autoridad* | Schema-based state sync: tú defines el estado en el servidor, los clientes reciben solo los *patches* de lo que cambió |
| Autoridad del servidor | La implementas tú sobre Yjs (Yjs es peer-to-peer por naturaleza, hay que forzar el rol de servidor) | El servidor es autoridad por diseño: validas puzzles, niegas trampas, ahí vive la lógica |
| Reconexión | A mano (guardar estado, reasignar socket) | Incluida: `allowReconnection()`, estado del jugador persistido en la room |
| Rate limiting / anti-cheat básico | A mano | El cliente solo envía *mensajes*; el estado solo lo muta el servidor |

**La distinción clave: Yjs vs. Colyseus son herramientas para problemas distintos.**

- **Yjs = CRDT** → convergencia sin autoridad. Ideal para el **editor de salas del creador** (varios co-creadores editando a la vez, o edición offline que luego sincroniza — colaborativo estilo Figma/Notion).
- **Colyseus = autoridad central** → ideal para la **partida** (el servidor decide si el código 4-5-3-8 es correcto; un cliente hackeado no puede abrir el relicario).

**Mi recomendación: híbrido.**
- Partidas → **Colyseus** (rooms con estado autoritativo)
- Editor colaborativo → **Yjs** (ya lo conoces, es la herramienta perfecta aquí)
- Chat de texto dentro de la partida → mensajes por el propio WebSocket de Colyseus (no necesita más)

## 2. Next.js vs. React

Ojo con esta: **Next.js no compite con React, es un framework de React.** La pregunta real es: ¿Next.js como shell de toda la plataforma?

**Sí, usa Next.js para todo lo que NO es el canvas del juego:**

| Módulo | Tecnología |
|---|---|
| Landing, catálogo, perfiles, checkout, dashboard del creador, blog | **Next.js** (SSR para SEO del catálogo — clave para que los jugadores encuentren salas en Google) |
| Editor de salas | Next.js + Yjs + canvas 2D (Phaser o Pixi) |
| La partida en sí | Next.js página/app que carga el cliente del juego (Phaser/Pixi) + Colyseus + WebRTC |

Tu experiencia con Next.js encaja perfecto: el catálogo de escape rooms con SEO es tu canal de adquisición de jugadores.

## 3. Godot vs. Phaser vs. PixiJS (con tus datos: solo desktop, JS, web, webcam/mic)

| | **Phaser 3** | **PixiJS** | **Godot 4** |
|---|---|---|---|
| Qué es | Motor de juego 2D completo | Solo renderizador WebGL (motor gráfico) | Motor completo multiplataforma |
| Isométrico | Soporte nativo (tilemaps isométricos, cámaras, sprites, física ligera) | Tú construyes todo (cámara, input, tilemaps, tilemap isométrico a mano) | Muy bueno, escena + tilemaps nativos |
| Lenguaje | TypeScript (tu stack) | TypeScript | GDScript / C# (curva de aprendizaje) |
| Integración con Next.js | Buena (canvas embebido, muchos ejemplos) | Buena pero haces todo a mano | Difícil: exporta a WebAssembly, comunicación JS↔Godot es incómoda; el canvas no se integra limpio en React |
| Webcam/mic/chat | Mismo WebRTC del navegador, fácil desde TS | Igual | Posible pero con fricción extra |
| Editor visual integrado | ❌ (hay editores externos como Tiled para mapas) | ❌ | ✅ (el mejor de los tres: editas escenas, animaciones, tilemaps visualmente) |
| Multiplayer en tiempo real | Tu capa (Colyseus) | Tu capa | Tu capa |

**Recomendación: Phaser 3.**

- Ya lo has usado → cero curva.
- Tilemaps isométricos, cámara, input, spritesheets: resuelto.
- Tu stack completo queda en TypeScript end-to-end (Next.js + Phaser + Colyseus + Yjs) — un solo lenguaje, un solo equipo, un solo build.
- Godot tiene mejor editor visual, pero pagarías ese beneficio con una frontera GDScript↔TypeScript/WebRTC↔React que en tu caso (web-only, chat/webcam) te estorba más de lo que ayuda. La carencia de editor de Phaser la cubres con **Tiled** (editor de mapas estándar, exporta a Phaser) + tu editor web de salas.

*PixiJS lo descartaría salvo que quieras un control render absoluto: te obligaría a construir cámara, input, tilemaps y física desde cero.*

## 4. Webcam + micrófono en las partidas

No lo habíamos previsto: esto añade una pieza nueva al stack. Opciones:

| Opción | Cuándo |
|---|---|
| **LiveKit** (open source, self-host o cloud) | Recomendado: SFU maduro, SDK de JS, salas pequeñas gratis/casi gratis, gestiona audio/vídeo de 1–N sin que tú hagas mesh routing |
| **Mesh WebRTC puro** (SimplePeer, WebRTC nativo) | Válido si N es pequeño (≤6): conexiones peer-to-peer directas, sin servidor de medios, pero calidad se degrada con N |
| **Daily / Twilio** | Rápido pero pricing por minuto, menos control |

**Recomendación: LiveKit self-hosted en el mismo VPS.** Con N pequeño (2–8 jugadores típicos en escape room) funciona sobrado, y el modelo "el que paga la sala invita a sus amigos" encaja: la room de LiveKit se crea junto a la room de Colyseus y muere con ella.

## 5. Ajustes al modelo de negocio

Confirmo los cambios:

- ❌ Sin plan premium de creadores — comisión única de plataforma en cada venta (tu 70/30, por ejemplo).
- ✅ **El comprador paga la sala y invita** a sus amigos gratis — implica: las rooms de Colyseus se crean por el comprador (host), los invitados entran con código/enlace sin pasar por checkout.
- ✅ **Nuevo: modo descargable.** El jugador puede pagar por descargar el escape room. Decisiones a tomar sobre esto:
  - **¿Formato?** Lo más viable: descargar un **cliente ejecutable** (Tauri/Electron, ligero porque es tu mismo Phaser en un wrapper) + paquete de la sala cifrado con licencia por clave. O descarga web para jugar offline en el navegador (más fácil pero sin protección real).
  - **Licencia:** clave por compra, activación online la primera vez.
  - **¿Multiplayer en el descargable?** Si el descargable es solo 1 jugador (offline), simplifica muchísimo; si quieres cooperativo también ahí, el ejecutable tiene que embeber Colyseus + LiveKit — posible pero más peso.

**Mi sugerencia:** v1 de descargable = **modo offline para 1 jugador**. Es el caso de uso natural ("me lo compro para jugar en el tren") y evita replicar infraestructura de red en el cliente.

---

## 📋 Stack final ajustado

```
Aplicación (catálogo, perfiles, checkout, dashboard):  Next.js (TypeScript)
Juego (runtime de salas):                              Phaser 3, embebido en Next.js
Editor de salas:                                       Next.js + Yjs (colaborativo) + Tiled/Phaser
Partidas (estado autoritativo, 1–N):                   Colyseus (Node.js + WebSocket)
Chat de texto:                                         Canal de la room de Colyseus
Voz y webcam:                                          LiveKit (self-hosted, WebRTC)
Base de datos:                                         PostgreSQL (JSONB para definiciones de sala)
Caché/presencia:                                       Redis
Assets:                                                Cloudflare R2
Pagos:                                                 Stripe + Stripe Connect
Descargable offline (1 jugador):                       Tauri + paquete de sala cifrado + clave de licencia
Auth:                                                  NextAuth/Auth.js (email + OAuth)
Infra:                                                 Docker + VPS (Hetzner) + Cloudflare + GitHub Actions
```

Todo el código del producto queda en **TypeScript** — incluido Colyseus, que se programa en TS nativo. Cero cambios de contexto de lenguaje.

---

¿Confirmamos este stack y pasamos a documentar los **estados internos de las 8 plantillas de puzzle** (modelo de datos + flujo en Colyseus), que era el siguiente paso pendiente?
User: Descartamos lo de descargar. Mi idea es que por ejemplo, un profe pueda crear un escape room para sus alumnos y estos jueguen gratis. Entonces como él es el creador no tiene sentido que todos sus alumnos paguen, creo que lo mejor sería que pagase por poder abrir el juego con una clave, que podrá rotar o bien generar una clave para todo un listado de de personas, que incluso esas claves podrían enviarse por correo y ya no solo serviría para profes, sino también para empresas. Sería pagar por un modo organizar partida donde se podría cobrar un euro por jugador. Con descuentos por tramos. Y poder organizar por ejemplo 10 partidas a la vez, y distribuir a la gente en grupos aleatorios o específicos. Y si se pone correo que les llegue una clave o un listado para que el profe imprima y reparta con la clave de cada uno
Kimi: ¡Este giro le da mucho sentido al producto! Pasas de "tienda de salas B2C" a **"plataforma de eventos de escape room B2B/B2Educación"**, que es un mercado mucho más claro: el que paga no es el que juega. Te lo documento como modelo de negocio actualizado.

---

# 💰 Modelo de negocio v2 — Modo "Organizar partida" (B2B / Educación)

## 1. Los tres roles de pago

| Rol | Paga | Juega |
|---|---|---|
| **Creador-vendedor** (tienda clásica, opcional) | — | Cobra 70% de sus ventas |
| **Organizador** (profe, empresa, animador) | Sí: **~1 € por jugador**, con descuentos por volumen | No (normalmente) |
| **Jugador** | No (entra gratis con su clave) | Sí |

El organizador paga una vez y reparte acceso ilimitado entre su gente. Los alumnos/empleados nunca ven un checkout.

## 2. La clave de acceso (pieza central del sistema)

Tipos de clave que soportaría el sistema:

| Tipo | Descripción | Caso de uso |
|---|---|---|
| **Clave única por jugador** | Cada asistente recibe su código individual (single-use) | Profe reparte tarjetas impresas; control de asistencia |
| **Clave rotativa** | Un código que el organizador puede **regenerar** cuando quiera (la anterior queda inválida) | Eventos con sesiones sucesivas, o si se filtra el código |
| **Clave de grupo** | Un código compartido para N personas | Grupos pequeños sin lista previa |
| **Lista de claves masiva** | Generar 30 claves de golpe → envío por email al organizador o **directamente a cada correo** de la lista | Empresas: RRHH pega la lista de empleados y cada uno recibe su invitación por mail |

**Flujo del organizador:**
1. Elige una sala (de su catálogo o del marketplace).
2. Configura la "jornada": fecha, nº de sesiones simultáneas (hasta 10), jugadores por sesión (1–N).
3. Paga: N jugadores × tarifa con descuento por tramos.
4. Recibe las claves (mail o descarga/imprime PDF tipo tarjetas con el código + nombre del asistente).

## 3. Tarifas con descuentos por tramos (propuesta)

| Jugadores | Precio/unidad |
|---|---|
| 1–15 | 1,00 € |
| 16–50 | 0,90 € |
| 51–150 | 0,75 € |
| 151+ | 0,60 € |

*(Ajustable. Un instituto de 120 alumnos pagaría ~90 € por una actividad completa — muy razonable para un centro educativo, y 10 sesiones simultáneas cubren una clase entera.)*

## 4. Distribución en grupos

El organizador decide cómo se reparte la gente:

- **Grupos específicos:** sube la lista y asigna "estos 5 correos → Sesión 3, Grupo A" (útil para mezclar equipos a propósito en empresa).
- **Grupos aleatorios:** la plataforma reparte automáticamente equilibrando por tamaño (o incluso por nivel si añades un campo "experiencia").
- **Libre:** los asistentes eligen sesión al canjear su clave, hasta agotar aforo.

Y el organizador tiene un **panel en vivo**: ve las 10 sesiones, quién ha entrado, en qué sala está cada grupo, tiempo transcurrido, progreso (opcional: para el profe es interesante ver qué puzzles atascan a cada grupo — *feedback educativo oro*).

## 5. Implicaciones técnicas de este modelo

Esto cambia/añade piezas al stack, todas asumibles:

| Pieza | Solución |
|---|---|
| **Generación masiva de claves** | Entidad `AccessKey` en PostgreSQL: `{code, eventId, sessionId?, assignedEmail?, status: unused/used/expired, singleUse}` |
| **Emails transaccionales** | Resend o Postmark (baratos, buen deliverability); PDF de tarjetas imprimibles generado con un template (p. ej. `@react-pdf/renderer`) |
| **Regenerar clave** | Endpoint simple: invalidar la antigua, crear nueva, reenviar email |
| **10 sesiones simultáneas** | Colyseus lo soporta nativo (10 rooms independientes); el "evento" es solo metadata que agrupa rooms |
| **Asignación a grupos** | Lógica en la API de Next.js al canjear la clave: según el tipo de clave → colocar en la sesión asignada o elegir |
| **Panel en vivo del organizador** | WebSocket (misma room de Colyseus en modo espectador) o polling ligero; cada grupo genera eventos de progreso anonimizados |

## 6. Qué pasa con el modo clásico (jugador compra la sala)

Coexisten los dos modos, y de hecho se alimentan entre sí:

- **Venta individual (B2C):** como estaba, jugador paga y juega con amigos — mantener, es ingreso pasivo para el creador.
- **Eventos (B2B/B2Edu):** el modelo que acabas de definir.

El creador marca en cada sala: *"Disponible para eventos: sí/no"* y puede cobrar distinto por cada modo (una sala puede ser gratis para eventos de su propio instituto — el profe-creador no se paga a sí mismo, claro: si el organizador es el propio creador, las claves le salen gratis).

## 7. Casos de uso que esto cubre (y marketing futuro)

- 🏫 **Instituto:** profe crea una sala de historia, paga 90 €, 120 alumnos en 10 grupos, panel para ver qué grupo va ganando.
- 🏢 **Empresa:** RRHH contrata team-building, reparte claves por email, grupos aleatorios mezclando departamentos.
- 🎉 **Cumpleaños/escape room físico virtual:** anfitrión paga 10 claves, invita por WhatsApp.
- 🏆 **Campeonato:** un creador organiza un torneo con 10 sesiones simultáneas y ranking por tiempo.

---

## Preguntas para cerrar este bloque

1. **¿La clave de jugador individual es de un solo uso?** (Recomiendo sí: el asistente entra una vez y su asiento queda "ocupado" — evita compartir la clave con un amigo fuera de lista.)
2. **¿El organizador puede elegir jugar él mismo?** (Sí, lógico: recibe una clave-organizador con la que puede observar o participar.)
3. **¿Caducidad?** Las claves deberían caducar (p. ej. 30 días tras la compra o a las X horas de la jornada).
4. **¿Reembolso si solo usan 80 de 100 claves?** (Recomiendo: crédito para próximos eventos, no devolución — simplifica Stripe.)
5. **¿El panel del profe muestra el progreso detallado de los puzzles?** (Educativamente es muy valioso, pero requiere que el creador etiquete puzzles con "objetivos didácticos".)

---

¿Cuando confirmes estos puntos, consolido el documento de especificaciones completo (modelo de negocio + roles + stack) y seguimos con la documentación de los **estados internos de las plantillas de puzzle** para el editor?
User: 1. Sí. Además. Molaría al enviar las invitaciones una opción de requerir confirmación y que la gente que lo recibe por email deba confirmar la invitación así el profe o o el de recursos humanos saben que todos han recibido su clave.
Kimi: 
User: 1. Sí. Además. Molaría al enviar las invitaciones una opción de requerir confirmación y que la gente que lo recibe por email deba confirmar la invitación así el profe o o el de recursos humanos saben que todos han recibido su clave. 2. Si el organizador puede jugar, así puede ayudar o simplemente observar. La clave debe caducar cuando la partida acaba si tiene límite o a las X horas que se definirán al crearlas. Si es un juego en grupo, si la sala ha sido superada por el grupo o ha pasado su tiempo, las claves ya no sirven. 4. Sin reembolso. 5. El panel enseña el estado de la partida y los puzles que se han resuelto y sus estadísticas, pero sin objetivos
Kimi: Perfecto, con esto el modelo de claves queda completo y muy sólido. Lo documento:

---

# 🔑 Ciclo de vida de la clave de acceso (definitivo)

## Estados de la clave

```
generada → enviada → confirmada → activa → usada/caducada
              ↓
         pendiente_confirmación
```

| Estado | Significado |
|---|---|
| `generada` | Creada junto al evento, aún sin asignar correo |
| `enviada` | Email enviado (individual o masivo) |
| `pendiente_confirmación` | Esperando que el asistente haga clic en "Confirmo asistencia" del email *(solo si el organizador activó "requerir confirmación")* |
| `confirmada` | El asistente confirmó — el organizador lo ve en su panel ✅ |
| `activa` | Puede canjearse por un asiento en la partida |
| `usada` | Canjeada → asiento ocupado, clave muerta (single-use, como acordamos) |
| `caducada` | Expira por cualquiera de estas reglas: |

## Reglas de caducidad (combinables, definidas al crear el evento)

1. **Por jornada:** caduca a las X horas tras la fecha/hora de inicio definida.
2. **Por sesión con límite de tiempo:** cuando la partida termina (superada o tiempo agotado), todas las claves de esa sesión mueren — nadie puede entrar a media sala resuelta.
3. **Por grupo completo:** si el grupo supera la sala, las claves no usadas de ese grupo quedan inutilizadas (la sesión ya no existe).

> Detalle fino: si el organizador configuró "grupo libre" (el asistente elige sesión al canjear), la regla 2/3 se aplica a la sesión en la que canjeó, no al evento entero.

## Flujo con confirmación (la feature que pides)

```
Organizador crea evento → activa "Requerir confirmación"
  → sube lista de correos (o genera claves sin correo)
  → cada asistente recibe email: "Has sido invitado a [Sala]. 
     Tu clave: XXXX-XXXX. Confirma tu asistencia aquí."
  → asistente hace clic → clave pasa a confirmada
  → panel del organizador muestra: 28/30 confirmados
     (con opción de reenviar email a los 2 pendientes 👉)
```

**Valor para el caso de uso:** el profe sabe que los 30 alumnos *de verdad* recibieron su clave antes del día D, y RRHH tiene confirmación formal de asistencia para el evento. Además te da métrica: tasa de confirmación = señal temprana de cuántos asientos liberar.

*Fallback necesario: si alguien nunca confirma, el organizador puede regenerar esa clave y asignarla a otro (las claves de eventos sin confirmación obligatoria saltan directo a `activa`).*

## Modos del organizador en la partida

| Modo | Qué hace |
|---|---|
| **Jugador** | Entra con clave-organizador en un grupo, juega normalmente |
| **Observador/espectador** | Ve las sesiones en vivo sin ocupar plaza de jugador; puede saltar entre las 10 sesiones (en empresa es el "game master") |
| **Híbrido** | Observa, pero puede lanzar pistas globales a un grupo desde el panel (feature potente — decidir si entra en v1 o v2) |

## Panel del organizador (definición final)

- Estado de cada sesión (en curso / finalizada / tiempo agotado).
- Progreso por grupo: **qué puzzles han resuelto y cuánto tiempo han tardado en cada uno** (estadísticas puras: % de resolución, media de tiempo por puzzle — sin etiquetado de objetivos didácticos, como acordamos).
- Claves: cuántas enviadas, confirmadas, usadas, caducadas; reenviar/regenerar individualmente o en lote.
- Ranking entre grupos si hay varias sesiones (el profe proyecta el panel en la pizarra y las 10 clases compiten 😄).

---

## Actualización del modelo de datos (entidades nuevas)

```
Event (jornada) ──┬── Session (partida, hasta 10 por evento)
                  │     └── Group (equipos dentro de la sesión)
                  └── AccessKey {code, email?, status, expiresAt, 
                                 confirmedAt, assignedSessionId?, 
                                 requireConfirmation}
Organizer = User con rol, puede tener clave de jugador u observador
```

Todo esto vive en PostgreSQL; las sesiones en vivo siguen siendo rooms de Colyseus que referencian `Session.id`, y el panel del organizador se suscribe a las rooms en modo espectador.

---

Con esto tenemos cerrados: **modelo de negocio completo, roles, claves, caducidades, panel, stack y narrativa de prueba**. 

¿Hacemos el **consolidado final de especificaciones** (documento único v1.0 listo para empezar a desarrollar), o prefieres que primero documente los **estados internos de las 8 plantillas de puzzle** y luego consolidamos todo junto?
User: Antes quiero darle una vuelta a esta pregunta: utilizarías phaser o directamente react? Y que parte va en phaser y que parte en react si usamos phaser finalmente? Es decir, los textos, puzles y demás en react o en phaser? Es decir, se hace todo en phaser o phaser Lanza un puzle en react por ejemplo y se limita a los personajes y al mapa y los objetos y sus interacciones
Kimi: Muy buena pregunta, y tiene una respuesta clara: **la arquitectura híbrida gana**. Pero te explico las tres opciones para que veas el porqué:

---

# Opción A: Todo en Phaser (Phaser renderiza el mundo + toda la UI)

Phaser puede renderizar la UI de dos formas: sprites/textos propios, o inyectando elementos DOM encima. Técnicamente posible, pero te enfrentas a:

- Formularios, inputs de texto, focus, copiar/pegar: **dolorosos fuera del DOM**.
- Accesibilidad (teclado, screen readers, contraste): casi imposible de hacer bien dentro de canvas.
- Textos largos con scroll, tooltips, markdown, emojis, i18n con plurales: el DOM lo resuelve gratis; en Phaser los reprogramas.
- Chat con historial, mensajes con formato, notificaciones: claramente DOM.

Veredicto: ❌ descartable para un juego con tanta capa de interfaz (inventario, pistas, chat, webcam, puzzles tipo formulario).

# Opción B: Todo en React (sin Phaser, isométrico en DOM/CSS)

Técnicamente puedes hacer un tilemap isométrico con `position: absolute` y transforms CSS... pero estarías re-implementando a mano:

- Orden de renderizado por profundidad (los sprites que quedan "detrás" de otros).
- Culling (no renderizar lo fuera de cámara — con 100 objetos en DOM se nota).
- Animaciones de spritesheets, tweening de movimiento, partículas, luces.
- Sistema de input de puntero sobre objetos apilados (¿a cuál hice click si hay tres solapados?).

Phaser te da todo eso resuelto y optimizado. Veredicto: ❌ reinventar la rueda con peor rendimiento.

# Opción C (recomendada): Híbrido — Phaser para el mundo, React para todo lo demás

```
┌─────────────────────────────────────────────┐
│  Capa React (DOM, encima del canvas)        │
│  ── HUD, inventario, diálogos, chat,        │
│     webcam, menús, PANTALLAS DE PUZZLE ──   │
├─────────────────────────────────────────────┤
│  Capa Phaser (canvas <canvas>)              │
│  ── mapa isométrico, personajes, objetos,   │
│     animaciones, efectos, cámara ──         │
└─────────────────────────────────────────────┘
```

## La división exacta

| Va en **Phaser** | Va en **React** |
|---|---|
| Tilemap isométrico y decoración | HUD (cronómetro, pistas restantes) |
| Avatares y su movimiento | Panel de inventario y combinación de objetos |
| Objetos interactuables del escenario (brillo, animación al pasar el ratón) | Cajas de diálogo y descripciones al inspeccionar |
| Efectos: partículas, luces, transiciones de puerta | **Puzzles modales**: candado numérico, memoria, puzle deslizante, tuberías, código de símbolos |
| Puzzles que **son físicamente parte del escenario** (ver abajo) | Chat, tiles de webcam/mic, lobby, menús |
| Cámara y zoom | Panel del organizador (si decide observar en vivo dentro del juego) |

## La regla de oro para decidir dónde va cada puzzle

> **¿El puzzle ocupa el mundo o ocupa una pantalla?**

- **Parte del mundo** → Phaser. Ejemplos: la llave escondida tras el cuadro, las placas que hay que pisar simultáneamente, el mural que se reordena visualmente en la pared. Estos son objetos interactuables del escenario con estado (Phaser los conoce).
- **Abre un panel/caja** → React. Ejemplos: el candado numérico (4 casillas + botón), el juego de memoria de las copas, el puzle deslizante como UI de inventario, las tuberías como minijuego. Son, esencialmente, **formularios e interfaces** — el terreno natural de React.

Tu ejemplo de "Phaser lanza un puzle en React" es exactamente el patrón: el jugador hace click en el arca candada (Phaser) → Phaser emite evento → React monta `<LockPuzzle code="4738" onSolve={...} />` → al resolver, React notifica al estado de partida → Phaser abre la tapa del arca con animación.

## Cómo se comunican las dos capas

- **Bus de eventos compartido**: un `EventEmitter` (o store **Zustand**, que ya encaja con React y es ligero) conectado al cliente de Colyseus. Ambas capas leen/escriben el mismo estado de partida.
- Phaser vive en un componente React (`<GameCanvas room={...} />`) montado con `useRef`; el overlay UI es simplemente HTML posicionado encima con `pointer-events: none` en el contenedor y `auto` en los elementos interactivos.
- **Colyseus vive en la capa React** y alimenta a ambas: cuando el servidor confirma "grupo B resolvió el puzzle 5", Zustand se actualiza → Phaser reproduce la animación de la puerta → React marca el puzzle en el HUD. Las dos capas reaccionan al mismo estado.

## Bonus que te llevas con este diseño

- **El editor de salas** (Next.js + React) reutiliza los componentes de puzzle de React: el creador configura el candado numérico con el mismo `<LockPuzzle>` que juega el jugador. *Componente único para editar, previsualizar y jugar.*
- Los puzzles en React son más testeables (testing-library) que los de canvas.
- i18n, temas visuales y accesibilidad de los puzzles resueltos con la infraestructura estándar de React.

## Resumen

| | ¿Qué hace? |
|---|---|
| **Phaser** | Solo el "mundo": mapa, personajes, objetos, interacciones de escenario, efectos |
| **React** | Todo lo que es UI: HUD, inventario, diálogos, chat, webcam, y los puzzles que se abren como panel |
| **Zustand + Colyseus** | El puente: estado de partida compartido entre ambas capas |

---

¿Te convence el híbrido? Si es así, seguimos con la documentación de los **estados internos de las 8 plantillas** — y verás que el candado numérico, memoria, deslizante y tuberías se definen como componentes React con su esquema de datos, mientras llave escondida, botones simultáneos y mural van como entidades del tilemap en Phaser. Es exactamente la división que acabamos de hacer.
User: Definamos eso y luego cuando acabes definiremos cómo se crean ese mapa y esos juegos desde el creador
Kimi: Vamos a ello. Defino primero el **modelo común** (válido para las 8 plantillas) y luego cada plantilla con su esquema de datos, su máquina de estados y su capa (Phaser/React).

---

# 🧩 Base común de las plantillas

Toda plantilla implementa la misma interfaz:

```typescript
interface PuzzleDefinition {
  id: string;                    // "sala1-arca-candado"
  type: PuzzleType;              // uno de los 8 tipos
  layer: 'world' | 'panel';      // Phaser o React
  roomId: string;                // sala del mapa donde vive
  position?: { x: number; y: number }; // solo si layer === 'world'
  requiresSolved: string[];      // puzzles que deben resolverse antes (encadenamiento)
  grantsItems: string[];         // objetos que da al resolverse (ej: "llave-oro")
  unlocks: string[];             // puertas/mecanismos que abre
  timeLimitSec?: number;         // opcional
}

type PuzzleState =
  | 'locked'      // existe pero no es interactivo aún (requiresSolved pendiente)
  | 'available'   // interactivo
  | 'in_progress' // alguien lo está intentando (solo informativo)
  | 'solved'      // resuelto (inmutable, con timestamp y grupo)
  | 'failed';     // agotó intentos/tiempo (si aplica)
```

Y en el estado de la room de Colyseus, cada puzzle ocupa solo esto (el cliente completo descarga la *definición* estática; la *instancia* en vivo es pequeña):

```typescript
// Estado sincronizado (room state — pequeño, va por la red)
puzzles: MapSchema<PuzzleRuntime>  // { state, solvedBy?, solvedAt?, attempts }
```

**Flujo de verificación siempre igual:** el jugador interactúa → el cliente envía `attempt` → **el servidor valida** → muta `PuzzleRuntime` → todos los clientes reaccionan (animación en Phaser / cierre de panel en React). El cliente nunca marca "solved".

---

# Las 8 plantillas

## 1. 🔑 Llave escondida — *layer: world (Phaser)*

```typescript
interface HiddenKeyDefinition extends PuzzleDefinition {
  type: 'hidden_key';
  hidingSpot: { x: number; y: number; sprite: string }; // tras el cuadro, bajo la alfombra…
  revealAnimation: 'slide' | 'fade' | 'shake';
  keyItemId: string;   // qué objeto entrega ("llave-bronce")
}
```

**Estados:** `locked → available → (click en el spot) → solved`. Sin `in_progress` (es instantáneo). La "dificultad" es puramente escenográfica: el sprite de cobertura.

**En Phaser:** el spot es un objeto interactuable invisible hasta que el jugador pasa el cursor cerca (radio de proximidad o brillo sutil). Al click → animación de reveal → emite evento al servidor.

## 2. 🔢 Código numérico — *layer: panel (React)*

```typescript
interface CodeLockDefinition extends PuzzleDefinition {
  type: 'code_lock';
  length: number;                    // 4–6 dígitos
  code: string;                      // "4738" (se guarda en servidor, jamás en el cliente)
  maxAttempts?: number;              // penalización por fuerza bruta
  lockoutSec?: number;               // bloqueo tras N fallos
  hints: HintConfig[];               // sistema de pistas pagadas
}
```

**Estados:** `locked → available → in_progress → solved` (o `failed` si agota intentos).

**En React:** `<CodeLockPuzzle length={4} maxAttempts={5} />`. El componente solo renderiza casillas y envía `attempt("4738")` al servidor; **nunca conoce el código**. El servidor responde: `correct | wrong | locked_out(30s)`. Esto hace imposible leer el código inspeccionando el cliente — importante, el código está en la definición de sala pero el binario del jugador no la contiene entera.

## 3. 🪨 Botones simultáneos — *layer: world (Phaser)*

```typescript
interface SimultaneousPlatesDefinition extends PuzzleDefinition {
  type: 'simultaneous_plates';
  plates: PlateConfig[];             // 2+ placas con posición
  windowMs: number;                  // tolerancia (ej: 800ms)
  soloBridgeItemId?: string;         // objeto que sustituye a un jugador (el cáliz real)
  holdMode: 'press' | 'stand';       // pulsar vs mantenerse encima
}
```

**Estados:** `locked → available → in_progress → solved`.

**Lógica en el servidor:** cada `plate_activated`/`plate_deactivated` llega con timestamp. El servidor comprueba que **todas las placas estén activas dentro de la ventana `windowMs`**. Si hay `soloBridgeItemId`, una placa puede quedar "permanentemente activa" colocando ese objeto — eso resuelve el modo solitario sin código especial en la lógica cooperativa.

**En Phaser:** placas como sprites con estados visuales (hundida/con luz), el avatar se para encima → evento continuo.

## 4. ⚗️ Combinar objetos — *layer: panel (React, sobre el inventario)*

```typescript
interface CombineItemsDefinition extends PuzzleDefinition {
  type: 'combine_items';
  recipes: Recipe[];  // el puzzle ES el conjunto de recetas descubribles
}

interface Recipe {
  inputs: string[];        // ["mechero", "vela"]
  output: string;          // "antorcha"
  consumeInputs: boolean;  // si los ingredientes desaparecen
}
```

**Estados:** este es especial: no tiene estado propio — **cada receta es una micro-transacción**. El servidor valida posesión de inputs → emite `items_consumed + item_granted`. Las recetas pueden ser conocidas (el jugador las prueba) o reveladas por pistas.

**En React:** drag & drop entre slots del inventario (`<InventoryPanel>`) → al soltar dos objetos → `combine(a, b)` → servidor responde con el resultado o `invalid_combination`.

## 5. 🧩 Puzle deslizante — *layer: panel (React) — opción mural en world*

```typescript
interface SlidingPuzzleDefinition extends PuzzleDefinition {
  type: 'sliding_puzzle';
  grid: { cols: number; rows: number };   // 3x3, 4x4…
  imageAsset: string;                     // el mural de la vendimia
  scramble: 'random' | 'fixed_seed';      // fijo para todos los grupos (justo en eventos)
  blankPosition: 'last' | 'random';
}
```

**Estados:** `locked → available → in_progress → solved`.

**Nota de diseño:** en el MVP el deslizante abre como panel React sobre el mural. El *mural en la pared* (Phaser) solo necesita un estado visual de 2 fotogramas: completo / incompleto. En v2 puede ser jugable directamente en la pared, pero no añade nada a la validación (el servidor recibe el array de posiciones y comprueba el orden).

**Solvabilidad:** si `scramble: random`, el servidor (o el generador en el editor) debe asegurar que la mezcla resultante sea resoluble — barajar haciendo movimientos válidos desde la posición resuelta.

## 6. 🃏 Memoria — *layer: panel (React)*

```typescript
interface MemoryPuzzleDefinition extends PuzzleDefinition {
  type: 'memory';
  pairs: PairConfig[];        // 3 pares (las copas) — cada par: {symbol, id}
  decoys?: number;            // cartas sin pareja (dificultad extra)
  maxFlipsPerTurn?: number;   // 2 por defecto
  winCondition: 'find_all_pairs' | 'find_target_pairs';
  targetPairIds?: string[];   // si winCondition = target (las parejas del mantel)
}
```

**Estados:** `locked → available → in_progress → solved`.

**Servidor:** estado por grupo: cartas volteadas este turno, parejas encontradas. Valida turnos (en cooperativo puede ser por jugador o compartido — flag `turnMode: 'shared' | 'per_player'`). **Importante para anti-trampa:** el servidor asigna los símbolos a posiciones al crear la sesión; el cliente solo recibe "carta 3 volteada = símbolo X" cuando se voltea de verdad.

## 7. 👥 Pista dividida — *layer: híbrido (Phaser el mecanismo, React la entrada)*

```typescript
interface SplitClueDefinition extends PuzzleDefinition {
  type: 'split_clue';
  viewpoints: ViewpointConfig[];   // 2 mirillas opuestas
  fragments: string[];             // ["🌙","corona","luna","espada"]
  wallOccluder: { x, y, w, h };    // el muro que impide ver ambas mitades
  soloBridgeItemId?: string;       // el espejo
  inputUI: 'symbols' | 'code';     // cómo se introduce la respuesta combinada
}
```

**Estados:** `locked → available → in_progress → solved`.

**La parte bonita:** la restricción física (no puedes ver ambas mitades) vive en **Phaser** (occlusión por posición de cámara/avatar), pero la *verificación* es servidor: cada jugador solo recibe del servidor el fragmento que su avatar puede ver (`visible_fragments[playerId]`). El espejo (`soloBridgeItemId`) añade el segundo fragmento a la visión del jugador solo. La entrada de la respuesta combinada es un panel React (mismo componente que el código numérico, variante símbolos).

## 8. 🔧 Tuberías — *layer: panel (React)*

```typescript
interface PipesPuzzleDefinition extends PuzzleDefinition {
  type: 'pipes';
  grid: { cols: number; rows: number };
  cellTypes: CellType[];   // recto, curva, tee, cruz (cada una con rotaciones)
  startCell: { x, y };
  endCell: { x, y };
  blockedCells?: { x, y, opensWithItem?: string }[]; // compuerta que pide la llave de oro
  solution?: Rotation[][]; // opcional: guardada en servidor para validación rápida
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** cada rotación de celda se envía; el servidor calcula conectividad start→end (flood fill). Más elegante que comparar con solución única (puede haber varias válidas). El agua fluye visualmente en Phaser **en el mundo** (el canal es escenario), pero el puzzle interactivo es el panel React.

---

# 📦 Resumen: dónde vive cada cosa

| Plantilla | Interacción | Verificación | UI |
|---|---|---|---|
| 1. Llave escondida | Phaser | Servidor (click válido?) | — |
| 2. Código numérico | React panel | Servidor (compara código) | `<CodeLockPuzzle>` |
| 3. Botones simultáneos | Phaser | Servidor (ventana temporal) | — |
| 4. Combinar objetos | React (inventario) | Servidor (receta) | `<InventoryPanel>` |
| 5. Puzle deslizante | React panel | Servidor (orden de piezas) | `<SlidingPuzzle>` |
| 6. Memoria | React panel | Servidor (parejas, turnos) | `<MemoryPuzzle>` |
| 7. Pista dividida | Phaser (visión) + React (entrada) | Servidor (fragmentos visibles) | `<SymbolInput>` |
| 8. Tuberías | React panel | Servidor (flood fill) | `<PipesPuzzle>` |

**Patrón que se repite:** definición estática (JSON, editable en el editor) → instancia viva mínima en Colyseus → validación siempre en servidor → reacción en la capa correspondiente. Los componentes React de puzzle son **puros y reutilizables**: el mismo `<MemoryPuzzle>` sirve para jugar y para previsualizar en el editor.

---

Con esto cerramos la capa de juego. Cuando quieras pasamos a **cómo el creador construye el mapa y estos puzzles desde el editor**: el flujo (colocar tiles → objetos → conectar puzzles con reglas `SI/ENTONCES`), el formato de exportación de la sala (JSON que luego consume el runtime), y cómo el editor usa Yjs para colaboración. ¿Seguimos?
User: Seguimos
Kimi: Vamos con el editor. Esta es la pieza que más valor tiene para el creador, así que la documento completa: arquitectura, formato de sala, flujo de creación y colaboración.

---

# 🛠️ El Editor de Salas — Documentación

## 1. Decisión de arquitectura clave: el editor ES el runtime

**El editor no es un programa separado del juego — es el propio runtime en "modo edición".**

```
Mismo Phaser, mismo código de render, mismos componentes React de puzzle.
La única diferencia: en edición hay herramientas (selección, arrastre,
palette) y los cambios se escriben en el documento Yjs en vez de leerse.
```

¿Por qué esta decisión y no un editor aparte (tipo Tiled)?

- **WYSIWYG absoluto:** lo que el creador ve es *exactamente* lo que el jugador jugará — mismas animaciones, mismas luces, mismos componentes de puzzle.
- **Los componentes de puzzle son los mismos** (`<MemoryPuzzle>` se monta en modo "demo" dentro del editor para configurarlo).
- Un solo código que mantener. El riesgo clásico "en el editor se ve bien y en el juego falla" desaparece.

Consecuencia: el editor es una página de Next.js (`/editor/[roomId]`) que carga el runtime de Phaser con flag `mode: 'edit'`.

## 2. El formato de la sala (Room Definition JSON)

Todo lo que define una sala es **un solo documento JSON**, que es exactamente lo que el runtime del jugador descarga. Este es el contrato entre editor, base de datos y juego:

```typescript
interface RoomPackage {
  meta: {
    id: string;
    title: string;
    authorId: string;
    version: string;           // "1.2.0" — versionado para parches
    theme: string;             // "medieval", "scifi"…
    description: string;
    language: string;
    estimatedMinutes: number;
    difficulty: 1 | 2 | 3;
    players: { min: number; max: number };
    assetsManifest: string;    // referencia a R2 (tileset, sprites, audio)
  };

  map: {
    tileset: string;           // referencia a assets
    layers: TileLayer[];       // suelo, paredes, decoración, objetos
    rooms: SubRoom[];          // divisiones internas (Salón, Bodega, Catacumbas)
    spawnPoints: SpawnPoint[]; // uno por jugador + observador
    lighting: LightConfig[];
  };

  objects: WorldObject[];      // interactuables del escenario:
                              // puertas, cajones, estatuas, placa de presión…

  items: ItemDef[];            // catálogo de objetos: llaves, cáliz, mechero…

  puzzles: PuzzleDefinition[]; // las 8 plantillas (lo definido en el mensaje anterior)

  rules: Rule[];              // la lógica SI/ENTONCES que conecta todo

  dialogs: LocalizedText[];   // todos los textos (i18n desde la base)
  hints: HintDef[];           // sistema de pistas
}
```

**Ejemplo de la regla del brasero** ("El Maldición del Rey Aldric"):

```typescript
{
  id: "rule-encender-brasero",
  trigger: { type: "on_interact", objectId: "brasero" },
  conditions: [
    { type: "item_in_inventory", itemId: "antorcha", consumed: true }
  ],
  actions: [
    { type: "set_object_state", objectId: "brasero", state: "lit" },
    { type: "reveal_number", objectId: "brasero-inscription", value: "3" },
    { type: "show_dialog", dialogId: "brasero-encendido" }
  ]
}
```

**Vocabulario de la regla (MVP):**

| | Tipos |
|---|---|
| **Triggers** | `on_interact`, `on_enter_room`, `on_puzzle_solved`, `on_item_collected`, `on_timer`, `on_all_players_in_zone` |
| **Conditions** | `item_in_inventory`, `puzzle_state_is`, `flag_is`, `player_count_min/max`, `time_remaining_below` |
| **Actions** | `set_object_state`, `unlock_door`, `grant_item`, `consume_item`, `show_dialog`, `start_timer`, `play_sound`, `spawn_effect`, `open_panel_puzzle` |

*(Este vocabulario cubre las 8 plantillas y el escape room de ejemplo al completo. Se extiende por plugin en v2.)*

**Regla de oro del formato:** el JSON es *declarativo*. El runtime no ejecuta scripts del creador — ejecuta datos. Esto da validación, seguridad (sin código arbitrario) y permite que el servidor (Colyseus) evalúe reglas con la misma definición, sin confiar en el cliente.

## 3. Flujo de creación en el editor (UX)

```
PASO 1 · ESCENARIO        PASO 2 · OBJETOS          PASO 3 · PUZZLES          PASO 4 · LÓGICA              PASO 5 · PROBAR Y PUBLICAR
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ Pintar tiles    │      │ Colocar puertas,│      │ Insertar        │      │ Grafo de reglas │      │ Playtest en vivo│
│ con palette     │  →   │ cajones, placas │  →   │ plantillas de   │  →   │ (vista nodo):   │  →   │ (botón "Jugar"  │
│ (brush, fill,   │      │ desde palette.  │      │ puzzle,         │      │ conectar        │      │ sin salir del   │
│ borrador)       │      │ Renombrar IDs.  │      │ configurar cada │      │ trigger→action  │      │ editor)         │
│                 │      │                 │      │ una en su panel │      │ arrastrando     │      │                 │
│ Layers: suelo/  │      │                 │      │ (¡mismo comp.   │      │                 │      │ Checklist auto: │
│ pared/decoración│      │                 │      │ que en juego!)  │      │                 │      │ solvable? dead  │
└─────────────────┘      └─────────────────┘      └─────────────────┘      └─────────────────┘      │ ends? faltan    │
                                                                                                      │ pistas? → PUBLICAR
```

**Detalles importantes de UX:**

- **IDs legibles por humanos:** al colocar el arca, el editor propone `id: "arca-trono"` (editable). Los textos de pistas referencian estos IDs — es lo que hace mantenible una sala grande.
- **Panel de propiedades contextual:** click en objeto → inspector a la derecha (posición, sprite, estado inicial, reglas que lo tocan).
- **Validador automático** que corre en cada cambio:
  - 🔴 "El puzzle `candado-arca` requiere `llave-bronce`, pero ninguna regla lo otorga" *(objeto huérfano)*
  - 🔴 "La puerta `salida-bodega` no se abre nunca" *(dead end)*
  - 🟡 "Ninguna pista referencia el código del candado" *(puzzle infranquecible sin pista)*
  - 🟢 "Ruta de solución posible en ~45 min" *(simulador simple de ruta crítica)*
- **Playtest:** botón que crea una room de Colyseus temporal con tu borrador. Puedes jugar tu propia sala sin publicarla. Compartir borrador a un amigo con link de prueba (no aparece en el catálogo).

## 4. Colaboración con Yjs

El documento de la sala **es un Yjs doc** — la fuente de verdad en memoria, con PostgreSQL como persistencia:

```
Yjs Doc  ←──(updates binarios, incremental)──→  PostgreSQL (tabla room_updates)
   │                                                   │
   ├── mapa (tiles)                                    └── snapshots cada N minutos
   ├── objetos                                             (reconstrucción rápida)
   ├── puzzles
   ├── rules
   └── Yjs Awareness (cursores, selección, quién edita qué)
```

- **Cada cambio** (pintar un tile, mover un objeto) es una transacción Yjs → update binario → se persiste. Sin "guardar" manual: *autosave continuo*.
- **Awareness** muestra cursores de colaboradores ("María está editando el puzzle del brasero").
- **Offline:** el creador puede trabajar sin conexión; al reconectar, Yjs mergea (CRDT — no hay conflictos de "último gana"). Un profe prepara la sala en el tren y sincroniza al llegar al instituto.
- **Historial:** como guardas todos los updates, tienes versionado gratis → "Restaurar a como estaba ayer a las 18:00".

**API de persistencia (Next.js/Route handlers):**

```
GET  /api/rooms/:id/doc        → snapshot + updates posteriores
POST /api/rooms/:id/update     → append de update binario (auth + permiso de edición)
GET  /api/rooms/:id/history    → lista de snapshots
```

## 5. Draft vs. Publicado

```
PostgreSQL
├── room_drafts     ← Yjs doc vivo (edición, colaborativo, cambia constantemente)
└── room_versions   ← inmutable, una fila por versión publicada
     └── v1.0.0: RoomPackage JSON congelado + assets empaquetados en R2
```

- Publicar = congelar el JSON, validarlo en servidor, subir assets a R2 con hash, crear fila en `room_versions`. Lo que juega la gente **nunca cambia en caliente**.
- Parche = nueva versión. Los jugadores con sala comprada reciben la nueva versión (y los eventos ya vendidos pueden pinchar la versión original — flag en `Event`).
- El runtime del jugador descarga `room_versions` → JSON → ese JSON es lo que definimos en la sección 2. **Mismo formato en editor, en BD y en juego.** Un solo contrato.

## 6. Checklist del editor (MVP vs. v2)

| | MVP | v2 |
|---|---|---|
| Tiles y mapa | ✅ Brush + fill + layers | Plantillas de salas, autotiling |
| Objetos | ✅ Colocar + estados | Animaciones custom, scripts visuales |
| Puzzles | ✅ 8 plantillas | Plugin system para puzzles custom |
| Reglas | ✅ Trigger/condición/acción fijo | Condiciones anidadas (AND/OR), variables |
| Colaboración | ✅ Yjs en tiempo real + offline | Comentarios en el mapa (como Figma) |
| Assets | Tileset temático incluido (medieval) | Subida de assets propios |
| Playtest | ✅ Solo + link de prueba | Playtest con amigos (room temporal) |
| Validador | ✅ Reglas básicas + dead ends | Simulador de solvabilidad completo |

---

Con esto tenemos ya **toda la arquitectura definida de punta a punta**: negocio → claves/eventos → stack → runtime → puzzles → editor → formato de datos.

El paso natural ahora es **consolidar todo en el documento de especificaciones v1.0** (estructurado, sin los hilos de la conversación, listo para desarrollar y para enseñar a colaboradores). ¿Te lo genero como documento descargable (Markdown o DOCX), y cerramos con una lista de tareas/tickets ordenados para arrancar el desarrollo?
User: Creo que es interesante que desde el primer momento creemos un mcp para el creador que nos permita crear el escape room que tenemos organizado desde el agente IA del chat
Kimi: ¡Excelente decisión! Y encaja de forma natural con lo que ya tenemos: si el **formato de la sala es un JSON declarativo** y el editor escribe en esa misma API, entonces un MCP es simplemente **un cliente más de la misma API** — el agente IA edita salas por la puerta grande, no por una vía paralela. El escape room de ejemplo que diseñamos se podría construir entero desde el chat.

---

# 🤖 MCP del Creador — "Crear salas conversando con IA"

## 1. Filosofía de diseño: el MCP no es una vía aparte

```
        ┌──────────────────────────────────────┐
        │        API de salas (Next.js)        │
        │  REST + WebSocket (misma para todos) │
        └───────┬──────────────┬───────────────┘
                │              │
     ┌──────────┴───┐    ┌─────┴──────────┐
     │ Editor visual│    │ Servidor MCP   │
     │ (Phaser/Yjs) │    │ (TypeScript)   │
     └──────────────┘    └─────┬──────────┘
                               │
                    ┌──────────┴───────┐
                    │  Chat con agente │
                    │  (Claude, etc.)  │
                    └──────────────────┘
```

**Principio rector:** *todo lo que el editor visual puede hacer, el MCP puede hacerlo, y viceversa.* Misma validación, mismo draft, mismo playtest. El agente es "otro par de manos" en el editor — de hecho, con Yjs podrías tener **al agente y al humano editando la sala a la vez** (el agente aparece como colaborador).

## 2. Herramientas del MCP (toolset)

Organizadas por fase de creación, con esquemas Zod (el MCP tipa los inputs):

### Fase A — Estructura
| Tool | Descripción |
|---|---|
| `create_room(meta)` | Crea draft: título, tema, idioma, dificultad, nº jugadores |
| `set_map({tileset, size, layers})` | Define dimensiones y tileset |
| `paint_tiles({layer, cells: [{x,y,tileId}]})` | Pinta celdas (el "brush" del agente) |
| `define_subrooms([{id, name, bounds}])` | Salas internas (Salón, Bodega, Catacumbas) |

### Fase B — Contenido
| Tool | Descripción |
|---|---|
| `add_object({id, type, position, sprite, initialState})` | Puertas, cajones, estatuas, placas, escondites |
| `define_item({id, name, icon})` | Catálogo de objetos |
| `add_puzzle({id, type, config})` | Las 8 plantillas con su config (code, recetas, placas…) |
| `add_dialog({id, text, conditions?})` | Textos narrativos |
| `add_hint({puzzleId, tier, text, cost})` | Sistema de pistas |

### Fase C — Lógica
| Tool | Descripción |
|---|---|
| `add_rule({trigger, conditions, actions})` | La lógica SI/ENTONCES |
| `get_room_graph()` | Devuelve el grafo actual (puzzles, objetos, reglas) para que el agente **razone sobre él** |

### Fase D — Verificación y publicación
| Tool | Descripción |
|---|---|
| `validate()` | Corre el validador: dead ends, objetos huérfanos, solvabilidad. Devuelve errores/avisos legibles |
| `preview()` | Devuelve URL de previsualización en modo playtest |
| `publish({versionNotes})` | Congela versión (con checklist obligatoria superada) |

### Fase E — Consulta (contexto para el agente)
| Tool | Descripción |
|---|---|
| `get_room()` | Estado completo del draft como JSON |
| `get_template_catalog()` | Catálogo de plantillas con sus esquemas (para que el agente sepa qué configs son válidas) |

## 3. El patrón clave: validación + dry-run en cada tool

Cada tool que muta (`add_puzzle`, `add_rule`…) hace:

```
1. Valida el input contra el esquema de la plantilla (Zod)
2. Ejecuta en modo dry-run → genera el JSON resultante
3. Corre el validador incrementar
4. Si hay errores → los devuelve al agente con mensaje accionable:
   "❌ add_rule falló: el objeto 'salida-bodega' no existe. 
    Objetos disponibles: [...]"
5. Si es válido → commit al Yjs doc (¡mismo canal que el editor visual!)
```

Esto es lo que hace que el agente sea **fiable**: no escribe JSON a ciegas y espera lo mejor — cada paso tiene *feedback estructurado*, y el validador que ya definimos para el editor humano es exactamente el mismo que corrige al agente.

## 4. Ejemplo real: crear el Rey Aldric desde el chat

```
Usuario:  Crea una escape room medieval de 3 salas para 4 jugadores:
          "La Maldición del Rey Aldric". Aquí va el diseño [pega narrativa]

Agente:   ✅ create_room(meta) — draft creado: #room_812
          ✅ set_map — castillo 40×30, tileset medieval, 3 subrooms
          ✅ add_object × 12 — trono, 4 retratos, armario, 2 estatuas,
             brasero, arca, puerta-bodega…
          ✅ define_item × 6 — llave-bronce, mechero, vela, antorcha,
             cáliz-real, llave-oro
          ✅ add_puzzle × 8 — (las plantillas: hidden_key, code_lock×2,
             simultaneous_plates, sliding_puzzle, memory, split_clue, pipes)
          ✅ add_dialog × 5 — profecía, pergamino bodega, inscripciones…
          ✅ add_rule × 14 — encendido del brasero, placas simultáneas,
             cáliz en ranura, reja con mirillas, canal de agua…

Agente:   ⚠️ validate() — 2 avisos:
          1. Ninguna pista referencia el 3er dígito del sello final
          2. La receta "mechero+vela→antorcha" no se otorga a ninguna regla

Usuario:  Añade una pista en el brasero y deja que la receta se descubra
          por prueba y error

Agente:   ✅ add_hint → vinculada a candado-arca, tier 2
          ✅ publish({versionNotes: "v1.0 — sala inicial"}) 
          → Sala publicada. URL de playtest: https://…/play/812/test
```

Media hora de conversación ≈ el escape room completo, jugable. El profe sin conocimientos técnicos le describe su clase de historia al chat y obtiene una sala funcional que luego puede retocar a mano en el editor visual (o seguir iterando por chat).

## 5. Implementación técnica

```
packages/
├── mcp-server/          ← @modelcontextprotocol/sdk (TypeScript)
│   ├── tools/           ← un módulo por tool (schemas + handler)
│   ├── lib/
│   │   ├── roomApi.ts   ← cliente HTTP de tu API de salas (¡el mismo
│   │   │                  que usa el editor visual!)
│   │   └── validator.ts ← validador compartido (importado del monorepo)
│   └── index.ts         ← server setup (stdio + streamable HTTP)
├── editor/              ← Next.js (editor visual)
├── game/                ← runtime Phaser
└── shared/
    ├── schemas/         ← Zod: PuzzleDefinition, Rule, RoomPackage…
    └── templates/       ← catálogo de las 8 plantillas con sus configs
```

**Decisiones concretas:**

- **Comparte los esquemas Zod** entre editor, API y MCP (`packages/shared`). El MCP nunca define sus propios tipos — importa los mismos `PuzzleDefinition` que el runtime. Cero deriva.
- **Transporte:** stdio (para desarrollo local con Claude Desktop) + HTTP streamable (para integrarlo en tu propia web: el chat del creador dentro de Next.js habla con el MCP por HTTP).
- **Auth por OAuth** del MCP (el estándar lo soporta): el agente actúa con los permisos del creador autenticado — no puede tocar salas ajenas.
- **Límites de seguridad:** el agente solo opera sobre *drafts*. `publish()` exige que la validación esté en verde y pida confirmación explícita (el humano aprueba el "git push" de la sala).
- **Coste de tokens:** `get_room()` puede devolver salas grandes. Herramientas de *vista* filtradas (`get_puzzle(id)`, `get_rules_for(objectId)`) para que el agente no tenga que cargar todo el documento en cada paso.

## 6. Por qué construirlo DESDE el primer momento (tu intuición es correcta)

1. **Te fuerza a formalizar el contrato temprano.** Si el editor visual tolera estados inconsistentes, el MCP se rompe — así que el validador y los esquemas se hacen bien desde el día 1, y el editor humano se beneficia.
2. **Es tu test E2E perpetuo.** Crear "El Rey Aldric" por chat es el test de aceptación de toda la plataforma: si el agente puede construir una sala jugable, el editor visual también puede.
3. **Es el diferenciador comercial.** "Crea tu escape room describiéndolo a la IA" es un claim potente frente a herramientas tipo Genially o Educaplay.
4. **Las salas de ejemplo se fabrican solas.** Marketing, tutoriales, plantillas temáticas: el agente las genera.
5. **El grafo de salas se vuelve consultable.** `get_room_graph()` abre la puerta a agentes que analizan dificultad, equilibrio, tiempos — o que adaptan salas existentes ("haz esta sala más fácil para 12 años").

---

## Ajuste al stack final

```
+ packages/mcp-server     (TypeScript, MCP SDK, comparte schemas del monorepo)
+ Chat del creador en Next.js  (UI conversacional → MCP por HTTP)
```

El stack queda: **Next.js + Phaser + Colyseus + Yjs + PostgreSQL/Redis/R2 + Stripe Connect + LiveKit + MCP**.

---

Ahora sí tenemos el producto completo de punta a punta. ¿Consolido todo en el **documento de especificaciones v1.0 descargable** (Markdown o DOCX) incluyendo el MCP, y te preparo una **hoja de ruta de desarrollo por fases con tickets** para arrancar?
User: Si, prepáralos
Kimi: Listo. Aquí tienes los dos documentos, en Markdown y en DOCX (por si quieres editarlos en Word o compartirlos):

**📘 Especificaciones v1.0** — el consolidado completo de todo lo que definimos:
- Visión, actores y modelo de negocio completo (venta B2C + eventos B2B, claves, ciclo de vida, tarifas, panel del organizador)
- Stack tecnológico y arquitectura híbrida Phaser/React con Zustand + Colyseus
- Las 8 plantillas con sus esquemas TypeScript y validaciones de servidor
- Formato RoomPackage y sistema de reglas declarativo SI/ENTONCES
- Editor de salas (arquitectura, Yjs, validador, draft vs. publicado)
- MCP del creador con el toolset completo
- Modelo de datos, infraestructura y seguridad

**📗 Roadmap** — 6 fases (0–6) con ~45 tickets numerados, cada una con hito demostrable:
- Fase 0–2: cimientos → runtime → las 8 plantillas y el Rey Aldric completo con voz/webcam (la demo estrella)
- Fase 3–4: editor visual y MCP (con el criterio de aceptación: el Rey Aldric construido entero por chat)
- Fase 5: pagos, eventos y claves (el profesor con 30 alumnos como hito)
- Fase 6: endurecimiento y lanzamiento, con dependencias, equipo estimado (1 dev: ~8-10 meses; 3 devs: ~6) y riesgos con mitigación

El orden de fases tiene truco deliberado: **primero el runtime y el MCP, después el editor visual**. Así validas el corazón del producto con demos tempranas y el editor se apoya en el formato JSON ya probado, en vez de arriesgar el proyecto al esfuerzo más grande desde el principio.

¿Quieres que ajuste algo (nombres, precios, plazos) o generemos además el esqueleto del monorepo con los `packages` y los schemas Zod iniciales de `shared`?
User: no puedo descargar los documentos que has dicho que has generado, solo nos necesito en md
Kimi: Entendido, te los pego directamente aquí en Markdown para que los copies sin depender de descargas.

---

# 📘 DOCUMENTO 1 — Especificaciones v1.0

```markdown
# EscapeRoom Creator — Especificaciones v1.0

**Plataforma de creación, venta y juego de escape rooms 2D isométricos cooperativos (1–N jugadores) desde navegador.**

Documento consolidado de especificaciones. Fecha: 2026-09-21. Estado: v1.0 aprobado para iniciar desarrollo.

---

## 1. Resumen ejecutivo

Plataforma web donde:

- **Creadores** diseñan escape rooms estilo RPG isométrico con un editor visual, o **conversando con un agente IA** a través de un servidor MCP integrado.
- **Jugadores** juegan salas cooperativas en tiempo real (movimiento, chat, voz y webcam) resolviendo puzzles explorando escenarios.
- **Organizadores** (profesores, empresas, animadores) compran "eventos": pagan ~1 € por jugador y reciben claves de acceso individuales para repartir entre sus asistentes, con panel de seguimiento en vivo.

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

### 3.3 Claves de acc
User: mejor con descargas
Kimi: Los archivos están generados correctamente. Aquí los tienes con los enlaces de descarga:

**📘 Especificaciones v1.0** (Markdown)


**📗 Roadmap de desarrollo y tickets** (Markdown)


Y por si los prefieres en Word:

- 
- 

Pincha en cada enlace para descargarlo. Si sigues sin poder descargarlos, dímelo y pego el contenido completo directamente en el chat para que lo copies.
User: Tras tener esto que podríamos seguir planificando? El resto de juegos? Más cosas del creador? Del motor de juego?
Kimi: Buena pregunta de madurez del proyecto. Lo que tenemos ya cubre el "mínimo para empezar a programar", pero hay varios frentes que conviene planificar antes de escribir código (más barato cambiar documentos que código). Te los ordeno por valor/urgencia:

---

## 🅰️ Corto plazo — conviene cerrarlo ANTES de empezar a desarrollar

### 1. Motor de reglas y estado global (lo más importante pendiente)
Definimos los triggers/acciones del MVP pero falta el detalle fino:
- **Variables y flags de partida** (el cáliz se ha usado, cuántas pistas quedan, contadores).
- **Prioridad y orden de evaluación** de reglas cuando varias saltan a la vez (¿qué pasa si entras a la sala resolviendo dos puzzles en el mismo tick?).
- **Reglas con retraso** ("3 segundos después de abrir la puerta, se apagan las luces" — el scare del terror).
- **Guardas idempotentes** (que una regla no dispare dos veces).

Sin esto, el motor de reglas se reescribe en la Fase 1. Es mi recomendación nº 1.

### 2. Sistema de objetos del mundo
- Catálogo de estados posibles de un `WorldObject` (abierto/cerrado/encendido/roto...).
- Objetos con inventario interno (el cajón que contiene la llave).
- Objetos animados vs. estáticos, y su representación en el tilemap.

### 3. Modelo de audio
Música ambiental por sala, efectos de interacción, voces del narrador... y sobre todo: **¿los creadores suben audio propio o usan una biblioteca incluida?** (licencias y moderación dependen de esto).

### 4. Onboarding y tutorial del primer creador
La curva "registro → primera sala publicada" es tu embudo de conversión. Un wizard de 5 pasos ("Elige tema → pinta una sala → coloca un puzzle → prueba → publica") merece diseño propio.

---

## 🅱️ Medio plazo — durante desarrollo, antes de las fases indicadas

### 5. Catálogo expandido de plantillas (v2)
Ya sabemos cómo se define una plantilla — podemos diseñar las 15-20 siguientes: cronómetros con penalización, puzzles de luz y sombras, códigos con física de peso, secuencias de campanas, mapas que se dibujan al explorar, puzzles con NPCs que mienten... Cada uno es un schema + componente React, ahora es barato diseñarlos sobre papel.

### 6. Temáticas y assets
- Definir los **packs temáticos v1** (medieval, terror, sci-fi, egipcio) y qué incluye cada uno: tileset, sprites de avatar, objetos, efectos, música.
- Esto fija el alcance artístico del MVP — ahora mismo es una caja negra.

### 7. Analítica y eventos de negocio
Qué se mide desde el día 1: funnel de compra, tasa de abandono por puzzle (¡oro para los creadores!), confirmación de invitaciones, NPS de eventos. Cambiar analítica a posteriori cuesta carísimo.

### 8. Economía fina de eventos
Tarifas, descuentos, cupones para institutos/empresas, facturación B2B (¿factura con IVA para colegios?), límites por tramo. Stripe Connect tiene implicaciones fiscales según país que conviene mapear ya.

---

## 🅲️ Largo plazo / exploratorio

### 9. Motor de juego v2 (ambición)
- Zonas con niebla de guerra, día/noche, clima.
- NPCs con diálogos ramificados (árbold de conversación en el editor).
- Física básica (objetos que ruedan, agua que sube de nivel — puzzles con tiempo real).

### 10. Marketplace avanzado
- Licencias de salas entre creadores (el profe compra una sala de otro creador para su evento — ¿cómo se reparte?).
- Temporadas, retos semanales, salas destacadas.

### 11. Modo torneo y clasificaciones globales
Competitivo por tiempo con anti-cheat reforzado.

### 12. API pública + webhooks
Para que empresas integren eventos en sus plataformas (RRHH que lanza un evento desde su HRIS).

---

## Mi recomendación de orden

| Orden | Bloque | Por qué |
|---|---|---|
| 1️⃣ | **Motor de reglas y estado global** (A1) + **objetos del mundo** (A2) | Son el corazón del runtime; si arrancamos Fase 1 sin ellos, se reescribe |
| 2️⃣ | **Audio** (A3) + **packs temáticos** (B6) | Fijan alcance artístico y de licencias |
| 3️⃣ | **Onboarding** (A4) + **analítica** (B7) + **economía de eventos** (B8) | Necesarios antes de las Fases 5–6 |
| 4️⃣ | Plantillas v2 (B5) y resto | Cuando el MVP esté en marcha |

---

¿Por dónde empezamos? Mi voto es claro: **el motor de reglas y estado global** — es lo único de la lista que bloquea directamente la Fase 1 del roadmap, y el resto puede planificarse más adelante sin riesgo.
User: dame un archivo .md con todo esto: el punto 1; el punto 2 y el punto 3. los creadores pueden utilizar la librería, subir sus audios o generarlos con la api de elevenlabs, en la app podrán comprar créditos que les servirán para generar este tipo de cosas con IA, se usarán los tokens a nivel de plataforma; los ususarios tendrán espacios personales / organizaciones que podrán crear ilimitadas, toda esta aprte de usuarios, organizaciones y leadger de créditos ya está desarrollada en SLXD, se puede copiar de ahí. el punto 4 y 5. el 6. definamos ahora mismo solo que neceseitamos a nivel gráfico para el scape room de prueba de la v1, más adelante lo ampliaremos. el punto 7 bien definido, además con todos los eventos del juego. el 8. podemos detallar un poco más el business plan, pero ya lo tenemos bastante potente. el 9 tamibén detallemlo, el 10. el 11 habrá un ranking por scape rooms solamente; el 12. anota las ideas en el .md
Kimi: Listo. He generado el documento con los 12 puntos, integrando tus precisiones:

**📄 Planificación ampliada (puntos 1–12) — Markdown**


**📄 Mismo documento en Word, por si lo necesitas**


Lo que incorpora de tus indicaciones:

- **Punto 3 (audio):** tres fuentes — biblioteca incluida, subida propia y generación con **ElevenLabs**. Los créditos IA se compran en la app, funcionan como **tokens a nivel de plataforma** (pool interno que la plataforma canjea en su cuenta global de ElevenLabs, con margen), y todo el subsistema de **usuarios, organizaciones ilimitadas y ledger de créditos se copia de SLXD** tal como está.
- **Punto 6 (gráficos v1):** alcance cerrado para el escape room de prueba: ~35 tiles + ~20 sprites + 1 atlas de avatar con tintado por color + HUD mínimo. Todo encargable como un único pack.
- **Punto 7 (analítica):** taxonomía completa de eventos del juego (sesión, gameplay por puzzle, claves/eventos y negocio), funnels clave, métrica norte con alerta automática de "puzzle con >40 % de abandono" al creador, y regla de implementación server-side.
- **Punto 11 (ranking):** ranking **por escape room únicamente**, con tabla propia por sala, categorías por tamaño de grupo, y modo clasificación que exige jugar sin pistas y con bitácora verificada por servidor.
- **Puntos 9, 10 y 12:** detallados (motor v2, marketplace con licencias entre creadores y suscripción de centros, API pública con webhooks y SSO).

También añadí al final una tabla que cruza cada punto con la fase del roadmap donde se ataca, para que quede claro qué es bloqueante (puntos 1 y 2, antes de la Fase 1) y qué es post-MVP.

¿Seguimos con algo más o con esto ya tienes el paquete completo para arrancar?
User: Los 8 primeros puzzles para el escape room de juegos los tenemos muy detallados, completos, podemos hacer el resto con ese nivel de detalle?
Kimi: Listo. Las 15 plantillas v2 documentadas con el mismo nivel de detalle que las 8 del MVP:

**📄 Especificación de plantillas v2 — Markdown**


**📄 Mismo documento en Word**


Lo que contiene, por plantilla:

- **Interfaz TypeScript completa** de su definición (config + constantes), como las 8 originales.
- **Máquina de estados** y runtime (contadores, roles, sub-estados como `released` en multi-cerradura o `solved_A/solved_B` en desafío por equipos).
- **Validación en servidor** descrita algorítmicamente: el flood-fill eléctrico del circuito y de luz/espejos, el trazado de rayo por BFS, el grafo de rotaciones de engranajes, la precomputación de permutaciones en palillos, los timestamps corregidos en timing (con el patrón generado en servidor para que no se pueda leer del binario).
- **Anti-trampa específico** donde aplica (pesos secretos, melodía que solo "suena" remota, sopa de letras generada por sesión).
- **Ejemplo narrativo** de cada una, la mayoría enriqueciendo el Rey Aldric o sus variantes v2.

Y al final, tres secciones transversales que salieron del ejercicio:

1. **Tabla comparativa** de las 15 (capa, tipo de validación, si admite múltiples soluciones válidas).
2. **Patrón sub-puzzle confirmado:** B4 y C2 referencian otras plantillas — el editor y el validador deben soportar referencias cruzadas entre puzzles.
3. **Nota de arquitectura importante:** los simuladores (rayo, engranajes, alcanzabilidad de palillos) deben vivir en `packages/shared` para que los reutilicen el runtime, el validador del editor **y el MCP** — el agente podrá así responder "¿es esta sala resoluble?".

Con esto el catálogo completo son **23 plantillas especificadas** (8 MVP + 15 v2) — más que suficiente para una hoja de ruta de contenido de 2–3 años. ¿Seguimos con algo más o cerramos aquí?
User: con qué cosas podríamos seguir?
Kimi: Buen momento para hacer inventario. Lo que ya tenemos cerrado: modelo de negocio, stack, arquitectura, motor de reglas, 23 plantillas especificadas, editor, MCP, analítica, roadmap con tickets y gráficos v1. Lo que queda pendiente, ordenado por el valor que aporta ahora:

---

## 🥇 Alto valor — especificar ANTES de programar (cambiar documentos es gratis, cambiar código no)

### 1. El RoomPackage completo del Rey Aldric
El formato JSON de sala solo lo hemos visto por fragmentos. Construir **el documento JSON real e íntegro** del escape room de ejemplo (3 salas, 8 puzzles, 14 reglas, items, diálogos) lograría tres cosas a la vez:
- Validar que el formato RoomPackage realmente puede expresar todo lo diseñado.
- Servir de **fixture de pruebas** permanente para el runtime (test E2E: "carga el Rey Aldric y verifica que se puede completar").
- Ser la primera "plantilla de referencia" para el MCP y el onboarding.

### 2. Especificación de mensajes y protocolo (Colyseus)
Qué mensajes viajan cliente↔servidor exactamente: `attempt`, `plate_activated`, `combine`, `chat_message`, `hint_request`... con sus payloads, quién puede enviar qué, y qué broadcasts genera cada uno. Es el contrato que escribirá quien programe el servidor — ahora mismo está solo en nuestras cabezas.

### 3. Esquema SQL completo + migraciones
El modelo de datos está a nivel de entidades; falta el DDL real (tipos, índices, constraints, claves foráneas, particionado de `analytics_events`, TTL de `access_keys`...). Copiar el ledger de créditos desde SLXD requiere documentar qué tablas llegan y cómo se adaptan.

### 4. API REST del backend
Endpoints concretos: auth, catálogo, compras, eventos/claves, generación de PDF, webhook de Stripe. Con esto alguien podría empezar el backend sin hacernos preguntas.

### 5. Diseño UX de las pantallas clave
No hacen falta mockups pixel-perfect, pero sí los flujos en wireframe de baja fidelidad: **lobby de partida** (esperando a los amigos, con webcam), **panel del organizador en vivo**, **flujo de canje de clave para el jugador invitado** (el alumno que solo tiene un código). El flujo del invitado es tu puerta de entrada — si es confuso, la primera impresión del producto muere ahí.

---

## 🥈 Valor medio — conviene antes de las fases 3–5

### 6. Wireframes + arquitectura de componentes del editor
Vista nodo del grafo de reglas (¿usamos React Flow?), inspector, palette... los componentes React concretos del editor. El editor es la fase más grande del roadmap; cuanto más se descomponga antes, mejor.

### 7. Plan de pruebas y QA
- **Test de solvabilidad automático:** algoritmo que recorra el grafo puzzle→regla→puzzle y compruebe que existe al menos una secuencia de resolución completa (ya lo mencionamos; falta especificarlo).
- **Protocolo de playtest humano** para la beta cerrada.
- Estrategia de tests E2E con Playwright (la partida completa del Rey Aldric como suite de regresión).

### 8. Plan de moderación de contenido
Pipeline concreto: qué se revisa automático vs. humano, tiempos objetivo, escalado de reportes, política de strikes. Con menores de por medio (aulas) esto es legalmente sensible.

### 9. Arquitectura LiveKit en detalle
Configuración de rooms (¿una por partida o una por evento?), gestión de ancho de banda, modo "sin cámara por defecto" para eventos educativos, grabación opcional para RRHH (¿legal? ¿consentimiento?).

---

## 🥉 Menor urgencia — puede esperar a su fase

### 10. Legal: TOS, licencia UGC, RGPD/LOPDGDD, protección de menores
Antes de la beta cerrada, no antes.

### 11. Estrategia de contenido de lanzamiento
Salas oficiales temáticas por asignatura, calendario de marketing, comunidad de creadores.

### 12. Plan de escalabilidad
Cuándo y cómo se pasa de 1 VPS a más (picos por streamers, campañas escolares de septiembre...).

---

## Mi recomendación

| Orden | Bloque | Razón |
|---|---|---|
| 1 | **RoomPackage completo del Rey Aldric** (nº1) | Es el activo más multiuso: valida formato, fixture de tests, plantilla del MCP, demo de onboarding |
| 2 | **Protocolo de mensajes** (nº2) + **API REST** (nº4) | Desbloquea programar backend y servidor sin dependencias |
| 3 | **SQL completo** (nº3) | Copia del ledger SLXD ya |
| 4 | **Flujos UX del jugador invitado + panel organizador** (nº5) | El punto más débil de la experiencia actual sobre el papel |

¿Empezamos por el RoomPackage completo del Rey Aldric? Es el que más me gusta: acaba de cerrar el círculo entre todo lo que hemos diseñado (formato, reglas, plantillas, motor) y produce algo tangible y reusable.
User: quiero hacer el 1-4, el 7 y el 8 y el 9 y el 10 y el 11 y el 12, ve dándome uno a uno completo y luego te digo continúa y sigues
Kimi: Punto 1 completo. Aquí está el RoomPackage completo del Rey Aldric:

**📄 RoomPackage "La Maldición del Rey Aldric" v1.0.0 — Markdown**


**📄 Mismo documento en Word**


Qué contiene exactamente:

**El JSON completo y jugable**, con:
- **meta**: versión 1.0.0, dificultad 2, 1–4 jugadores (mínimo 1 gracias a los objetos-puente).
- **3 habitaciones** (Salón 20×14, Bodega 18×12, Catacumbas 20×20) con capas de tiles en RLE, decoraciones, spawn points de 4 jugadores e iluminación.
- **27 objetos** con sus estados y sprites (cuadro-escondite, armario, brasero, placas, mural, ranura, mirillas, relicario...).
- **9 items** y **9 puzzles** (las 8 plantillas; `code_lock` se usa dos veces: arca "4732" y sello final "4538"; `combine_items` incluye la receta de inspección "llave dentro de llave").
- **16 reglas** con prioridades, `once`, timers, delays y la doble condición del final (canal resuelto + altar flowing).
- **10 diálogos** y **5 pistas** escalonadas por tiers con coste.

**Además, tres secciones de análisis** que son lo más valioso del documento:
1. **Notas de diseño**: decisiones finas que tomamos sobre la marcha y que cualquier implementador necesita saber (el doble uso del cáliz y la regla anti-soft-lock, la doble cerradura del sello, la cadena forzada Salón→Bodega→Catacumbas vía `blockedCells` con `llave-oro`, el seed fijo del mural para justicia competitiva).
2. **Informe de validación esperado**: lo que debe decir el validador al correr sobre este paquete, incluida la secuencia de solución de 14 pasos verificada paso a paso y la estimación de duración.
3. **Uso como fixture**: el test E2E concreto (cargar el JSON, simular la secuencia con 2 clientes Colyseus, assert de victoria) y la regla de oro: **si un cambio del formato rompe este JSON, es un breaking change**.

Los dígitos quedaron coherentes con la narrativa: candado del arca **4732** (4 torres, 7 dragones, 3 brasas *solo visibles tras encender el brasero* — que fuerza la receta de la antorcha —, 2 estatuas) y sello final **4538** (4 reinos, 5 del barril del mural, 3 pares de copas, 8 vasijas), repartidos por las 3 salas para forzar el recorrido completo.

Dime **continúa** y paso al punto 2: la especificación completa de mensajes y protocolo de Colyseus (cliente↔servidor, payloads, broadcasts y permisos).
User: continúa, no los necesito en Word, en .md me bastan
Kimi: Punto 2 completo:

**📄 Protocolo de mensajes y comunicación en partida — Markdown**


El documento cubre el contrato cliente↔servidor al completo:

- **Arquitectura de rooms**: `LobbyRoom` (matchmaking), `GameRoom` (la partida, fuente de verdad en vivo) y `SpectatorRoom` (el observador del organizador, solo lectura a N partidas).
- **Fases de la partida**: `created → lobby → playing → ended/paused/aborted`, con quién puede disparar cada transición.
- **El room state sincronizado** (`GameState`): jugadores, puzzles, objetos, inventarios, flags, timers, chat — y la lista explícita de lo que **no** viaja por la red (códigos, soluciones, pesos, melodías, símbolos de memoria).
- **Todos los mensajes cliente→servidor** en tablas con payload, emisor permitido y efecto: join con clave, movimiento, interacción, apertura/intento/cierre de puzzle, combinación, pistas, placas, visión de pista dividida, chat, y control (start/pause/kick).
- **Las respuestas a `puzzle_attempt`** con su semántica exacta: `ok`, `wrong_code`, `locked_out`, `cooldown`, `not_available`, `already_resolved`, y qué broadcast acompaña a cada acierto.
- **La secuencia de join completa** incluyendo la firma del token LiveKit (con `canPublishVideo: false` por defecto en eventos educativos) y la política de reconexión.
- **Rate limiting por mensaje** (move 10/s, chat 2/s, intentos 2/s por puzzle...) y la regla de oro: **el host no valida nada — host ≠ servidor**, solo gestiona la sesión.
- **Matriz de permisos** y los puntos exactos donde se emiten los eventos de analítica del punto 7 (vía cola Redis, nunca bloqueando el game loop).

Dime **continúa** y sigo con el punto 3: el esquema SQL completo con migraciones, incluyendo qué tablas llegan copiadas de SLXD (usuarios, organizaciones y ledger de créditos) y cómo se adaptan.
