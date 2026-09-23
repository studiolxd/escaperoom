# 25 — Estrategia de contenido y lanzamiento

Depende de `20-onboarding-del-creador.md`, `22-qa-y-pruebas.md` (§4) y
`plan/fase-6-endurecimiento-y-lanzamiento.md`.

Problema concreto: el día que se abre el catálogo, si está vacío no hay nada que comprar **ni
nada que indexe Google** — las dos palancas de crecimiento (SEO del catálogo, salas oficiales como
marketing) dependen de que exista contenido antes de tener usuarios que lo generen.

---

## 1. Salas oficiales temáticas: el contenido semilla

### 1.1 Por qué las hace el equipo, no se espera a los creadores

Un catálogo vacío no genera confianza (un profesor no compra la primera sala publicada por un
desconocido para su clase). Las salas oficiales resuelven tres problemas a la vez:

1. **Catálogo con calidad demostrada** desde el día 1.
2. **SEO:** cada sala oficial es una ficha indexable ("escape room online de historia medieval",
   "escape room de matemáticas 2º ESO"…).
3. **Validación continua del MCP:** cada sala oficial se construye con el propio agente
   conversacional — es `mcp-parity.spec.ts` convertido en la forma normal de producir contenido de
   marketing. Si el equipo no puede construir una sala nueva por chat en un tiempo razonable, es
   señal de un problema del MCP antes de que lo note un creador externo.

### 1.2 Selección de temas

Priorizando los temas que sirven a **ambos** lados del negocio (B2C y B2B/Edu):

- **Alineados con asignaturas del currículo español:** Historia, Matemáticas, Lengua/Literatura,
  Ciencias Naturales, Inglés. Cada tema sirve como demo vendible a un profesor de esa asignatura.
- **Temáticas genéricas de entretenimiento:** misterio, fantasía, ciencia ficción, para el tráfico
  B2C puro.

| Prioridad | Tema | Público principal | Estado |
|---|---|---|---|
| 1 | Medieval / fantasía ("La Maldición del Rey Aldric") | B2C + Historia | Ya construida — referencia de diseño |
| 2 | Misterio/detective (ciencia forense básica) | B2C + Ciencias | A construir antes de beta cerrada |
| 3 | Historia moderna (p. ej. la carrera espacial) | Historia/Ciencias | A construir antes de beta cerrada |
| 4 | Matemáticas (puzzles numéricos con peso curricular real) | Matemáticas | A construir antes de beta cerrada — requiere más cuidado pedagógico |
| 5+ | Rotación mensual post-lanzamiento | Ambos | Post-lanzamiento (§1.3) |

### 1.3 Calendario de producción

- **Antes de la beta cerrada:** Rey Aldric + 3 salas más (temas 2–4) — masa crítica mínima para
  que el catálogo no parezca vacío y para dar variedad a los playtesters humanos.
- **Para el lanzamiento público** (Fase 6): 8–10 salas oficiales, cubriendo varias asignaturas y al
  menos dos rangos de dificultad.
- **Post-lanzamiento:** 1–2 salas oficiales nuevas al mes, hasta que el volumen de creadores
  externos haga innecesario producir contenido propio al mismo ritmo.
- Cada sala oficial pasa por el mismo pipeline que cualquier sala (validador + playtest humano) — no
  tiene atajo de calidad; al contrario, es la que menos margen de error tiene.

## 2. Calendario de marketing

### 2.1 Pre-lanzamiento (durante el desarrollo)

- **Contenido de blog/SEO** usando las primeras salas oficiales como gancho editorial ("cómo hemos
  diseñado un escape room de historia medieval") — contenido de proceso real, no publicidad genérica.
- **Reclutamiento de playtesters y primeros organizadores** vía la red de contactos educativos de
  Studio LXD — el mismo pool que recluta el plan de QA (no dos esfuerzos separados).

### 2.2 Beta cerrada

- Invitación limitada y explícita ("acceso anticipado"), no autoregistro abierto — el volumen bajo
  es lo que permite que la moderación la lleve el propio equipo sin externalizar.
- Se activa el **programa de referidos** en esta fase, no antes.
- Se documentan **casos de uso reales** de los primeros organizadores/profesores (con su permiso)
  como testimonios para el lanzamiento — el contenido del lanzamiento se prepara *durante* la beta.

### 2.3 Lanzamiento público (Fase 6)

- Coordinado con `6.8 Lanzamiento público` — el contenido de marketing debe estar listo **antes**
  del ticket, no en paralelo.
- Catálogo ya con 8–10 salas oficiales + las salas de la beta que pasaron moderación.
- Canales:
  - **SEO orgánico** (catálogo SSR) como canal principal y más barato.
  - **Comunidad educativa:** red de Studio LXD, asociaciones de profesores, grupos de edu-tech.
  - **Ángulo diferencial del MCP** ("crea un escape room conversando con IA") hacia comunidades de
    creadores/makers/indie-hackers (Product Hunt y similares).
  - **Redes de creadores de contenido educativo.**

### 2.4 Fuera de alcance del lanzamiento v1

**Temporadas y retos** y **programa de creadores verificados** son palancas de marketing v2:
necesitan una base de creadores y salas ya existente para tener sentido. Se activan cuando el
catálogo tenga volumen y variedad suficientes, no antes.

## 3. Comunidad de creadores

### 3.1 El embudo organizador → creador

El onboarding de 5 pasos y el funnel "el profe que organiza un evento ES un creador potencial" ya
están decididos. Lo que añade esta estrategia es el **gancho concreto**: al finalizar su primer
evento, el panel del organizador muestra una CTA contextual — *"¿Y si la próxima la creas tú?
Empieza con el wizard"* — apoyada en datos reales de su propio evento (tiempo medio, puzzles
resueltos), no una CTA genérica.

### 3.2 Programa de referidos

- Un organizador/creador invita a otro con un enlace/código propio.
- Al completar el referido su primer evento (o su primera sala publicada, según el rol), **ambos**
  reciben créditos IA gratis — recompensa a los dos lados.
- Se activa en beta cerrada, no antes.

### 3.3 Canal de comunidad

- Un espacio (Discord o foro simple) para los creadores/organizadores de la beta — mismo público
  que los playtesters, reutilizado como canal de feedback continuo hacia el roadmap.
- Fuente de los "casos de uso reales" y semillero del futuro programa de creadores verificados.

## 4. Métricas de esta estrategia

Distintas de las de producto — miden si la estrategia de contenido/marketing funciona:

- Nº de salas oficiales publicadas vs. calendario de §1.3.
- Tráfico orgánico al catálogo (por sala y agregado) y palabras clave que lo traen.
- **Tasa de conversión organizador → creador** (métrica norte de esta sección).
- Referidos enviados vs. convertidos.
- Nº de creadores activos en la comunidad vs. total registrado — proxy de qué proporción de la base
  es "comunidad" real y no cuentas pasivas.

## 5. Dependencias

- `specs/20-onboarding-del-creador.md` — wizard y CTA.
- `specs/22-qa-y-pruebas.md` §4 — playtesters y criterios de beta.
- `reference/roompackage-rey-aldric.v1.json` — sala semilla.
