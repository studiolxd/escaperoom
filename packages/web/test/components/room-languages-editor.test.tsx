// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { initRoomLanguages } from "@escaperoom/editor";
import { RoomLanguagesEditor } from "@/components/editor/room-languages-editor";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "es",
}));

describe("RoomLanguagesEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("no valida con atributos nativos (noValidate) y marca el campo inválido con aria-invalid", async () => {
    const doc = new Y.Doc();
    initRoomLanguages(doc, ["es"], "es");
    const user = userEvent.setup();
    render(<RoomLanguagesEditor doc={doc} />);

    const input = screen.getByLabelText("addLabel");
    expect(input.closest("form")).toHaveAttribute("novalidate");

    await user.type(input, "??");
    await user.click(screen.getByRole("button", { name: "add" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "room-language-add-error");
  });
});
