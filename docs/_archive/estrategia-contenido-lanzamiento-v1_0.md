# Estrategia de contenido de lanzamiento

Acompaña a `planificacion-ampliada-puntos-1-12.md` (§4, §8.3, §10), `plan-pruebas-qa-v1.0.md` (§4) y `roadmap-desarrollo-tickets.md` (Fase 6).

Este documento cierra un problema concreto: el día que se abre el catálogo, si está vacío no hay nada que comprar **ni nada que indexe Google** — las dos palancas de crecimiento ya identificadas (SEO del catálogo, salas oficiales como marketing) dependen de que exista contenido antes de tener usuarios que lo generen. Se define aquí qué se construye, en qué orden, y cómo se coordina con la beta cerrada del plan de QA y con la fase 6 del roadmap.

---

## 1. Salas oficiales temáticas: el contenido semilla

### 1.1 Por qué las hace el equipo, no se espera a los creadores

Un catálogo vacío no genera confianza ni en jugadores ni en organizadores (un profesor no va a comprar la primera sala publicada por un desconocido para su clase). Las salas oficiales resuelven tres problemas a la vez:

1. **Catálogo con contenido de calidad demostrada** desde el día 1.
2. **SEO**: cada sala oficial es una ficha indexable ("escape room online de historia medieval", "escape room de matemáticas 2º ESO"...).
3. **Validación continua del MCP**: cada sala oficial se construye con el propio agente conversacional — es el mismo mecanismo que `mcp-parity.spec.ts` (`plan-pruebas-qa-v1.0.md` §3.3), pero en vez de una comprobación puntual, se convierte en la forma normal de producir contenido de marketing. Si el equipo no puede construir una sala nueva por chat en un tiempo razonable, es una señal de que el MCP tiene un problema antes de que lo note un creador externo.

### 1.2 Selección de temas

Dos criterios de selección, priorizando los temas que sirven a **ambos** lados del negocio a la vez (venta individual B2C y eventos educativos B2B/Edu, `especificaciones-escape-room-creator-v1.0.md` §3):

- **Alineados con asignaturas de currículo español** (perfil del cliente educativo de Studio LXD): Historia, Matemáticas, Lengua/Literatura, Ciencias Naturales, Inglés. Cada tema temático (ej. "el Rey Aldric" para Historia medieval) sirve como demo vendible directamente a un profesor de esa asignatura.
- **Temáticas genéricas de entretenimiento** (misterio, fantasía, ciencia ficción) para el tráfico B2C puro, donde el gancho es "juega con tus amigos", no el currículo.

| Prioridad | Tema | Público principal | Estado |
|---|---|---|---|
| 1 | Medieval / fantasía ("La Maldición del Rey Aldric") | B2C + Historia | Ya construida (`roompackage-rey-aldric-v1.0.md`) — es la referencia de diseño, no hace falta repetir el trabajo |
| 2 | Misterio/detective (ciencia forense básica) | B2C + Ciencias | A construir antes de beta cerrada |
| 3 | Historia moderna (p. ej. la carrera espacial) | Historia/Ciencias | A construir antes de beta cerrada |
| 4 | Matemáticas (sala con puzzles numéricos con peso curricular real, no solo ambientación) | Matemáticas | A construir antes de beta cerrada — requiere más cuidado de diseño pedagógico que el resto |
| 5+ | Rotación mensual post-lanzamiento | Ambos | Post-lanzamiento, cadencia en §1.3 |

### 1.3 Calendario de producción

- **Antes de la beta cerrada:** el Rey Aldric + 3 salas más (temas 2–4 de la tabla) — cuatro salas es la masa crítica mínima para que un catálogo no parezca vacío y para dar variedad a los playtesters humanos (`plan-pruebas-qa-v1.0.md` §4, que ya necesita "2–3 salas creadas por early creators reales" antes de arrancar — las oficiales cubren el hueco mientras esos creadores externos aún no existen).
- **Para el lanzamiento público** (Fase 6 del roadmap): 8–10 salas oficiales, cubriendo ya varias asignaturas y al menos dos rangos de dificultad.
- **Post-lanzamiento:** cadencia de 1–2 salas oficiales nuevas al mes, hasta que el volumen de salas de creadores externos haga innecesario seguir produciendo contenido propio al mismo ritmo.
- Cada sala oficial pasa por el mismo pipeline que cualquier sala: validador de solvabilidad (`plan-pruebas-qa-v1.0.md` §2) y, para las primeras, playtest humano (§4 del mismo documento) — no tiene un atajo de calidad por ser "oficial", al contrario, es la que menos margen de error tiene.

---

## 2. Calendario de marketing

### 2.1 Pre-lanzamiento (durante el desarrollo, Fases 1–5 del roadmap)

- **Waitlist** simple (landing + email) desde que exista una URL pública, antes incluso de tener producto jugable — capitaliza el SEO temprano del dominio.
- **Contenido de blog/SEO** usando las primeras salas oficiales como gancho editorial ("cómo hemos diseñado un escape room de historia medieval") — contenido real de proceso, no publicidad genérica, alineado con el propio origen conversacional del proyecto.
- **Reclutamiento de playtesters y primeros organizadores** a través de la red de contactos educativos ya existente (clientes docentes de Studio LXD) — es el mismo pool que recluta el plan de QA (`plan-pruebas-qa-v1.0.md` §4.2), no dos esfuerzos separados: quien hace de playtester en la beta cerrada es, a la vez, el primer organizador potencial real.

