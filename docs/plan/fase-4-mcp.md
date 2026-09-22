# Fase 4 — MCP del creador (semanas 15–16)

**Objetivo:** crear salas conversando con un agente, con paridad total respecto al editor visual.
**Depende de:** Fase 3 (mismo doc Yjs, mismo validador, misma API).
**Hito:** "crea una escape room medieval de 3 salas" → sala jugable en <30 min de conversación.

Referencias: `specs/10-mcp-del-creador.md`, `specs/13-api-rest.md` §12, `specs/22-qa-y-pruebas.md` §3.3.

---

| # | Ticket | Detalle | Spec | Criterio de aceptación |
|---|---|---|---|---|
| 4.1 | **Servidor MCP** | `@modelcontextprotocol/sdk` (TS); transporte stdio (Claude Desktop) + HTTP streamable (chat web) | `10` §5 | El servidor arranca y expone el toolset; conecta desde Claude Desktop |
| 4.2 | **Toolset estructura/contenido** | `create_room`, `set_map`, `paint_tiles`, `define_subrooms`, `add_object`, `define_item`, `add_puzzle`, `add_dialog`, `add_hint` | `10` §2 | Crear un draft completo con estos tools sobre la API |
| 4.3 | **Toolset lógica/consulta** | `add_rule`, `get_room_graph`, `get_room` + vistas filtradas (`get_puzzle`, `get_rules_for`) | `10` §2 | El agente obtiene el grafo y añade una regla válida |
| 4.4 | **Dry-run + errores accionables** | Validar → dry-run → validador incremental → commit al Yjs doc; errores legibles | `10` §3 | Un `add_rule` con objeto inexistente devuelve la lista de objetos disponibles |
| 4.5 | **validate / preview / publish** | Checklist obligatoria + confirmación humana para publicar | `10` §2, §5 | `publish` falla si el validador no está en verde |
| 4.6 | **Chat del creador en web** | UI conversacional en Next.js contra el MCP por HTTP | `10` §5 | Desde la web se crea un draft por chat sin usar Claude Desktop |
| 4.7 | **Auth OAuth y límites** | El agente actúa con permisos del creador; solo drafts; control de coste de tokens con vistas filtradas | `10` §5 | El token de un creador no puede tocar salas ajenas |
| 4.8 | **Test E2E de paridad (chat)** | Construir el Rey Aldric entero por chat y correr el test de solvabilidad | `22` §3.3 | `mcp-parity.spec.ts` en nightly produce una sala solvable equivalente |
| 4.9 | **Créditos IA + ElevenLabs** | Import del ledger SLXD, `apply_credit_movement`, botón "Generar con IA" (previsualización gratis, consumo al confirmar) | `15` §2–3, `14` §4 | Generar un audio descuenta créditos y traza `reference_id = {dialogId}:{locale}` |

## Hito 4

El agente construye el Rey Aldric completo por conversación (~30 min), la sala pasa el validador y
es publicable con confirmación humana. La paridad editor↔MCP está verificada por test.

## Nota

La **paridad es el criterio de aceptación**, no una feature aparte: si el MCP no puede hacer algo que
el editor sí, o viceversa, la fase no está cerrada (`specs/10` §1).

## Reutilización SLXD (ADR-017)

- **4.1 / 4.4 / 4.5** → `@slxd/mcp-server` (pipeline de petición, registro de tools, gate de
  confirmación).
- **4.7** → `@slxd/mcp-auth` (OAuth 2.1 PKCE + DCR), con el login resuelto contra Better Auth.
- **4.6 / 4.9** → `@slxd/ai-chat` (chat en streaming con tools y cobro por créditos).
