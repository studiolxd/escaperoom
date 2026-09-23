import type Anthropic from "@anthropic-ai/sdk";
import { ANONYMOUS_ACTOR, type Actor } from "@escaperoom/shared/services";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import { deepMergeMessages, type Messages } from "../src/i18n/messages";
import {
  applyChatEvent,
  initialCreatorChatState,
  startUserMessage,
  type CreatorChatState,
} from "../src/lib/creator-chat-state";
import { ChatProviderError, createAnthropicChatProvider } from "../src/server/creator-chat";

// ---------------------------------------------------------------------------
// Página SSR del chat del creador (ticket 4.6) renderizada fuera de Next, como
// catalog-pages.test.ts: se sustituyen cabeceras, sesión y navegación.
// ---------------------------------------------------------------------------

const MESSAGES: Record<string, Messages> = Object.fromEntries(
  Object.entries({ es, en, fr, de, nl, pt }).map(([locale, messages]) => [
    locale,
    deepMergeMessages(es, messages),
  ]),
);

const state = vi.hoisted(() => ({ actor: null as unknown }));

vi.mock("@/server/context", () => ({
  resolveActorFromHeaders: async () => state.actor,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement("a", { ...rest, href: `/es${href}` }, children as never),
  usePathname: () => "/creator/chat",
  useRouter: () => ({ replace() {} }),
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTranslator({ locale, messages: MESSAGES[locale] ?? es, namespace: namespace as never }),
}));

const { default: CreatorChatPage } = await import("../src/app/[locale]/creator/chat/page");
const { CreatorChat } = await import("../src/components/creator-chat/creator-chat");

const AUTHOR: Actor = { userId: "autora", organizationId: null, role: "member" };
const ROOM_ID = "0b6f4c0e-5d1a-4c55-9d7c-8f1f2a3b4c5d";

function render(element: ReactElement, locale = "es"): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: MESSAGES[locale],
      timeZone: "UTC",
      children: element,
    }),
  );
}

const pageProps = (locale: string, roomId?: string) => ({
  params: Promise.resolve({ locale }),
  searchParams: Promise.resolve(roomId ? { roomId } : {}),
});

const savedKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  state.actor = AUTHOR;
  process.env.ANTHROPIC_API_KEY = "sk-test-no-se-usa";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe("página /[locale]/creator/chat — render SSR", () => {
  it("con clave y sesión pinta el chat vacío con su formulario", async () => {
    const html = render(await CreatorChatPage(pageProps("es")));
    expect(html).toContain("<h1");
    expect(html).toContain("Chat del creador");
    expect(html).toContain("<textarea");
    expect(html).toContain("Escribe tu mensaje…");
    expect(html).toContain("Aún no hay borrador");
  });

  it("con ?roomId= ofrece abrir ese draft en el editor", async () => {
    const html = render(await CreatorChatPage(pageProps("es", ROOM_ID)));
    expect(html).toContain(`href="/es/editor/${ROOM_ID}"`);
    expect(html).toContain("Abrir el borrador en el editor");
  });

  it("sin ANTHROPIC_API_KEY muestra que el chat no está configurado", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const html = render(await CreatorChatPage(pageProps("es")));
    expect(html).toContain("no está configurado");
    expect(html).not.toContain("<textarea");
  });

  it("sin sesión pide iniciarla", async () => {
    state.actor = ANONYMOUS_ACTOR;
    const html = render(await CreatorChatPage(pageProps("en")), "en");
    expect(html).toContain("Sign in to use the creator chat.");
    expect(html).not.toContain("<textarea");
  });

  it("está traducida en los 6 locales", async () => {
    const titles = new Set<string>();
    for (const locale of ["es", "en", "fr", "de", "nl", "pt"]) {
      const html = render(await CreatorChatPage(pageProps(locale)), locale);
      const title = /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1];
      expect(title).toBeTruthy();
      titles.add(title!);
    }
    expect(titles.size).toBe(6);
  });
});

