import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { createRateLimiter, handleCreatorMcpRequest } from "@escaperoom/mcp-server";
import { RoomPackageSchema, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  buildDraftDoc,
  createCatalogService,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createRoomDraftService,
  type Actor,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { readChatEvents, type CreatorChatEvent } from "../src/lib/creator-chat-protocol";
import {
  createCreatorChatHandlers,
  createInMemoryConversationStore,
  createInMemoryCreatorChatDailyBudget,
  createMcpHttpToolClient,
  createScriptedChatProvider,
  DEFAULT_CREATOR_CHAT_LIMITS,
  readCreatorChatConfig,
  type ChatModelProvider,
  type CreatorChatConfig,
  type CreatorChatLimits,
  type ScriptedStep,
  type ScriptedStepContext,
} from "../src/server/creator-chat";

const AUTHOR: Actor = { userId: "autora-chat", organizationId: null, role: "member" };
const OTHER: Actor = { userId: "otra-persona", organizationId: null, role: "member" };
const ACTORS: Record<string, Actor> = { [AUTHOR.userId]: AUTHOR, [OTHER.userId]: OTHER };
/** Cabecera de TEST que hace de cookie de sesión (en web: Better Auth). */
const TEST_USER_HEADER = "x-test-user";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

const LAB = "laboratorio";

/**
 * Entorno del chat sin red ni API: el MCP del creador REAL (mismo
 * `handleCreatorMcpRequest` que `/mcp/creator`) sobre servicios en memoria y
 * la conversión doc ↔ RoomPackage de 3.1; el cliente MCP del chat le habla por
 * el transporte HTTP streamable con un `fetch` que entrega la petición al
 * handler. El modelo es el proveedor guionizado.
 */
function setup(
  opts: { limits?: Partial<CreatorChatLimits>; configured?: boolean; mcpRateLimit?: number } = {},
) {
  const drafts = createRoomDraftService({ store: createInMemoryRoomDraftStore() });
  const catalog = createCatalogService({
    rooms: createInMemoryRoomPackageRepository(
      JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
    ),
  });
  const mcpUsers: string[] = [];
  const rateLimiter = opts.mcpRateLimit ? createRateLimiter({ limit: opts.mcpRateLimit }) : null;
  const mcp = (request: Request) =>
    handleCreatorMcpRequest(request, {
      authenticate: async (req) => {
        const user = req.headers.get(TEST_USER_HEADER);
        if (user) mcpUsers.push(user);
        return user ? (ACTORS[user] ?? null) : null;
      },
      createDeps: () => ({ catalog, drafts, roomDocToPackage }),
      ...(rateLimiter ? { rateLimiter } : {}),
    });

  let provider: ChatModelProvider = createScriptedChatProvider([]);
  const config: CreatorChatConfig =
    opts.configured === false
      ? { configured: false }
      : {
          configured: true,
          provider: "anthropic",
          apiKey: "sk-test-no-se-usa",
          model: "scripted",
          limits: { ...DEFAULT_CREATOR_CHAT_LIMITS, ...opts.limits },
        };
  const store = createInMemoryConversationStore();
  const dailyBudget = createInMemoryCreatorChatDailyBudget();
  const handlers = createCreatorChatHandlers({
    resolveActor: async (req) => ACTORS[req.headers.get(TEST_USER_HEADER) ?? ""] ?? ANONYMOUS_ACTOR,
    config: () => config,
    createProvider: () => provider,
    createToolClient: (req) => {
      const user = req.headers.get(TEST_USER_HEADER);
      return createMcpHttpToolClient({
        url: new URL("http://localhost/mcp/creator"),
        headers: user ? { [TEST_USER_HEADER]: user } : {},
        fetch: (url, init) => mcp(new Request(url, init)),
      });
    },
    store,
    dailyBudget,
  });

  const post = (
    body: unknown,
    user: string | null = AUTHOR.userId,
    extra: Record<string, string> = {},
  ) =>
    handlers.postMessage(
      new Request("http://localhost/api/creator-chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          ...(user ? { [TEST_USER_HEADER]: user } : {}),
          ...extra,
        },
        body: JSON.stringify(body),
      }),
    );

  return {
    drafts,
    mcpUsers,
    store,
    dailyBudget,
    handlers,
    useScript(steps: ScriptedStep[]) {
      const scripted = createScriptedChatProvider(steps);
      provider = scripted;
      return scripted;
    },
    post,
    /** Envía un mensaje y devuelve todos los eventos del stream. */
    async chat(body: Record<string, unknown>, user: string = AUTHOR.userId) {
      const res = await post(body, user);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/ndjson/);
      const events: CreatorChatEvent[] = [];
      for await (const event of readChatEvents(res.body!)) events.push(event);
      return events;
    },
  };
}

