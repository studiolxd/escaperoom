# 20 — Onboarding del creador

Depende de `09-editor-de-salas.md` y `10-mcp-del-creador.md`. Embudo diseñado:
**registro → primera sala publicada en <30 minutos**.

---

## 1. El embudo

El tramo "registro → primera sala publicada" es el embudo de conversión del creador. Se diseña
explícitamente para minimizar el abandono:

| Paso | Abandono potencial | Mitigación |
|---|---|---|
| 1. Registro | Fricción de formulario | OAuth (Google) además de email |
| 2. Wizard iniciado | "¿por dónde empiezo?" | Wizard de 5 pasos guiado |
| 3. Primera sala creada | Miedo al lienzo vacío | Plantilla pre-rellena por tema |
| 4. Primer puzzle | No entender el modelo | Puzzle guiado + mismo componente que en juego |
| 5. Publicar | Miedo al validador | Checklist que explica cada aviso |

## 2. Wizard de 5 pasos

1. **Elige tema** (medieval primero; el pack temático v1 es medieval).
2. **Pinta tu primera sala** con una plantilla pre-rellena.
3. **Coloca 1 puzzle guiado** (el editor propone uno y lo configura contigo).
4. **Playtest** (room temporal de Colyseus; juega tu sala sin publicarla).
5. **Publicar** (o guardar borrador si aún no está lista).

## 3. Modo "sala de ejemplo"

- Al registrarse, cada creador recibe una **copia del Rey Aldric** como sala de referencia
  desmontable ("mira cómo está hecha").
- Es también la plantilla de referencia del MCP: el creador puede pedirle al agente que la
  modifique en vez de partir de cero.

## 4. Ayuda contextual

- El primer uso de cada herramienta del editor muestra un tooltip corto + enlace a un vídeo de 60 s.
- La ayuda no bloquea la interacción; es informativa y se puede desactivar.
- Los mensajes del **validador** son accionables, no crípticos: *"El puzzle `candado-arca` requiere
  `llave-bronce`, pero ninguna regla lo otorga"*.

**Decisión de diseño (6.7, no cerrada explícitamente aquí):** no existía ningún sistema de hints
en `packages/editor` (el único previo, `shared/src/hints`, es el de pistas de *puzzle* dentro de
una partida, un dominio distinto). Se implementó el mínimo que encaja con el editor actual: un
globo de ayuda por herramienta (`data-tool`), mostrado una vez y persistido en `localStorage`
(`packages/web/src/components/room-editor/editor-tool-hint.tsx`), sin backend ni tabla propia. El
**enlace al vídeo de 60 s queda pendiente**: no hay todavía infraestructura de vídeo/hosting en el
repo: el tooltip solo lleva el texto corto.

## 5. Medición

- El wizard registra el paso de abandono (`onboardingStep`) — ver `specs/16-analitica.md`.
- Funnel de adquisición de creador: visita → registro → wizard iniciado → sala creada → publicada.
- Objetivo: primera sala publicada en <30 min; se mide el tiempo real por paso.

## 6. Conexión con la estrategia de contenido

- Tras su primer **evento** (organizador), se ofrece el wizard con una CTA contextual (ver
  `specs/19-ux-pantallas-clave.md` §2 y `specs/25-estrategia-de-contenido-y-lanzamiento.md` §3.1).
- El wizard se prueba con creadores reales en la beta cerrada; su feedback se dirige al roadmap.

## 7. Dependencias

- `specs/09-editor-de-salas.md` — herramientas que el wizard enseña.
- `specs/16-analitica.md` — instrumentación de `onboardingStep`.
