import { ANONYMOUS_ACTOR, RoomDraftError, type Actor } from "@escaperoom/shared/services";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";
import { deepMergeMessages, type Messages } from "../src/i18n/messages";

// ---------------------------------------------------------------------------
// F-14: `editor/[roomId]` resolvía el actor en el WebSocket de edición pero
// no en la página — un anónimo veía el editor montarse (y reintentar la
// conexión en bucle) en vez de un login; con sesión pero sin permiso, veía
// el mismo editor vacío en vez de un 404.
// ---------------------------------------------------------------------------

const ROOM_ID = "0b6f4c0e-5d1a-4c55-9d7c-8f1f2a3b4c5d";

const OWNER: Actor = { userId: "autora", organizationId: null, role: "owner" };

const state = vi.hoisted(() => ({
  actor: null as unknown,
  checkAccess: null as unknown,
}));

vi.mock("@/server/context", () => ({
  resolveActorFromHeaders: async () => state.actor,
}));
vi.mock("@/server/services", () => ({
  getRoomDraftService: () => ({ checkAccess: state.checkAccess }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
// El editor real (Phaser + Yjs) no hace falta para probar la puerta de acceso.
vi.mock("@/components/room-editor/room-editor-shell", () => ({
  RoomEditorShell: () => createElement("div", { "data-testid": "room-editor-shell" }),
}));

const { default: RoomEditorPage } =
  await import("../src/app/[locale]/(creator)/editor/[roomId]/page");

function render(element: ReactElement): string {
  const messages = deepMergeMessages(es, {}) as Messages;
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale: "es", messages, children: element }),
  );
}

function pageParams() {
  return {
    params: Promise.resolve({ locale: "es", roomId: ROOM_ID }),
    searchParams: Promise.resolve({}),
  };
}

beforeEach(() => {
  state.actor = ANONYMOUS_ACTOR;
  state.checkAccess = vi.fn(async () => {});
});

describe("editor/[roomId] — puerta de acceso (F-14)", () => {
  it("anónimo ve una pantalla de login, no el editor", async () => {
    const html = render(await RoomEditorPage(pageParams()));
    expect(html).not.toContain("room-editor-shell");
    expect(state.checkAccess).not.toHaveBeenCalled();
  });

  it("con sesión pero sin permiso de edición, 404", async () => {
    state.actor = OWNER;
    state.checkAccess = vi.fn(async () => {
      throw new RoomDraftError("FORBIDDEN", "No tienes permiso de edición sobre esta sala");
    });
    await expect(RoomEditorPage(pageParams())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("sala inexistente, 404 (mismo caso que sin permiso: no se filtra si existe)", async () => {
    state.actor = OWNER;
    state.checkAccess = vi.fn(async () => {
      throw new RoomDraftError("NOT_FOUND", "Sala no encontrada");
    });
    await expect(RoomEditorPage(pageParams())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("con permiso, monta el editor", async () => {
    state.actor = OWNER;
    const html = render(await RoomEditorPage(pageParams()));
    expect(html).toContain("room-editor-shell");
    expect(state.checkAccess).toHaveBeenCalledWith(OWNER, ROOM_ID);
  });
});