function ofType<T extends CreatorChatEvent["type"]>(events: CreatorChatEvent[], type: T) {
  return events.filter(
    (event): event is Extract<CreatorChatEvent, { type: T }> => event.type === type,
  );
}

/** `roomId` del draft que creó `create_room` (el texto que ve el modelo). */
function createdRoomId(ctx: ScriptedStepContext): string {
  for (const message of ctx.messages) {
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const match = /draft creado: ([0-9a-f-]{36})/.exec(block.content);
      if (match?.[1]) return match[1];
    }
  }
  throw new Error("el guion esperaba un draft creado");
}

async function draftPackage(drafts: RoomDraftService, roomId: string): Promise<RoomPackage> {
  const doc = buildDraftDoc(await drafts.loadDraft(AUTHOR, roomId));
  try {
    return roomDocToPackage(doc);
  } finally {
    doc.destroy();
  }
}

const ROOM_META = {
  title: "La cripta del alquimista",
  theme: "medieval",
  languages: ["es"],
  defaultLanguage: "es",
  difficulty: 1,
  players: { min: 1, max: 4 },
  description: "Una sala corta creada desde el chat.",
  estimatedMinutes: 20,
};

const es = (text: string) => ({ es: { text } });

function chest(subroom: string) {
  return {
    id: "cofre-lab",
    roomId: subroom,
    type: "cofre",
    position: { x: 3, y: 2 },
    sprite: "cofre",
    states: { cerrado: "cofre-cerrado", abierto: "cofre-abierto" },
    initialState: "cerrado",
    interactable: true,
  };
}

/** Guion de una conversación que construye la sala paso a paso (como haría Claude). */
function buildRoomScript(): ScriptedStep[] {
  return [
    {
      text: "¡Vamos allá! Primero creo el borrador.",
      toolCalls: [{ name: "create_room", input: { meta: ROOM_META } }],
    },
    (ctx) => {
      const roomId = createdRoomId(ctx);
      return {
        text: "Defino el laboratorio y su suelo.",
        toolCalls: [
          {
            name: "define_subrooms",
            input: {
              roomId,
              subrooms: [{ id: LAB, name: "Laboratorio", bounds: { x: 0, y: 0, w: 10, h: 8 } }],
            },
          },
          {
            name: "set_map",
            input: {
              roomId,
              tileset: "medieval-v1",
              size: { cols: 10, rows: 8 },
              layers: [{ name: "ground", rle: [80, 1] }],
              subroomIds: [LAB],
            },
          },
        ],
      };
    },
    (ctx) => ({
      text: "Añado el cofre y un candado de código.",
      toolCalls: [
        { name: "add_object", input: { roomId: createdRoomId(ctx), object: chest(LAB) } },
        {
          name: "add_puzzle",
          input: {
            roomId: createdRoomId(ctx),
            puzzle: {
              id: "p-cofre",
              type: "code_lock",
              layer: "panel",
              roomId: LAB,
              position: { x: 3, y: 2 },
              requiresSolved: [],
              grantsItems: [],
              unlocks: [],
              length: 3,
              code: "314",
            },
          },
        },
        {
          name: "add_dialog",
          input: {
            roomId: createdRoomId(ctx),
            dialog: { id: "d-intro", text: es("El alquimista os espera.") },
          },
        },
      ],
    }),
    (ctx) => ({
      text: "Compruebo el grafo con la vista filtrada.",
      toolCalls: [{ name: "get_room_graph", input: { roomId: createdRoomId(ctx) } }],
    }),
    { text: "Listo: el borrador tiene el laboratorio, un cofre y su candado." },
  ];
}

