import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ensureLocalizedField,
  initRoomLanguages,
  removeRoomLanguage,
  setLocalizedValue,
} from "@escaperoom/editor";
import {
  ANONYMOUS_ACTOR,
  createCatalogService,
  createInMemoryPublishedRoomListing,
  createInMemoryReviewStore,
  createInMemoryRoomPackageRepository,
  createReviewService,
  type CatalogRoom,
} from "@escaperoom/shared/services";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import es from "../messages/es.json";
import { LocalizedTextField } from "../src/components/editor/localized-text-field";
import { RoomLanguagesEditor } from "../src/components/editor/room-languages-editor";
import { createRoomsListHandler } from "../src/server/rest/rooms-list";
import { appRouter } from "../src/server/routers/_app";

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

function dialogDoc() {
  const doc = new Y.Doc();
  initRoomLanguages(doc, ["es", "en", "fr"], "es");
  const text = ensureLocalizedField(doc, "dialogs", "intro", {
    es: { text: "La puerta está cerrada." },
    en: { text: "The door is locked." },
  });
  return { doc, text };
}

describe("<LocalizedTextField>", () => {
  it("pinta el selector de idiomas y el texto del idioma activo", () => {
    const { text } = dialogDoc();
    const html = render(
      createElement(LocalizedTextField, {
        text,
        languages: ["es", "en", "fr"],
        defaultLanguage: "es",
        label: "Diálogo",
      }),
    );
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toMatch(
      /data-language="es"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-language="es"/,
    );
    expect(html).toContain("La puerta está cerrada.");
    expect(html).toContain('lang="es"');
  });

  it("abre el idioma pedido y marca los idiomas sin traducción", () => {
    const { text } = dialogDoc();
    setLocalizedValue(text, "en", "The door is firmly locked.");
    const html = render(
      createElement(LocalizedTextField, {
        text,
        languages: ["es", "en", "fr"],
        defaultLanguage: "es",
        label: "Diálogo",
        initialLanguage: "en",
      }),
    );
    expect(html).toContain("The door is firmly locked.");
    expect(html).not.toContain("La puerta está cerrada.");
    // Solo `fr` está marcado como faltante.
    expect(html.match(/data-missing="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-language="fr"[^>]*data-missing="true"/);
    expect(html).toContain("Falta traducción en: francés");
  });
});

describe("<RoomLanguagesEditor>", () => {
  it("lista los idiomas declarados y marca el idioma por defecto", () => {
    const { doc } = dialogDoc();
    removeRoomLanguage(doc, "fr");
    const html = render(createElement(RoomLanguagesEditor, { doc }));
    expect(html).toContain("Idiomas de la sala");
    expect(html).toContain('data-language="es"');
    expect(html).toContain('data-language="en"');
    expect(html).not.toContain('data-language="fr"');
    expect(html).toContain("Idioma por defecto");
  });
});

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { meta: Record<string, unknown> };

function publishedRoom(roomId: string, languages: string[], day: number) {
  return {
    roomId,
    status: "published" as const,
    versions: [
      {
        id: `${roomId}-v1`,
        semver: "1.0.0",
        publishedAt: new Date(Date.UTC(2026, 5, day)),
        package: {
          ...fixture,
          meta: { ...fixture.meta, languages, defaultLanguage: languages[0] },
        },
      },
    ],
  };
}

const catalog = createCatalogService({
  rooms: createInMemoryRoomPackageRepository(fixture),
  listing: createInMemoryPublishedRoomListing([
    publishedRoom("sala-es", ["es"], 1),
    publishedRoom("sala-es-en", ["es", "en"], 2),
  ]),
});

describe("GET /api/rooms?language=", () => {
  const GET = createRoomsListHandler({ catalog, resolveActor: async () => ANONYMOUS_ACTOR });
  const list = async (query: string) => {
    const response = await GET(new Request(`http://localhost/api/rooms${query}`));
    return { status: response.status, body: (await response.json()) as unknown };
  };

  it("devuelve solo las salas que incluyen el idioma pedido", async () => {
    const all = await list("");
    expect((all.body as { items: CatalogRoom[] }).items.map((r) => r.id)).toEqual([
      "sala-es-en",
      "sala-es",
    ]);
    const en = await list("?language=en");
    expect(en.status).toBe(200);
    expect((en.body as { items: CatalogRoom[] }).items.map((r) => r.id)).toEqual(["sala-es-en"]);
    const both = await list("?language=es&language=en");
    expect((both.body as { items: CatalogRoom[] }).items.map((r) => r.id)).toEqual(["sala-es-en"]);
  });

  it("responde 422 con un código de idioma no válido", async () => {
    const bad = await list("?language=english");
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("tRPC devuelve lo mismo que REST", async () => {
    const caller = appRouter.createCaller({
      actor: ANONYMOUS_ACTOR,
      catalog,
      reviews: createReviewService({ store: createInMemoryReviewStore({ rooms: [] }) }),
    });
    const viaTrpc = await caller.catalog.listRooms({ language: "en" });
    const viaRest = await list("?language=en");
    expect(viaTrpc).toEqual(viaRest.body);
    await expect(caller.catalog.listRooms({ language: "xx_YY" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
