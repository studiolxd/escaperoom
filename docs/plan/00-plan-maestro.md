# Plan maestro de implementación

Acompaña a `docs/specs/` (fuente de verdad técnica) y se detalla por fases en los archivos
`fase-0` … `fase-6`. La matriz completa spec↔ticket está en `00-trazabilidad.md`.

**Objetivo:** llevar las especificaciones a producto. Orden deliberado: **primero el runtime y el
MCP, después el editor visual** — así se valida el corazón del producto con demos tempranas y el
editor se apoya en el formato JSON ya probado, en vez de arriesgar el proyecto al esfuerzo mayor
desde el principio.

---

## 1. Las 7 fases

| Fase | Semanas | Objetivo | Hito demostrable |
|---|---|---|---|
| **0 — Cimientos** | 1–2 | Monorepo, infra local, auth, canvas híbrido, movimiento multijugador | Dos navegadores mueven avatares en un tilemap isométrico sincronizado |
| **1 — Runtime de juego** | 3–6 | Motor de reglas, mundo, primeras plantillas, Sala 1 del Rey Aldric | Sala 1 jugable 1–4 jugadores con llave, candado, combinación y placas |
| **2 — Cooperativo y comunicación** | 7–9 | Chat, LiveKit, plantillas restantes, sala completa | El Rey Aldric completo, 4 jugadores con voz y webcam (demo grabable) |
| **3 — Editor visual** | 10–14 | Modo edición, Yjs, inspector, grafo, validador, publicación | Un creador sin ayuda construye una sala de 1–2 habitaciones y la publica |
| **4 — MCP del creador** | 15–16 | Servidor MCP, toolset, dry-run, chat, paridad | "Crea una escape room medieval de 3 salas" → jugable en <30 min |
| **5 — Negocio** | 17–20 | Stripe, catálogo, eventos, claves, emails, PDF, panel, licencias | Un profesor compra un evento de 30 claves, las reparte, confirma y supervisa en vivo; primer cobro real |
| **6 — Endurecimiento y lanzamiento** | 21–24 | Moderación, legal, seguridad, observabilidad, beta, lanzamiento | Beta cerrada con criterios de QA cumplidos y lanzamiento público |

## 2. Dependencias entre fases

```
Fase 0 ──> Fase 1 ──> Fase 2 ──> Fase 3 ──> Fase 4
                               └──> Fase 5 (puede empezar en paralelo desde Fase 2)
Fase 2 + Fase 5 ──> Fase 6 (lanzamiento)
```

- La **Fase 5 (negocio)** puede arrancar en paralelo desde la Fase 2 (catálogo, Stripe, eventos no
  dependen del editor).
- El **validador y el test de solvabilidad** (Fase 2) son prerequisito de la publicación en Fase 3
  y del MCP en Fase 4.
- La **instrumentación de analítica** se hace desde la Fase 0/1, aunque los dashboards lleguen en
  Fase 5–6.

## 3. Trabajo bloqueante antes/dentro de Fase 1

Lo identificado como bloqueante (cambiarlo después es rehacer código):

1. **Motor de reglas y estado global** (ticket 1.4) — corazón del runtime.
2. **Sistema de objetos del mundo** (ticket 1.3) — antes de construir puzzles encima.
3. **Schemas Zod compartidos** (ticket 0.6) — formalizan el contrato RoomPackage temprano.
4. **Pack gráfico v1 encargado** (ticket 1.2) — tiene plazo de entrega externo; pedirlo ya.
5. **Analítica base instrumentada** (ticket 0.7 + 1.11) — añadirla después cuesta carísimo.
6. **Andamiaje base podado de SLXD** (ticket 0.1) — fija namespace, tooling, env y verificación; el
   resto del monorepo se construye encima (ADR-017).

## 4. Equipo

- **Mínimo viable:** 1 full-stack TS sénior (Fases 0–2) + 1 (Fases 3–4) + 1 (Fases 5–6).
- **Con un solo desarrollador:** 8–10 meses.
- **Con tres:** el roadmap es realista en ~6 meses.
- **Perfil clave:** TypeScript end-to-end (Next.js + tRPC + Phaser + Colyseus + Yjs +
  PostgreSQL/Prisma + servicios de dominio compartidos).

