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
      if (def && "roomId" in def.inputSchema.shape) {
        expect(tool.inputSchema.required).toContain("roomId");
      }
    }
    const addRule = tools.find((tool) => tool.name === "add_rule");
    expect(Object.keys(addRule?.inputSchema.properties ?? {})).toEqual([
      "roomId",
      "rule",
      "replace",
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

  it("validate corre el validador de 2.9 sobre el draft", async () => {
    const result = await call(getClient(), "validate", {
      roomId: ALDRIC_ROOM_ID,
      playerCounts: [4],
    });
    expect(result.isError).toBe(false);
    expect(result.structured?.ok).toBe(true);
    expect(result.text).toContain("✅");
    expect(result.text).toContain("Secuencia de solución verificada");
  });

  it("una tool del esqueleto devuelve el error claro de no implementado", async () => {
    const result = await call(getClient(), "preview", { roomId: ALDRIC_ROOM_ID });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("NOT_IMPLEMENTED");
    expect(result.text).toBe(
      "❌ preview: no implementado todavía (ticket 4.5). El esquema de entrada ya es el definitivo.",
    );
  });
}
