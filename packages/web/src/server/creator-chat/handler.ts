import { DEFAULT_LOCALE, LOCALES } from "@escaperoom/config/locales";
import { isAnonymous, type Actor } from "@escaperoom/shared/services";
import { z } from "zod";
import {
  CREATOR_CHAT_CONTENT_TYPE,
  CREATOR_CHAT_MAX_MESSAGE_CHARS,
  encodeChatEvent,
  type CreatorChatErrorCode,
  type CreatorChatEvent,
} from "@/lib/creator-chat-protocol";
import type { CreatorChatConfig } from "./config";
import type { ChatConversationStore } from "./conversation-store";
import type { CreatorToolClient } from "./mcp-tools";
import { runCreatorChatTurn } from "./orchestrator";
import type { ChatModelProvider } from "./provider";
import { buildCreatorChatSystemPrompt } from "./system-prompt";

type ConfiguredChat = Extract<CreatorChatConfig, { configured: true }>;

/** Dependencias inyectables del endpoint (testeable sin red, sin API y sin Postgres). */
export type CreatorChatHandlerDeps = {
  resolveActor: (request: Request) => Promise<Actor>;
  /** Configuración vigente (se lee por petición). */
  config: () => CreatorChatConfig;
  createProvider: (config: ConfiguredChat) => ChatModelProvider;
  /** Cliente del MCP con la identidad de la petición (la sesión del creador). */
  createToolClient: (request: Request) => CreatorToolClient;
  store: ChatConversationStore;
};

const RequestSchema = z.object({
  message: z.string().trim().min(1).max(CREATOR_CHAT_MAX_MESSAGE_CHARS),
  conversationId: z.string().min(1).max(100).optional(),
  roomId: z.string().min(1).max(100).optional(),
  locale: z.enum(LOCALES).optional(),
});

const STATUS: Partial<Record<CreatorChatErrorCode, number>> = {
  UNAUTHORIZED: 401,
  CROSS_SITE: 403,
  INVALID_REQUEST: 400,
  CONVERSATION_NOT_FOUND: 404,
  BUSY: 409,
  NOT_CONFIGURED: 503,
};

function errorResponse(code: CreatorChatErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status: STATUS[code] ?? 500 });
}

/**
 * `POST /api/creator-chat` (ticket 4.6) — `{ message, conversationId?, roomId?, locale? }`.
 * El creador conversa y el asistente edita su draft llamando a las tools del
 * MCP del creador. Responde con un stream NDJSON de `CreatorChatEvent`.
 *
 * Solo el propio sitio (`Sec-Fetch-Site`) y con sesión: cada mensaje gasta
 * tokens del modelo a cuenta de la plataforma.
 */
export function createCreatorChatHandlers(deps: CreatorChatHandlerDeps) {
  return {
    async postMessage(request: Request): Promise<Response> {
      const site = request.headers.get("sec-fetch-site");
      if (site && site !== "same-origin") {
        return errorResponse("CROSS_SITE", "El chat solo se acepta desde la propia web");
      }
      const config = deps.config();
      if (!config.configured) {
        return errorResponse("NOT_CONFIGURED", "El chat del creador no está configurado");
      }
      const actor = await deps.resolveActor(request);
      if (isAnonymous(actor)) {
        return errorResponse("UNAUTHORIZED", "El chat del creador requiere sesión");
      }
      const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return errorResponse(
          "INVALID_REQUEST",
          parsed.error.issues[0]?.message ?? "Cuerpo inválido",
        );
      }
      const body = parsed.data;

      let conversation;
      if (body.conversationId) {
        conversation = deps.store.get(body.conversationId, actor.userId);
        if (!conversation) {
          return errorResponse("CONVERSATION_NOT_FOUND", "La conversación no existe o caducó");
        }
        if (conversation.busy) {
          return errorResponse("BUSY", "El asistente aún está respondiendo al mensaje anterior");
        }
      } else {
        const locale = body.locale ?? DEFAULT_LOCALE;
        const roomId = body.roomId ?? null;
        conversation = deps.store.create({
          userId: actor.userId,
          locale,
          roomId,
          system: buildCreatorChatSystemPrompt({ locale, roomId }),
        });
      }
      conversation.busy = true;
      const active = conversation;

      const provider = deps.createProvider(config);
      const tools = deps.createToolClient(request);
      const abort = new AbortController();
      request.signal.addEventListener("abort", () => abort.abort(), { once: true });
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let open = true;
          const emit = (event: CreatorChatEvent) => {
            if (!open) return;
            try {
              controller.enqueue(encoder.encode(encodeChatEvent(event)));
            } catch {
              open = false;
            }
          };
          try {
            emit({ type: "conversation", conversationId: active.id, roomId: active.roomId });
            await runCreatorChatTurn({
              provider,
              tools,
              conversation: active,
              message: body.message,
              limits: config.limits,
              emit,
              signal: abort.signal,
            });
          } catch {
            emit({ type: "error", code: "MODEL_ERROR" });
          } finally {
            active.busy = false;
            deps.store.touch(active);
            await tools.close().catch(() => {});
            if (open) {
              open = false;
              controller.close();
            }
          }
        },
        cancel() {
          abort.abort();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": CREATOR_CHAT_CONTENT_TYPE,
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });
    },
  };
}