## 5. Riesgos principales y mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| LiveKit self-hosted falla en redes educativas/corporativas (NAT) | Alto en B2B/Edu | Probar **LiveKit Cloud** con tráfico real en Fase 2 (ticket 2.11), no al final; arquitectura desacoplada del proveedor |
| El editor visual se dispara en esfuerzo | Alto (fase más larga) | Construir primero el runtime y el MCP; el editor se apoya en el formato JSON y el validador ya probados |
| Colyseus con 10 sesiones simultáneas | Medio | Prueba de carga en Fase 5; escalar con `@colyseus/redis-presence`/`redis-driver` (preparado en `specs/24`) |
| Trampas en cliente | Alto (juego/negocio) | Regla inquebrantable: **validación siempre en servidor**; revisión de código obligatoria en PRs |
| Ambigüedad "una partida" B2C al abandonar | Medio (producto) | Cerrar el matiz antes de lanzar (decisión abierta en `specs/02`) |
| Titularidad del audio IA / plazos legales | Alto (legal) | Checklist de `specs/18` antes de aceptar primer pago/evento educativo |
| Efecto "catálogo vacío" en lanzamiento | Alto (marketing) | Salas oficiales semilla construidas con el MCP (Fase 6) desde antes de la beta |
| Deriva del formato RoomPackage | Alto (todo) | Fixture Rey Aldric como suite de regresión; cambio que lo rompe = breaking change |
| Acoplamiento indebido con SLXD al reutilizar código | Medio (arquitectura) | ADR-017 y `reference/reutilizacion-slxd.md` fijan qué se copia y qué se descarta; namespace propio; revisión en PR |
| Lógica duplicada entre puertas (tRPC / REST / MCP) | Alto (mantenimiento) | Capa de servicios de dominio única (ADR-022): ninguna puerta reimplementa lógica; regla explícita en el DoD del PR |

## 6. Criterios de hito (gate)

Cada fase se considera completa solo si:

- **Todo el set de tickets** de la fase está hecho y sus criterios de aceptación verificados.
- **CI en verde**: lint, unitarios, integración, y el test E2E del Rey Aldric (desde Fase 2).
- **El hito demostrable** se puede mostrar de punta a punta sin pasos manuales ocultos.
- **Specs actualizadas**: si la implementación forzó una decisión nueva, se refleja en `docs/specs/`
  antes de cerrar la fase (los documentos son la fuente de verdad, no el código).

## 7. Convenciones del backlog

- **IDs:** `FASE.N` (p. ej. `3.5`). No se renumeran; un ticket cancelado se marca como tal.
- **Cada ticket** declara: detalle, dependencias, spec de referencia, criterio de aceptación y su
  **DoD** (ver §8).
- Los tickets de contenido (salas oficiales) y de negocio que no bloquean se marcan como
  **paralelizables**.

## 8. Flujo de trabajo: PR y DoD

Todo el desarrollo entra por **pull request**; `main` no se toca a mano. El plan se ajusta a este
flujo: cada ticket es, como norma, **un PR**.

### 8.1 Ciclo

1. **Rama por ticket** desde `main` (`fase-N/ticket-descripcion`).
2. **PR a `main`** con el ticket como unidad; si un ticket se parte, se abren PRs separados que
   referencian el mismo ticket.
3. **CI obligatoria en verde**: `install`, `lint`, `typecheck`, `test` y `build` (el E2E del Rey
   Aldric desde Fase 2). La puerta local es `scripts/verify.sh`.
4. **Revisión**: al menos una aprobación. Regla inquebrantable: la validación de juego vive en el
   servidor; un PR que mueva validación al cliente no se fusiona.
5. **Sin divergencia de specs**: si el PR fuerza una decisión nueva, se actualiza `docs/specs/` (y el
   ADR correspondiente) **en el mismo PR**.
6. **Squash merge** y borrado de rama; el título del PR referencia el ticket (`0.1: …`).

Excepción (sin PR): cambios puramente documentales de bajo riesgo que el responsable autoriza
explícitamente en la conversación.

### 8.2 DoD (Definition of Done)

Un ticket/PR está "hecho" solo si se cumple **todo**:

- [ ] **Criterio de aceptación** del ticket verificado (no "parece que funciona": evidencia).
- [ ] **Tests** al nivel que corresponda (unitario/integración/E2E) y en verde.
- [ ] **CI en verde**: lint, typecheck, test, build.
- [ ] **Specs/ADR actualizados** si hubo decisión nueva; si no, se declara explícitamente que no hubo.
- [ ] **Trazabilidad** anotada en `00-trazabilidad.md` si cambia el mapeo spec↔ticket.
- [ ] **Sin secretos** ni datos reales en el diff; sin validación movida al cliente.
- [ ] **Hito demostrable** de la fase, si el ticket cierra la fase: reproducible sin pasos ocultos.

Un PR no se fusiona con criterios pendientes sin marcar; lo que quede fuera se anota como ticket
nuevo (no se renombra el actual).
