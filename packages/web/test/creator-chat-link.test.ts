import { describe, expect, it } from "vitest";
import { isSameOriginActionLink } from "../src/lib/creator-chat-protocol";

/**
 * F-31: el enlace accionable del chat del creador (botón "Confirmar
 * publicación"/"Previsualizar") viene del resultado de una tool, que puede
 * ser un MCP remoto configurado por el propio creador
 * (`CREATOR_CHAT_MCP_URL`) — un origen ajeno podría devolver un enlace de
 * phishing con ese texto.
 */
describe("isSameOriginActionLink", () => {
  const origin = "https://escape.example";

  it("acepta https del mismo origen", () => {
    expect(isSameOriginActionLink("https://escape.example/publish-confirm/abc", origin)).toBe(true);
  });

  it("rechaza un origen distinto, aunque sea https", () => {
    expect(isSameOriginActionLink("https://atacante.example/confirm", origin)).toBe(false);
  });

  it("rechaza esquemas que no son http/https", () => {
    expect(isSameOriginActionLink("javascript:alert(1)", origin)).toBe(false);
    expect(isSameOriginActionLink("data:text/html,<script>alert(1)</script>", origin)).toBe(false);
  });

  it("rechaza una URL malformada sin lanzar", () => {
    expect(isSameOriginActionLink("no es una url", origin)).toBe(false);
  });
});
