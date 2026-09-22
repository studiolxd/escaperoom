# Trazabilidad

Dos matrices para garantizar que **nada se pierde** en la consolidación:

1. **Spec ↔ ticket ↔ fase** (la spec se implementa dónde).
2. **Documento archivado → documento nuevo** (el contenido antiguo vive ahora en).

---

## 1. Specs ↔ tickets

| Spec | Fase(s) | Tickets principales |
|---|---|---|
| `01-vision-y-alcance` | transversal | — (contexto) |
| `02-modelo-de-negocio` | 5 | 5.1, 5.2, 5.4–5.8, 5.10, 5.11 |
| `03-arquitectura-y-stack` | 0 | 0.1–0.5 |
| `04-runtime-juego-y-mundo` | 1, 2 | 1.1–1.3, 1.8–1.10, 2.2 |
| `05-motor-de-reglas-y-estado` | 1 | 1.4, 1.8, 1.9 |
| `06-plantillas-puzzle-mvp` | 1, 2 | 1.5–1.7, 2.3–2.7 |
| `07-plantillas-puzzle-v2` | post-v1 | — (v2) |
| `08-formato-roompackage` | 0, 1, 3 | 0.6, 1.1, 3.9, 3.10 |
| `09-editor-de-salas` | 3 | 3.1–3.9 |
| `10-mcp-del-creador` | 4 | 4.1–4.8 |
| `11-protocolo-multijugador` | 0, 1, 2 | 0.5, 1.4, 2.1–2.7 |
| `12-voz-y-webcam-livekit` | 2, 6 | 2.2, 2.11 |
| `13-api-rest` | 0, 3, 4, 5 | 0.3, 0.7, 3.9, 3.12, 4.x, 5.x |
| `14-modelo-de-datos-sql` | 0 | 0.2 (0.8 cancelado: sin import de datos de SLXD) |
| `15-audio-y-creditos-ia` | 3, 4 | 3.11, 4.9 |
| `16-analitica` | 0, 1, 5, 6 | 0.7, 1.11, 5.9, 6.11 |
| `17-moderacion-de-contenido` | 3, 6 | 3.11, 6.1 |
| `18-legal-rgpd-y-menores` | 5, 6 | 5.11, 6.2 |
| `19-ux-pantallas-clave` | 2, 5, 6 | 2.2, 5.9, 6.7 |
| `20-onboarding-del-creador` | 6 | 6.7 |
| `21-ranking-y-clasificaciones` | 5 | 5.9 |
| `22-qa-y-pruebas` | 1, 2, 6 | 1.10, 2.9, 2.12, 6.5, 6.9 |
| `23-motor-v2-marketplace-y-api-publica` | post-v1 | — (v2) |
| `24-operaciones-y-escalabilidad` | 5, 6 | 6.4, (plan pico escolar) |
| `25-estrategia-de-contenido-y-lanzamiento` | 6 | 6.7, 6.8, 6.10, 6.12 |

> Las specs **07** y **23** son explícitamente post-v1: se especifican ahora para que el roadmap no
> las reinvente, pero no tienen tickets en las fases 0–6.

## 2. Documentos archivados → destino

Los 19 documentos de `docs/_archive/` fueron la fuente de esta consolidación. Correspondencia:

| Documento antiguo | Dónde vive ahora |
|---|---|
| `conversacion.md` | Todo el contenido de producto está en `specs/01`–`specs/25`; las alternativas y comparativas en `reference/registro-de-decisiones.md`; el catálogo de juegos en `reference/catalogo-ideas-puzzles.md`; el Rey Aldric en `reference/` |
| `especificaciones-escape-room-creator-v1.0.md` | Repartido en `specs/01`–`specs/14` (visión, negocio, stack, runtime, plantillas, formato, editor, MCP, SQL) |
| `roadmap-desarrollo-tickets.md` | Expandido en `plan/00-plan-maestro.md` + `plan/fase-0` … `fase-6` |
| `planificacion-ampliada-puntos-1-12.md` | Puntos 1–2 → `specs/05`, `specs/04`; punto 3 → `specs/15`; punto 4 → `specs/20`; punto 5 → `specs/07`; punto 6 → `specs/04` §8; punto 7 → `specs/16`; punto 8 → `specs/02` §9; puntos 9–12 → `specs/23`; punto 11 → `specs/21` |
| `decisiones-cierre-huecos-v1_0.md` | **Fusionado**: licencias → `specs/02` §5 y `specs/14`; multiidioma → `specs/08` §2.2; audio por locale → `specs/15` §2.1; `pricingTier` → `specs/02` §3.2 y `specs/14` §8; `maxPlayersPerRoom` → `specs/12` §3 y `specs/14` §8; B2C una partida → `specs/02` §2.1; apelaciones → `specs/17` §7 y `specs/14` §10; cabos sueltos → `README` y specs correspondientes |
| `roompackage-rey-aldric-v1.0.md` | `reference/roompackage-rey-aldric.v1.json` (actualizado a `packageFormat` y `LocalizedText`) + `reference/rey-aldric-notas-diseno.md` |
| `plantillas-puzzle-v2-especificacion.md` | `specs/07` (íntegro) + `reference/catalogo-plantillas.md` |
| `protocolo-mensajes-colyseus.md` | `specs/11` (íntegro) |
| `esquema-sql-migraciones-v1_0.md` | `specs/14` (consolidado con todas las adendas) |
| `api-rest-backend-v1_0.md` | `specs/13` (con endpoints nuevos: licencias, RGPD, DPA, apelaciones, precios, settings, grabaciones) |
| `diseno-ux-pantallas-clave-v1_0.md` | `specs/19` |
| `arquitectura-componentes-editor-v1_0.md` | `specs/09` §4 |
| `plan-pruebas-qa-v1_0.md` | `specs/22` |
| `plan-moderacion-contenido-v1_0.md` | `specs/17` |
| `arquitectura-livekit-v1_0.md` | `specs/12` |
| `legal-tos-rgpd-menores-v1_0.md` | `specs/18` |
| `estrategia-contenido-lanzamiento-v1_0.md` | `specs/25` |
| `plan-escalabilidad-v1_0.md` | `specs/24` |

## 3. Decisiones abiertas (no se pierden)

Listadas también en `README.md`; se resuelven en las fases indicadas:

| Tema | Spec | Fase |
|---|---|---|
| `packageFormat` valor inicial | `specs/08` §6 | 1 |
| LiveKit self-hosted vs. Cloud | `specs/12` §2.2 | 2 (ticket 2.11) |
| Titularidad audio ElevenLabs / plazos fiscales / DPA | `specs/18` §2.3, §5 | 5–6 |
| Job de purga de `analyticsEvent` | `specs/14` §12 | 6 (ticket 6.11) |
| ¿"Una partida" B2C se consume al crear o al terminar? | `specs/02` §2.1 | 5 |

## 4. Verificación de cobertura

Cada documento antiguo tiene un destino explícito en la matriz §2, y cada spec tiene fase y tickets
en §1. Los puntos que en la conversación quedaron como "mejora futura" (puntos 9–12, plantillas v2,
marketplace) están especificados en `specs/07` y `specs/23`, aunque sin tickets en las fases 0–6.
