# 23 — Motor v2, marketplace y API pública

Recoge la ambición post-MVP (puntos 9, 10 y 12 de la planificación ampliada) más las palancas de
marketplace. Todo esto es **fuera de alcance de la v1**; este documento es su referencia de diseño
para que el roadmap no tenga que reinventarlas.

Depende de `03-arquitectura-y-stack.md`, `09-editor-de-salas.md`, `21-ranking-y-clasificaciones.md`.

---

## 1. Motor de juego v2

- **Niebla de guerra / zonas ocultas:** salas parcialmente ocultas hasta que se exploran (estado
  **por jugador**, no por grupo — valor de rejugabilidad).
- **Ciclo día/noche y clima:** estados de sala que cambian las reglas activas (los puzzles de luz
  funcionan solo de noche).
- **NPCs con diálogos ramificados:** árbol de conversación en el editor; condiciones por flags;
  NPCs que mienten (misterio de asesinato). Reutiliza el motor de reglas: los nodos de diálogo son
  reglas con `show_dialog` encadenadas.
- **Física básica:** objetos empujables, agua que sube de nivel en timers, plataformas móviles. El
  servidor valida posiciones finales, el cliente anima.
- **Puzzles con decaimiento:** estados que cambian si tardas (la vela se consume, la arena cae).
- **Salas multi-nivel:** pisos con cámara que sigue escaleras.
- **Editor de cinemáticas:** secuencias de cámara/parlamento para introducciones y finales.

## 2. Marketplace avanzado

- **Licencias de salas entre creadores:** base ya en v1 (`specs/02-modelo-de-negocio.md` §5). La
  versión completa añade el caso de que un organizador compre para su evento una sala de **otro**
  creador con modelo de pago único por evento (p. ej. 10 €/evento) o suscripción de centro
  educativo (X eventos/mes); el creador percibe 70 %.
- **Salas privadas de organización:** una empresa/instituto compra una sala y esta solo existe en
  su espacio (no pública).
- **Plantillas de evento:** packs "team building", "clase de historia", "cumpleaños"
  preconfigurados (sala + configuración de evento sugerida).
- **Temporadas y retos:** salas destacadas de pago, eventos oficiales de la plataforma con ranking.
- **Programa de creadores verificados:** badge, mayor visibilidad, revenue share mejorado.
- **Comisión de marketplace:** 20–30 % de plataforma sobre licencias.

## 3. Ranking avanzado

Base en v1: ranking **por sala** (`specs/21-ranking-y-clasificaciones.md`). v2 añade ranking global
multisala, torneos oficiales y temporadas.

## 4. API pública y webhooks

- **API REST pública:** lectura del catálogo, creación de eventos y generación de claves desde
  sistemas externos (el HRIS de una empresa lanza su team building sin entrar en la web).
- **API keys por organización** con scopes (`events:write`, `keys:read`) y rate limiting propio.
- **Webhooks:** `event.created`, `key.redeemed`, `session.ended`, `group.finished` (con tiempo y
  puzzles) → para que RRHH registre asistencia automáticamente.
- **SSO/SAML para organizaciones** (colegios y empresas con su propio login).
- **Exportación de resultados:** CSV/PDF de un evento completo (tiempos, puzzles, asistencia
  confirmada).
- **Embeds:** sala jugable embebida en webs de terceros (con licencia).
- **Zapier/Make:** conector no-code para el ecosistema educativo/RRHH.

## 5. Dependencias

- `specs/02-modelo-de-negocio.md` — repartos y licencias (base v1).
- `specs/05-motor-de-reglas-y-estado.md` — extensible a NPCs, clima y física.
- `specs/21-ranking-y-clasificaciones.md` — ranking base.
