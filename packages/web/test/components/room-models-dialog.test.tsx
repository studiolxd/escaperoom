// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { RoomModelsDialog } from "../../src/components/moderation/room-models-dialog";

// jsdom no tiene WebGL: el visor se sustituye.
vi.mock("../../src/components/models/model-viewer-3d", () => ({
  default: ({ url }: { url: string }) => createElement("div", { "data-testid": "viewer", "data-url": url }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const model = (id: string) => ({
  id,
  label: `Modelo ${id}`,
  url: `https://s/${id}.glb`,
  size: { w: 1, d: 2, hgt: 3 },
  triangles: 500,
  byteSize: 2 * 1024 * 1024,
  clips: [],
});

function open(response: Response) {
  const fetchMock = vi.fn(async (_url: string) => response);
  vi.stubGlobal("fetch", fetchMock);
  render(
    createElement(NextIntlClientProvider, {
      locale: "es",
      messages: es,
      children: createElement(RoomModelsDialog, { roomId: "r1" }),
    }),
  );
  return fetchMock;
}

describe("<RoomModelsDialog>", () => {
  it("al abrir pide la ruta, lista los modelos y muestra el primero en el visor", async () => {
    const fetchMock = open(Response.json({ models: [model("a"), model("b")] }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ver modelos 3D" }));
    expect(await screen.findByText("Modelo b")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/moderation/rooms/r1/models");
    expect(screen.getAllByText("1 × 2 × 3 m · 500 triángulos · 2 MB")).toHaveLength(2);
    expect(await screen.findByTestId("viewer")).toHaveAttribute("data-url", "https://s/a.glb");
    await user.click(document.querySelector('[data-model-row="b"]')!);
    expect(await screen.findByTestId("viewer")).toHaveAttribute("data-url", "https://s/b.glb");
  });

  it("sala sin modelos propios", async () => {
    open(Response.json({ models: [] }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Ver modelos 3D" }));
    expect(await screen.findByText("Esta sala no tiene modelos propios.")).toBeInTheDocument();
  });

  it("error de carga", async () => {
    open(new Response("{}", { status: 500 }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Ver modelos 3D" }));
    expect(await screen.findByText("No se pudieron cargar los modelos.")).toBeInTheDocument();
  });
});