describe("hilo del chat — llamadas a tools, errores y enlaces", () => {
  it("pinta texto, tools con su resultado o error accionable y el enlace de confirmación", () => {
    let chat: CreatorChatState = startUserMessage(initialCreatorChatState(), "Crea la sala");
    const events = [
      { type: "conversation", conversationId: "c1", roomId: null },
      { type: "text", delta: "Creo " },
      { type: "text", delta: "la sala." },
      { type: "tool_call", id: "t1", name: "create_room", input: { meta: { title: "X" } } },
      {
        type: "tool_result",
        id: "t1",
        name: "create_room",
        isError: false,
        text: `✅ create_room — draft creado: ${ROOM_ID}`,
        code: null,
        link: null,
      },
      { type: "room", roomId: ROOM_ID },
      { type: "tool_call", id: "t2", name: "add_object", input: {} },
      {
        type: "tool_result",
        id: "t2",
        name: "add_object",
        isError: true,
        text: '❌ add_object: No existe la habitación "bodega". Habitaciones disponibles: [laboratorio]',
        code: "NOT_FOUND",
        link: null,
      },
      { type: "tool_call", id: "t3", name: "publish", input: {} },
      {
        type: "tool_result",
        id: "t3",
        name: "publish",
        isError: false,
        text: "⏸️ publish — solicitud creada",
        code: null,
        link: {
          kind: "publish_confirm",
          url: "https://escape.example/es/publish-confirm?token=abc",
        },
      },
      { type: "usage", turns: 3, maxTurns: 60, tokens: 1234, maxTokens: 1_500_000 },
      { type: "done", stopReason: "end_turn" },
    ] as const;
    for (const event of events) chat = applyChatEvent(chat, event);

    expect(chat.pending).toBe(false);
    expect(chat.roomId).toBe(ROOM_ID);
    expect(chat.items.filter((item) => item.kind === "assistant")).toEqual([
      expect.objectContaining({ text: "Creo la sala." }),
    ]);

    const html = render(createElement(CreatorChat, { locale: "es", initialState: chat }));
    expect(html).toContain("Creo la sala.");
    expect(html).toContain('data-tool="create_room" data-status="ok"');
    expect(html).toContain('data-tool="add_object" data-status="error"');
    expect(html).toContain("NOT_FOUND");
    expect(html).toContain("Habitaciones disponibles: [laboratorio]");
    expect(html).toContain('href="https://escape.example/es/publish-confirm?token=abc"');
    expect(html).toContain("Revisar y confirmar la publicación");
    expect(html).toContain("La sala no se publica hasta que la revises");
    expect(html).toContain(`href="/es/editor/${ROOM_ID}"`);
    expect(html).toContain("3/60 pasos");
  });

  it("un tope alcanzado cierra la conversación con su aviso", () => {
    let chat = startUserMessage(initialCreatorChatState(), "hola");
    chat = applyChatEvent(chat, { type: "limit", reason: "turns" });
    expect(chat).toMatchObject({ closed: true, pending: false });
    const html = render(createElement(CreatorChat, { locale: "es", initialState: chat }));
    expect(html).toContain("máximo de pasos");
    expect(html).toContain("disabled");
  });
});

describe("proveedor de Anthropic (sin red: cliente simulado)", () => {
  function fakeClient(message: Partial<Anthropic.Message>, error?: unknown) {
    const calls: Array<{ params: Anthropic.MessageStreamParams }> = [];
    const client = {
      messages: {
        stream(params: Anthropic.MessageStreamParams) {
          calls.push({ params });
          return {
            on(event: string, listener: (delta: string) => void) {
              if (event === "text") for (const delta of ["Hola ", "creador"]) listener(delta);
              return this;
            },
            finalMessage: async () => {
              if (error) throw error;
              return message;
            },
          };
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  it("modelo por defecto, streaming de texto, tools, caché y bloques de razonamiento intactos", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" };
    const { client, calls } = fakeClient({
      content: [
        thinking as unknown as Anthropic.ContentBlock,
        { type: "text", text: "Hola creador", citations: null },
        {
          type: "tool_use",
          id: "tu1",
          name: "create_room",
          input: { meta: {} },
          caller: undefined,
        } as unknown as Anthropic.ContentBlock,
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
      } as Anthropic.Usage,
    });
    const provider = createAnthropicChatProvider({ apiKey: "sk", client });
    expect(provider.model).toBe("claude-sonnet-5");
    const deltas: string[] = [];
    const response = await provider.complete({
      system: "sistema",
      messages: [
        { role: "user", content: [{ type: "text", text: "hola" }] },
        {
          role: "assistant",
          content: [
            { type: "opaque", provider: "anthropic", block: thinking },
            { type: "opaque", provider: "otro", block: { type: "x" } },
            { type: "tool_use", id: "tu0", name: "get_room", input: { roomId: "r" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", toolUseId: "tu0", content: "❌ get_room: x", isError: true },
          ],
        },
      ],
      tools: [{ name: "create_room", description: "Crea", inputSchema: { type: "object" } }],
      maxOutputTokens: 1000,
      onTextDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["Hola ", "creador"]);
    const params = calls[0]!.params;
    expect(params).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 1000,
      system: "sistema",
      cache_control: { type: "ephemeral" },
      tools: [{ name: "create_room", description: "Crea", input_schema: { type: "object" } }],
    });
    expect(params.messages[1]!.content).toEqual([
      thinking,
      { type: "tool_use", id: "tu0", name: "get_room", input: { roomId: "r" } },
    ]);
    expect(params.messages[2]!.content).toEqual([
      { type: "tool_result", tool_use_id: "tu0", content: "❌ get_room: x", is_error: true },
    ]);

    expect(response.stopReason).toBe("tool_use");
    expect(response.usage).toEqual({ inputTokens: 1110, outputTokens: 5 });
    expect(response.content).toEqual([
      { type: "opaque", provider: "anthropic", block: thinking },
      { type: "text", text: "Hola creador" },
      { type: "tool_use", id: "tu1", name: "create_room", input: { meta: {} } },
    ]);
  });

  it("traduce los errores de la API a códigos estables", async () => {
    const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
    const rateLimited = new AnthropicSdk.RateLimitError(429, undefined, "rate", new Headers());
    const { client } = fakeClient({}, rateLimited);
    const provider = createAnthropicChatProvider({ apiKey: "sk", model: "claude-opus-5", client });
    const failure = provider.complete({
      system: "",
      messages: [],
      tools: [],
      maxOutputTokens: 10,
    });
    await expect(failure).rejects.toBeInstanceOf(ChatProviderError);
    await expect(failure).rejects.toMatchObject({ code: "MODEL_RATE_LIMITED" });
  });
});