### 2.2 Beta cerrada

- Invitación limitada y explícita ("acceso anticipado"), no autoregistro abierto — coherente con que el volumen bajo es justo lo que permite que la moderación (`plan-moderacion-contenido-v1.0.md` §4.3) la lleve el propio equipo sin externalizar todavía.
- Se activa el **programa de referidos** (créditos gratis por organizador referido, ya anotado en `planificacion-ampliada-puntos-1-12.md` §8.3) en esta fase, no antes — no tiene sentido referir a una lista de espera sin producto.
- Se documentan **casos de uso reales** de los primeros organizadores/profesores (con su permiso) como testimonios para el lanzamiento — el contenido de marketing del lanzamiento público se prepara *durante* la beta, no se improvisa al final.

### 2.3 Lanzamiento público (Fase 6 del roadmap)

- Coordinado con el ticket `6.8 Lanzamiento público` — el contenido de marketing (testimonios, salas destacadas, anuncio) debe estar listo *antes* de ese ticket, no producirse en paralelo a él.
- Catálogo ya con 8–10 salas oficiales (§1.3) + las salas de creadores de la beta cerrada que hayan pasado moderación.
- Canales:
  - **SEO orgánico** (catálogo SSR, ya en el stack) como canal principal y más barato — es el único que no depende de gasto continuo.
  - **Comunidad educativa**: red existente de Studio LXD, asociaciones de profesores, grupos de edu-tech.
  - **Ángulo diferencial del MCP** ("crea un escape room conversando con IA") hacia comunidades de creadores/maker/indie-hackers (Product Hunt y similares) — es el gancho que ningún competidor de escape rooms físicos o genéricos de creación de juegos tiene.
  - Redes sociales de creadores de contenido educativo (mismo público que ya sigue a Studio LXD o a sus clientes).

### 2.4 Fuera de alcance del lanzamiento v1

**Temporadas y retos** y **programa de creadores verificados** (`planificacion-ampliada-puntos-1-12.md` §10) son palancas de marketing v2 — necesitan una base de creadores y de salas ya existente para tener sentido (no se puede "destacar" contenido que aún no existe en volumen). Se anotan aquí solo para que quede explícito el criterio de activación: cuando el catálogo tenga suficiente volumen y variedad de calidad como para que "destacar" y "verificar" aporten señal real, no antes.

---

## 3. Comunidad de creadores

### 3.1 El embudo ya diseñado, aplicado como estrategia de contenido

El onboarding de 5 pasos (`planificacion-ampliada-puntos-1-12.md` §4) y el funnel *"el profe que organiza un evento ES un creador potencial"* (`planificacion-ampliada-puntos-1-12.md` §8.3) ya están decididos a nivel de producto. Lo que añade este documento es el **gancho concreto** del segundo funnel: al finalizar su primer evento, el panel del organizador (`api-rest-backend-v1.0.md` §6.2, `GET /api/events/:id/dashboard`) muestra una llamada a la acción explícita — *"¿Y si la próxima la creas tú? Empieza con el wizard"* — apoyada en datos reales de su propio evento (tiempo medio, puzzles resueltos) para que no sea una CTA genérica sino contextual a lo que acaba de vivir.

### 3.2 Programa de referidos — mecánica

- Un organizador/creador invita a otro con un enlace/código propio.
- Al completar el referido su primer evento (o su primera sala publicada, según el rol), **ambos** reciben créditos IA gratis (§3.2 de `planificacion-ampliada-puntos-1-12.md`) — recompensa a ambos lados, no solo a quien refiere, para no depender solo de quien ya está convencido.
- Se activa en beta cerrada (§2.2), no antes.

### 3.3 Canal de comunidad para creadores tempranos

- Un espacio de comunidad (Discord o foro simple) para los creadores/organizadores de la beta cerrada — mismo público que los playtesters de `plan-pruebas-qa-v1.0.md` §4, reutilizado como canal de feedback continuo hacia el roadmap, no solo hacia el contenido de marketing.
- Sirve también como fuente de los "casos de uso reales" de §2.2 y como semillero natural del futuro programa de creadores verificados (§2.4) — quien participa activamente desde la beta es el candidato natural a ese programa cuando se active.

---

## 4. Métricas de esta estrategia

Distintas de las métricas de producto (`planificacion-ampliada-puntos-1-12.md` §7) — estas miden si la estrategia de contenido/marketing está funcionando, no la salud del producto en sí:

- Nº de salas oficiales publicadas vs. calendario de §1.3.
- Tráfico orgánico al catálogo (por sala y agregado) y palabras clave que lo traen.
- Tasa de conversión organizador → creador (funnel de §3.1) — métrica norte de esta sección, mide si el gancho contextual del panel realmente funciona.
- Referidos enviados vs. convertidos (§3.2).
- Nº de creadores activos en el canal de comunidad (§3.3) vs. nº total de creadores registrados — proxy de qué proporción de la base es "comunidad" real y no solo cuentas pasivas.