describe("chat del creador (4.6) — conversación que crea un draft", { timeout: 30_000 }, () => {
  it("con el proveedor guionizado crea el draft por el MCP y roomDocToPackage es válido", async () => {
    const env = setup();
    const script = env.useScript(buildRoomScript());

    const events = await env.chat({ message: "Crea una cripta medieval", locale: "es" });

    // Streaming: primero la conversación, texto en fragmentos, y al final `done`.
    expect(events[0]).toMatchObject({ type: "conversation", roomId: null });
    expect(ofType(events, "text").length).toBeGreaterThan(5);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });

    // Cada llamada a una tool aparece con su resultado, en orden, sin errores.
    const calls = ofType(events, "tool_call").map((event) => event.name);
    expect(calls).toEqual([
      "create_room",
      "define_subrooms",
      "set_map",
      "add_object",
      "add_puzzle",
      "add_dialog",
      "get_room_graph",
    ]);
    const results = ofType(events, "tool_result");
    expect(results.map((event) => [event.name, event.isError])).toEqual(
      calls.map((name) => [name, false]),
    );
    expect(results[0]?.text).toMatch(/^✅ create_room — draft creado/);

    // El enlace al editor: la conversación ya tiene draft.
    const room = ofType(events, "room");
    expect(room).toHaveLength(1);
    const roomId = room[0]!.roomId;

    // El draft existe en los servicios de dominio y es un RoomPackage válido.
    const pkg = await draftPackage(env.drafts, roomId);
    const parsed = RoomPackageSchema.safeParse(pkg);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(pkg.meta).toMatchObject({ title: ROOM_META.title, id: roomId, authorId: AUTHOR.userId });
    expect(pkg.map.rooms.map((r) => r.id)).toEqual([LAB]);
    expect(pkg.objects.map((o) => o.id)).toEqual(["cofre-lab"]);
    expect(pkg.puzzles.map((p) => p.id)).toEqual(["p-cofre"]);
    expect(pkg.dialogs.map((d) => d.id)).toEqual(["d-intro"]);

    // El MCP se llamó con la identidad del creador, y el modelo no ve la tool de ejemplo.
    expect(new Set(env.mcpUsers)).toEqual(new Set([AUTHOR.userId]));
    const offered = script.requests[0]!.tools.map((tool) => tool.name);
    expect(offered).toContain("create_room");
    expect(offered).toContain("get_rules_for");
    expect(offered).not.toContain("get_featured_room");
    expect(script.requests[0]!.system).toMatch(/Responde siempre en español/);
    expect(script.remaining()).toBe(0);

    // Uso: 5 llamadas al modelo.
    expect(ofType(events, "usage").at(-1)).toMatchObject({ turns: 5 });
  });

  it("un error accionable de una tool se muestra y el asistente lo corrige en el siguiente paso", async () => {
    const env = setup();
    env.useScript([
      { toolCalls: [{ name: "create_room", input: { meta: ROOM_META } }] },
      (ctx) => ({
        toolCalls: [
          {
            name: "define_subrooms",
            input: {
              roomId: createdRoomId(ctx),
              subrooms: [{ id: LAB, name: "Laboratorio", bounds: { x: 0, y: 0, w: 10, h: 8 } }],
            },
          },
        ],
      }),
      // Se equivoca de habitación: "bodega" no existe.
      (ctx) => ({
        text: "Pongo el cofre en la bodega.",
        toolCalls: [
          { name: "add_object", input: { roomId: createdRoomId(ctx), object: chest("bodega") } },
        ],
      }),
      // Lee el error accionable y usa una de las habitaciones que lista.
      (ctx) => {
        const [error] = ctx.lastToolResults;
        expect(error?.isError).toBe(true);
        const available = /Habitaciones disponibles: \[([^\]]+)\]/.exec(error!.content)?.[1];
        expect(available).toBeDefined();
        const subroom = available!.split(",")[0]!.trim();
        return {
          text: `No existe la bodega; lo pongo en ${subroom}.`,
          toolCalls: [
            { name: "add_object", input: { roomId: createdRoomId(ctx), object: chest(subroom) } },
          ],
        };
      },
      { text: "Corregido." },
    ]);

    const events = await env.chat({ message: "Pon un cofre en la bodega" });
    const adds = ofType(events, "tool_result").filter((event) => event.name === "add_object");
    expect(adds).toHaveLength(2);
    expect(adds[0]).toMatchObject({ isError: true });
    expect(adds[0]!.code).toEqual(expect.any(String));
    expect(adds[0]!.text).toMatch(/No existe la habitación "bodega"/);
    expect(adds[0]!.text).toMatch(/Habitaciones disponibles: \[laboratorio\]/);
    expect(adds[1]).toMatchObject({ isError: false });
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });

    const roomId = ofType(events, "room")[0]!.roomId;
    const pkg = await draftPackage(env.drafts, roomId);
    expect(pkg.objects).toMatchObject([{ id: "cofre-lab", roomId: LAB }]);
  });

  it("la conversación sigue en un segundo mensaje con su historia y su draft", async () => {
    const env = setup();
    const script = env.useScript([
      { toolCalls: [{ name: "create_room", input: { meta: ROOM_META } }] },
      { text: "Creado." },
      (ctx) => ({
        toolCalls: [{ name: "get_room_graph", input: { roomId: createdRoomId(ctx) } }],
      }),
      { text: "Aquí tienes el grafo." },
    ]);
    const first = await env.chat({ message: "Crea la sala" });
    const conversationId = ofType(first, "conversation")[0]!.conversationId;
    const roomId = ofType(first, "room")[0]!.roomId;

    const second = await env.chat({ message: "¿Qué tiene?", conversationId });
    expect(second[0]).toEqual({ type: "conversation", conversationId, roomId });
    expect(ofType(second, "tool_result")[0]).toMatchObject({
      name: "get_room_graph",
      isError: false,
    });
    // La historia completa viaja al modelo: 2 mensajes del creador + respuestas.
    const lastRequest = script.requests.at(-1)!;
    const userTexts = lastRequest.messages.flatMap((m) =>
      m.role === "user" ? m.content.filter((b) => b.type === "text") : [],
    );
    expect(userTexts).toHaveLength(2);

    // Otra cuenta no puede continuar la conversación.
    const res = await env.post({ message: "hola", conversationId }, OTHER.userId);
    expect(res.status).toBe(404);
  });

  it("publish solo pide la confirmación: el enlace de 4.5 llega a la UI y nada se publica", async () => {
    // Sin servicio de confirmación inyectado, publish responde NOT_AVAILABLE:
    // basta para comprobar que el chat no tiene un camino propio para publicar.
    const env = setup();
    env.useScript([
      { toolCalls: [{ name: "create_room", input: { meta: ROOM_META } }] },
      (ctx) => ({
        toolCalls: [{ name: "publish", input: { roomId: createdRoomId(ctx), versionNotes: "v1" } }],
      }),
      { text: "No se ha podido pedir la publicación." },
    ]);
    const events = await env.chat({ message: "Publica" });
    const publish = ofType(events, "tool_result").find((event) => event.name === "publish");
    expect(publish).toMatchObject({ isError: true, link: null });
  });
});

