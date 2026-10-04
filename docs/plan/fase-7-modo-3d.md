# Fase 7 — Modo 3D

**Objetivo:** que una sala se pueda crear, editar y jugar en 3D (tercera persona), además del 2D
isométrico actual. **Spec:** `specs/27-modo-3d.md`. **Decisión:** ADR-045.
**Hito:** «La Maldición del Rey Aldric» en 3D publicada gratis en el catálogo, jugable en
cooperativo, editable desde el editor web y construible entera por MCP.

Cada encargo es una PR hecha por un agente en su propio worktree. Los briefs están en
`docs/plan/modo-3d/`.

---

## Encargos

| # | Encargo | Depende de | Brief |
|---|---|---|---|
| 7.0 | Subir `next` a 16.3.6 (aviso crítico que hace fallar `pnpm audit --prod` y, con él, `pnpm verify:pr`) | — | `modo-3d/7.0-subir-next.md` |
| 7.1a | Formato en `shared`: esquemas, catálogo de modelos, validador, sala de espera por defecto, dimensión fija en la base de datos | 7.0 | `modo-3d/7.1a-formato-shared.md` |
| 7.1b | Documento del editor (Yjs) y comandos 3D; modelo del runtime | 7.1a | `modo-3d/7.1b-documento-y-loader.md` |
| 7.2 | Catálogo y creación: selector 2D/3D, filtro y etiquetas | 7.1a | `modo-3d/7.2-catalogo-y-creacion.md` |
| 7.3 | Pipeline de assets: exportador a GLB, optimización y visor, con siete modelos de muestra | 7.0 | `modo-3d/7.3-assets-3d.md` |
| 7.4 | Navmesh (`nav3d`) y movimiento 3D en el servidor | 7.1a | `modo-3d/7.4-navmesh-y-servidor.md` |
| 7.5 | Runtime 3D (`game-runtime/three`), incluido el modo observador | 7.1b, 7.4 | Se redacta al integrar 7.1b y 7.4 |
| 7.6 | Partida web: elegir runtime, controles táctiles, sala de espera, observador, previsualizaciones | 7.5 | Se redacta al integrar 7.5 |
| 7.7 | Editor 3D, con la distribución del editor 2D | 7.1b, 7.5 | Se redacta al integrar 7.5 |
| 7.8 | Modelos de creadores (GLB propios) y visor 3D en el panel de moderación | 7.1b, 7.7 | Se redacta al integrar 7.7 |
| 7.9 | MCP 3D | 7.1b | `modo-3d/7.9-mcp-3d.md` |
| 7.10 | Rey Aldric 3D: conversor, assets que necesite, fixture, siembra, E2E y paridad MCP | 7.3, 7.5–7.7, 7.9 | Se redacta al integrar 7.7 |

Los encargos 7.5–7.8 y 7.10 no tienen decisiones pendientes: su comportamiento está en la spec.
Su brief se escribe cuando sus dependencias estén integradas, para que cite los archivos y las
firmas reales en vez de las previstas.

## Assets bajo demanda

No hay un encargo de «pack completo». El encargo 7.3 deja el pipeline (exportar, optimizar, ver)
y siete modelos de muestra. A partir de ahí, cada modelo se genera cuando una sala lo necesita
(en la práctica, dentro de 7.10 para el Rey Aldric 3D) y se añade su entrada a
`packages/shared/src/packs/medieval-v1.models3d.json`. Mientras un modelo no exista, runtime y
editor lo pintan como una caja. Cualquier paso con coste (Magnific, Tripo) sigue la norma de
aprobación paso a paso de `tools/assets-generator/CLAUDE.md`.

## Orden

```
7.0 ──┬── 7.1a ──┬── 7.1b ──┬── 7.9
      │          ├── 7.2    │
      │          └── 7.4 ───┴── 7.5 ──┬── 7.6
      └── 7.3 ────────────────────────┼── 7.7 ── 7.8
                                      └────────── 7.10
```

1. **7.0**.
2. **7.1a** y **7.3**, en paralelo.
3. Al integrar 7.1a: **7.1b**, **7.2** y **7.4**, en paralelo.
4. Al integrar 7.1b: **7.9**. Al integrar 7.1b y 7.4: **7.5**.
5. Al integrar 7.5: **7.6** y **7.7**. Después **7.8** y **7.10**.

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
11. Si `git push` falla con «Permission … denied to suvires», usa la clave del repositorio:
    `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_studiolxd -o IdentitiesOnly=yes -o IdentityAgent=none" git push -u origin <rama>`.
12. Al terminar, abre la PR y avisa. No la integres tú.
