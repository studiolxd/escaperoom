# Fase 6 — Endurecimiento y lanzamiento (semanas 21–24)

**Objetivo:** moderación, legal, seguridad, observabilidad, beta cerrada y lanzamiento público.
**Depende de:** Fases 2–5. **Hito:** beta cerrada superando los criterios de QA y lanzamiento público.

Referencias: `specs/17-moderacion-de-contenido.md`, `specs/18-legal-rgpd-y-menores.md`,
`specs/24-operaciones-y-escalabilidad.md`, `specs/25-estrategia-de-contenido-y-lanzamiento.md`.

---

| # | Ticket | Detalle | Spec | Criterio de aceptación |
|---|---|---|---|---|
| 6.1 | **Moderación** | Pre-check (<2 s), reportes, muestreo aleatorio, cola con SLA por severidad, strikes y **apelaciones** | `17` | Un reporte crítico despublica automáticamente; una apelación se resuelve |
| 6.2 | **Legal prerequisitos** | TOS, política de privacidad, plantilla de DPA, endpoints RGPD (`data-export`, `DELETE /me`), revisión de TOS de ElevenLabs | `18` | Checklist de `specs/18` §5 completada con asesoría |
| 6.3 | **Seguridad** | Rate limiting Redis por IP+ruta, CSP, auditoría de endpoints admin, rotación de secretos | `13` §11, `24` §6 | Prueba de fuerza bruta a `redeem` queda limitada |
| 6.4 | **Observabilidad** | Logs, métricas, alertas (Uptime Kuma + Sentry), backups de Postgres con restauración probada | `24` §6 | Una caída simulada dispara alerta; un restore de backup se verifica |
| 6.5 | **Testing completo** | Suite E2E Playwright (juego, compra, evento, editor), `mcp-parity` nightly, prueba de carga de 10 sesiones | `22` §3 | Suite nightly en verde; prueba de carga sin degradación |
| 6.6 | **i18n es/en** | Extraer textos de la web y del runtime; selector de idioma | `08` §2.2 | La UI y una sala multidioma se ven en `es` e `en` |
| 6.7 | **Onboarding + landing** | Wizard de 5 pasos, sala de ejemplo (copia del Rey Aldric), ayuda contextual, landing | `20`, `25` §2 | Un creador nuevo publica una sala en <30 min |
| 6.8 | **Salas oficiales semilla** | Rey Aldric + 3 salas (misterio, historia moderna, matemáticas) antes de beta; 8–10 para lanzamiento; construidas con el MCP | `25` §1 | Cada sala oficial pasa validador y playtest humano |
| 6.9 | **Beta cerrada** | 5–10 creadores/organizadores reales; playtest humano con 5–8 grupos; canal de comunidad | `22` §4, `25` §3 | Criterios de `specs/22` §4.5 cumplidos: ≥80 % completan, ±30 % de duración, cero soft-locks |
| 6.10 | **Programa de referidos** | Créditos a ambos lados por referido convertido; se activa en beta | `25` §3.2 | Un referido completado acredita créditos a ambos |
| 6.11 | **Purga de analítica + particiones** | Job mensual de particiones y purga a 24 meses | `14` §8, §12 | El job crea la partición del mes siguiente y purga lo antiguo |
| 6.12 | **Lanzamiento público** | Contenido de marketing listo (testimonios, salas destacadas), coordinado con el lanzamiento | `25` §2.3 | Catálogo con 8–10 salas oficiales; anuncio publicado |

## Hito 6

Beta cerrada superada (criterios de QA), prerequisitos legales completados, y lanzamiento público con
catálogo semilla, onboarding funcionando y observabilidad activa.

## Orden interno recomendado

1. Seguridad y observabilidad (6.3, 6.4) antes de abrir a usuarios reales.
2. Legal (6.2) antes del primer pago/evento educativo.
3. Moderación (6.1) antes de la beta.
4. Contenido y onboarding (6.7, 6.8) antes de la beta (los playtesters los usan).
5. Beta (6.9) → referidos (6.10) → lanzamiento (6.12).

## Pico escolar

Si el lanzamiento coincide con septiembre, aplicar el plan de aprovisionamiento previo de
`specs/24-operaciones-y-escalabilidad.md` §4.2 (subir workers de cola y, si aplica, nodos Colyseus
en agosto; congelar despliegues grandes durante la ventana de riesgo).