describe("chat del creador (4.6) — control de coste", { timeout: 30_000 }, () => {
  const loop: ScriptedStep = { toolCalls: [{ name: "get_template_catalog", input: {} }] };

  it("respeta el tope de turnos por conversación", async () => {
    const env = setup({ limits: { maxTurns: 2 } });
    const script = env.useScript([loop, loop, loop, loop]);
    const events = await env.chat({ message: "Enséñame las plantillas" });
    expect(script.requests).toHaveLength(2);
    expect(ofType(events, "tool_call")).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "limit", reason: "turns" });
    expect(ofType(events, "usage").at(-1)).toMatchObject({ turns: 2, maxTurns: 2 });

    // La conversación agotada no vuelve a llamar al modelo.
    const conversationId = ofType(events, "conversation")[0]!.conversationId;
    const again = await env.chat({ message: "Sigue", conversationId });
    expect(again.slice(1)).toEqual([{ type: "limit", reason: "turns" }]);
    expect(script.requests).toHaveLength(2);
  });

  it("respeta el tope de tokens por conversación", async () => {
    const env = setup({ limits: { maxTokens: 10 } });
    const script = env.useScript([loop, loop]);
    const events = await env.chat({ message: "Enséñame las plantillas" });
    expect(script.requests).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "limit", reason: "tokens" });
  });

  it("el rate limit del MCP (4.7) llega como error de la tool, sin romper la conversación", async () => {
    const env = setup({ mcpRateLimit: 1 });
    env.useScript([loop, loop, { text: "Espera un minuto, por favor." }]);
    const events = await env.chat({ message: "Plantillas" });
    const results = ofType(events, "tool_result");
    expect(results.map((event) => [event.isError, event.code])).toEqual([
      [false, null],
      [true, "RATE_LIMITED"],
    ]);
    expect(results[1]!.text).toMatch(/límite de uso del MCP/);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
  });

  it("recorta para el modelo los resultados largos de las tools (la UI los recibe enteros)", async () => {
    const env = setup({ limits: { toolResultMaxChars: 200 } });
    const script = env.useScript([loop, { text: "ok" }]);
    const events = await env.chat({ message: "Plantillas" });
    const full = ofType(events, "tool_result")[0]!.text;
    expect(full.length).toBeGreaterThan(200);
    const sent = script.requests[1]!.messages.at(-1)!.content[0];
    expect(sent).toMatchObject({ type: "tool_result" });
    const content = (sent as { content: string }).content;
    expect(content.length).toBeLessThan(full.length);
    expect(content).toMatch(/recortado: .*get_room_graph/);
  });

  // B-25: el draft puede venir de un fork licenciado/regalado por otro
  // creador; el modelo debe poder distinguir "esto es contenido del draft" de
  // "esto es una instrucción para mí".
  it("B-25: delimita el resultado de una tool como dato no confiable antes de reenviarlo al modelo", async () => {
    const env = setup();
    const script = env.useScript([loop, { text: "ok" }]);
    const events = await env.chat({ message: "Plantillas" });

    // La UI recibe el texto tal cual, sin delimitadores.
    const uiText = ofType(events, "tool_result")[0]!.text;
    expect(uiText).not.toContain("<tool_result_data>");

    // El modelo recibe el mismo texto envuelto en el delimitador.
    const sent = script.requests[1]!.messages.at(-1)!.content[0] as { content: string };
    expect(sent.content.startsWith("<tool_result_data>\n")).toBe(true);
    expect(sent.content.endsWith("\n</tool_result_data>")).toBe(true);
    expect(sent.content).toContain(uiText.length > 200 ? uiText.slice(0, 50) : uiText);
  });
});

