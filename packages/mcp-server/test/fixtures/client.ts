import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export type ToolCall = {
  isError: boolean;
  text: string;
  structured: Record<string, unknown> | undefined;
};

/** Llama a una tool y aplana el resultado para los asserts. */
export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCall> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return {
    isError: result.isError === true,
    text: content.find((block) => block.type === "text")?.text ?? "",
    structured: result.structuredContent as Record<string, unknown> | undefined,
  };
}

export function errorCode(result: ToolCall): unknown {
  return (result.structured?.error as { code?: unknown } | undefined)?.code;
}
