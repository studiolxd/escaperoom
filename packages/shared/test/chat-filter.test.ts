import { describe, expect, it } from "vitest";
import { censorChatText, CHAT_CENSOR_MASK, filterChatText, sanitizeChatText } from "../src/chat";

describe("filtro de lenguaje del chat (specs/17 §3)", () => {
  it("marca y censura un término tóxico sin difundir el original", () => {
    const result = filterChatText("eres un tonto");
    expect(result.filtered).toBe(true);
    expect(result.matches).toContain("tonto");
    expect(result.text).not.toContain("tonto");
    expect(result.text).toBe(`eres un ${CHAT_CENSOR_MASK.repeat(5)}`);
  });

  it("detecta variantes simples: mayúsculas, acentos y leetspeak", () => {
    expect(filterChatText("IMBÉCIL").filtered).toBe(true);
    expect(filterChatText("t0nto").filtered).toBe(true);
    expect(filterChatText("imb3cil").filtered).toBe(true);
    expect(filterChatText("t-o-n-t-o").filtered).toBe(true);
  });

  it("no censura palabras que contienen la subcadena sin ser el término", () => {
    const result = filterChatText("el báculo del oráculo no es un insulto");
    expect(result.filtered).toBe(false);
    expect(result.text).toBe("el báculo del oráculo no es un insulto");
  });

  it("deja intacto un mensaje limpio", () => {
    const result = censorChatText("buenas, ¿abrimos la puerta?");
    expect(result.filtered).toBe(false);
    expect(result.matches).toEqual([]);
    expect(result.text).toBe("buenas, ¿abrimos la puerta?");
  });

  it("desinfecta HTML y caracteres de control antes de censurar", () => {
    expect(sanitizeChatText("<b>hola</b>\u0000   mundo  ")).toBe("hola mundo");
    const result = filterChatText("<script>tonto</script>");
    expect(result.filtered).toBe(true);
    expect(result.text).not.toContain("<script>");
  });
});