describe("chat del creador (4.6) — configuración y acceso", () => {
  it("sin ANTHROPIC_API_KEY el chat está «no configurado» (503)", async () => {
    expect(readCreatorChatConfig({})).toEqual({ configured: false });
    expect(readCreatorChatConfig({ ANTHROPIC_API_KEY: "  " })).toEqual({ configured: false });
    const env = setup({ configured: false });
    const res = await env.post({ message: "hola" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_CONFIGURED" } });
  });

  it("con clave: modelo por defecto claude-sonnet-5 y topes configurables por env", () => {
    expect(readCreatorChatConfig({ ANTHROPIC_API_KEY: "sk" })).toEqual({
      configured: true,
      provider: "anthropic",
      apiKey: "sk",
      model: "claude-sonnet-5",
      limits: DEFAULT_CREATOR_CHAT_LIMITS,
    });
    const custom = readCreatorChatConfig({
      ANTHROPIC_API_KEY: "sk",
      CREATOR_CHAT_MODEL: "claude-opus-5",
      CREATOR_CHAT_MAX_TURNS: "10",
      CREATOR_CHAT_MAX_TOKENS: "abc",
      CREATOR_CHAT_MAX_OUTPUT_TOKENS: "-3",
    });
    expect(custom).toMatchObject({
      model: "claude-opus-5",
      limits: {
        maxTurns: 10,
        maxTokens: DEFAULT_CREATOR_CHAT_LIMITS.maxTokens,
        maxOutputTokens: DEFAULT_CREATOR_CHAT_LIMITS.maxOutputTokens,
      },
    });
  });

  it("CREATOR_CHAT_PROVIDER elige el proveedor y su clave y modelo por defecto", () => {
    expect(
      readCreatorChatConfig({ CREATOR_CHAT_PROVIDER: "openai", OPENAI_API_KEY: "sk-oa" }),
    ).toMatchObject({ configured: true, provider: "openai", apiKey: "sk-oa", model: "gpt-5.1" });
    expect(
      readCreatorChatConfig({ CREATOR_CHAT_PROVIDER: "google", GOOGLE_GENERATIVE_AI_API_KEY: "sk-g" }),
    ).toMatchObject({ configured: true, provider: "google", apiKey: "sk-g", model: "gemini-3-pro" });
    // Sin la clave del proveedor elegido, «no configurado» (no cae a otro proveedor).
    expect(
      readCreatorChatConfig({ CREATOR_CHAT_PROVIDER: "openai", ANTHROPIC_API_KEY: "sk" }),
    ).toEqual({ configured: false });
    // Un valor no reconocido se ignora y rige `anthropic` por defecto.
    expect(
      readCreatorChatConfig({ CREATOR_CHAT_PROVIDER: "cohere", ANTHROPIC_API_KEY: "sk" }),
    ).toMatchObject({ configured: true, provider: "anthropic" });
  });

  it("exige sesión, mismo sitio y un mensaje válido", async () => {
    const env = setup();
    env.useScript([]);
    expect((await env.post({ message: "hola" }, null)).status).toBe(401);
    const cross = await env.post({ message: "hola" }, AUTHOR.userId, {
      "sec-fetch-site": "cross-site",
    });
    expect(cross.status).toBe(403);
    expect((await env.post({ message: "   " })).status).toBe(400);
    expect((await env.post({ message: "hola", locale: "xx" })).status).toBe(400);
    expect((await env.post({ message: "hola", conversationId: "no-existe" })).status).toBe(404);
  });

  // B-25: antes, sin cabecera `Sec-Fetch-Site` (no solo con un valor
  // distinto de "same-origin"), la petición pasaba igualmente.
  it("B-25: rechaza una petición sin Sec-Fetch-Site, no solo con uno distinto de same-origin", async () => {
    const env = setup();
    env.useScript([]);
    const req = new Request("http://localhost/api/creator-chat", {
      method: "POST",
      headers: { "content-type": "application/json", [TEST_USER_HEADER]: AUTHOR.userId },
      body: JSON.stringify({ message: "hola" }),
    });
    expect(req.headers.has("sec-fetch-site")).toBe(false);
    const res = await env.handlers.postMessage(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CROSS_SITE");
  });

  // B-6: cada `POST` sin `conversationId` abre otra conversación con su
  // propio tope de turnos/tokens; sin límite, una cuenta los multiplica.
  it("B-6: tope de conversaciones activas por usuario", async () => {
    const env = setup({ limits: { maxActiveConversationsPerUser: 2 } });
    env.useScript([{ text: "ok" }]);

    const first = await env.chat({ message: "primera" });
    expect(ofType(first, "conversation")).toHaveLength(1);
    const second = await env.chat({ message: "segunda" });
    expect(ofType(second, "conversation")).toHaveLength(1);

    const third = await env.post({ message: "tercera" });
    expect(third.status).toBe(409);
    expect((await third.json()).error.code).toBe("TOO_MANY_CONVERSATIONS");

    // Otro usuario no comparte el tope.
    const otherUser = await env.post({ message: "hola" }, OTHER.userId);
    expect(otherUser.status).toBe(200);
  });

  // B-6: presupuesto diario de tokens por usuario, persistido fuera de la
  // conversación (aquí, el store en memoria inyectado en el test).
  it("B-6: agotado el presupuesto diario, el chat se rechaza aunque quepa en la conversación", async () => {
    const env = setup({ limits: { dailyTokenBudget: 100 } });
    await env.dailyBudget.add(AUTHOR.userId, 100);

    env.useScript([{ text: "no debería llamarse" }]);
    const res = await env.post({ message: "hola" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("DAILY_BUDGET_EXCEEDED");

    // Otro usuario con su propio presupuesto intacto sí puede.
    const otherUser = await env.post({ message: "hola" }, OTHER.userId);
    expect(otherUser.status).toBe(200);
  });
});
