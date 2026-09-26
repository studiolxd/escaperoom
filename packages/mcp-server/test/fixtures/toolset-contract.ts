import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, it } from "vitest";
import { CREATOR_TOOL_NAMES, CREATOR_TOOLSET } from "../../src";
import { call, errorCode } from "./client";
import { ALDRIC_ROOM_ID } from "./drafts";

/**
 * Contrato común a los tres transportes (memoria, stdio, HTTP): un cliente MCP
 * del SDK ve el toolset completo con sus esquemas y las tools de consulta
 * responden sobre el draft de test.
 */
export function toolsetContract(getClient: () => Client): void {
  it("lista el toolset completo de specs/10 §2 con sus esquemas de entrada", async () => {
    const { tools } = await getClient().listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...CREATOR_TOOL_NAMES]);
    for (const tool of tools) {
      const def = CREATOR_TOOLSET.find((candidate) => candidate.name === tool.name);
      expect(tool.description).toBe(def?.description);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations).toMatchObject(def?.annotations ?? {});
      // Las meta-tools (D-12) no operan sobre un draft ni tienen ensayo
      // `dryRun`: `upload` tiene un `roomId` opcional (solo para `kind:
      // "cover_image"`), y `run_tool`/`find_tools`/`tool_schema` no mutan el
      // draft — mutan (o no) lo que la tool delegada decida.
      if (def && def.phase !== "meta" && "roomId" in def.inputSchema.shape) {
        expect(tool.inputSchema.required).toContain("roomId");
      }
      // Toda tool implementada que muta el draft admite el ensayo `dryRun` (4.4),
      // opcional. `publish` no escribe (solo pide la confirmación humana, 4.5).
      if (
        def?.run &&
        def.phase !== "meta" &&
        def.annotations.readOnlyHint === false &&
        def.name !== "publish"
      ) {
        expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).toContain("dryRun");
        expect(tool.inputSchema.required ?? []).not.toContain("dryRun");
      }
    }
    const addRule = tools.find((tool) => tool.name === "add_rule");
    expect(Object.keys(addRule?.inputSchema.properties ?? {})).toEqual([
      "roomId",
      "rule",
      "replace",
      "dryRun",
    ]);
  });

  it("get_room devuelve el draft de test como RoomPackage", async () => {
    const result = await call(getClient(), "get_room", { roomId: ALDRIC_ROOM_ID });
    expect(result.isError).toBe(false);
    const room = JSON.parse(result.text) as { meta: { title: string }; puzzles: unknown[] };
    expect(room.meta.title).toBe("La Maldición del Rey Aldric");
    expect(room.puzzles.length).toBeGreaterThan(0);
    expect(result.structured?.room).toEqual(room);
  });

  it("validate corre el validador de 2.9 sobre el draft y devuelve la checklist", async () => {
    const result = await call(getClient(), "validate", {
      roomId: ALDRIC_ROOM_ID,
      playerCounts: [4],
    });
    expect(result.isError).toBe(false);
    expect(result.structured?.ok).toBe(true);
    expect(result.structured?.publishable).toBe(true);
    expect(result.text).toContain("📋 Checklist de publicación — 0 errores");
    expect(result.text).toContain("✅");
    expect(result.text).toContain("Secuencia de solución verificada");
  });

  it("preview y publish sin playtest ni confirmación configurados responden NOT_AVAILABLE", async () => {
    const preview = await call(getClient(), "preview", { roomId: ALDRIC_ROOM_ID });
    expect(preview.isError).toBe(true);
    expect(errorCode(preview)).toBe("NOT_AVAILABLE");
    const publish = await call(getClient(), "publish", {
      roomId: ALDRIC_ROOM_ID,
      versionNotes: "v1.0",
    });
    expect(publish.isError).toBe(true);
    expect(errorCode(publish)).toBe("NOT_AVAILABLE");
  });
}
