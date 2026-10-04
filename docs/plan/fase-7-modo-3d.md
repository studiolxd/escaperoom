# Fase 7 — Modo 3D

**Objetivo:** que una sala se pueda crear, editar y jugar en 3D (tercera persona), además del 2D
isométrico actual. **Spec:** `specs/27-modo-3d.md`. **Decisión:** ADR-045.
**Hito:** «La Maldición del Rey Aldric» en 3D publicada gratis en el catálogo, jugable en
cooperativo, editable desde el editor web y construible entera por MCP.

Cada encargo es una PR hecha por un agente en su propio worktree. Los encargos con brief están
en `docs/plan/modo-3d/`. Un encargo sin brief todavía tiene puntos abiertos (spec §13) que hay
que cerrar antes de escribirlo.

---

## Encargos

| # | Encargo | Depende de | Estado | Brief |
|---|---|---|---|---|
| 7.1a | Formato en `shared`: esquemas, catálogo de modelos, validador, sala de espera por defecto, dimensión fija en la base de datos | — | **Listo para lanzar** | `modo-3d/7.1a-formato-shared.md` |
| 7.1b | Documento del editor (Yjs) y comandos 3D; modelo del runtime | 7.1a | **Listo para lanzar** | `modo-3d/7.1b-documento-y-loader.md` |
| 7.2 | Catálogo y creación: selector 2D/3D, filtro y etiquetas | 7.1a | **Listo para lanzar** | `modo-3d/7.2-catalogo-y-creacion.md` |
| 7.3a | Prototipo de assets: exportador a GLB y visor, con 5 modelos de muestra | — | **Listo para lanzar** (acaba en revisión visual del usuario) | `modo-3d/7.3-assets-3d.md` |
| 7.3b | Pack completo: kit, todos los objetos, avatar, catálogo de modelos | 7.3a aprobado, 7.1a | Pendiente de A1–A4 | — |
| 7.4 | Navmesh (`nav3d`) y movimiento 3D en el servidor | 7.1a | **Listo para lanzar** | `modo-3d/7.4-navmesh-y-servidor.md` |
| 7.5 | Runtime 3D (`game-runtime/three`) | 7.1b, 7.4, 7.3a aprobado | Pendiente de A1–A4 | — |
| 7.6 | Partida web: elegir runtime, controles táctiles, sala de espera, previsualizaciones | 7.5 | Pendiente de A6 | — |
| 7.7 | Editor 3D | 7.1b, 7.5 | Pendiente de A7 | — |
| 7.8 | Modelos de creadores (GLB propios) | 7.1b, 7.7 | Pendiente de A8 | — |
| 7.9 | MCP 3D | 7.1b | **Listo para lanzar** | `modo-3d/7.9-mcp-3d.md` |
| 7.10 | Rey Aldric 3D: conversor, fixture, siembra, E2E y paridad MCP | 7.3b, 7.5–7.7, 7.9 | Pendiente de A9 | — |

## Orden

```
7.1a ──┬── 7.1b ──┬── 7.9
       ├── 7.2    │
       └── 7.4 ───┼── 7.5 ── 7.6
7.3a ── (revisión visual) ── 7.3b ──┘     └── 7.7 ── 7.8
                                                      └── 7.10
```

Primera tanda, en paralelo: **7.1a** y **7.3a**. Al integrar 7.1a: **7.1b**, **7.2** y **7.4** en
paralelo. Al integrar 7.1b: **7.9**.

## Mientras el 3D no esté completo

Crear salas 3D queda detrás de un interruptor (`ROOMS_3D_ENABLED`, apagado por defecto; lo
introduce 7.1a). Con él apagado, ni el asistente web ni `create_room` ofrecen 3D. El filtro y las
etiquetas del catálogo no dependen del interruptor. Se enciende por defecto en 7.10.

## Normas comunes de todos los encargos

Valen para cualquier agente de esta fase, además de las del `CLAUDE.md` del repo.

1. **No decidas diseño.** Todo lo que el brief no diga está en `specs/27-modo-3d.md`. Si algo no
   está en ninguno de los dos, o el código real contradice al brief, para y pregunta a la sesión
   coordinadora; no improvises.
2. **Las salas 2D no cambian.** Ningún fixture, test ni comportamiento 2D existente puede cambiar.
   Si un test 2D se rompe, el fallo está en tu cambio.
3. Antes de empezar: `git log --oneline -5` y `git merge main` si falta algún commit de la rama
   `main` local.
4. Preparación del worktree: `pnpm install`, `pnpm dev:env`, `pnpm db:migrate && pnpm db:seed`
   (nunca `pnpm db:reset`; nunca copiar el `.env` del worktree principal).
5. No levantes nada en los puertos 3000, 2567 ni 2568. Si arrancas `pnpm dev`, mira en la salida
   en qué puerto quedó.
6. Nunca mates procesos por patrón (`pkill -f`, `killall`). Solo el proceso de tu propio puerto:
   `lsof -ti :<puerto> | xargs kill`.
7. Interfaz: solo componentes de shadcn/ui para controles (ADR-019). Si falta uno:
   `pnpm --filter @escaperoom/web exec shadcn add <componente>`.
8. Textos de interfaz en `packages/web/messages/*.json`, en los seis idiomas (`es`, `en`, `fr`,
   `de`, `pt`, `nl`).
9. No hagas comprobaciones visuales por tu cuenta (ni capturas ni `curl` de páginas): la
   verificación visual la hace el usuario.
10. Antes de abrir la PR: `pnpm verify:pr` en verde. La PR describe qué se hizo, qué tests se
    añadieron y cualquier desviación del brief.
11. Al terminar, abre la PR y avisa. No la integres tú.
