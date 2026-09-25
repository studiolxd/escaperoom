// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedeemForm } from "@/components/redeem/redeem-form";

const redeemAccessKey = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "es",
}));

vi.mock("@/actions/redeem", () => ({
  redeemAccessKey: (...args: unknown[]) => redeemAccessKey(...args),
}));

describe("RedeemForm", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { assign: vi.fn() },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    redeemAccessKey.mockClear();
  });

  it("sin código, muestra el error bajo el campo y no llama a la action", async () => {
    const user = userEvent.setup();
    render(<RedeemForm initialCode="" />);

    await user.click(screen.getByRole("button", { name: "cta" }));

    expect(await screen.findByText("codeRequired")).toBeInTheDocument();
    expect(redeemAccessKey).not.toHaveBeenCalled();
  });

  it("canjea la clave y navega a la partida con el joinToken en el fragmento", async () => {
    redeemAccessKey.mockResolvedValue({
      ok: true,
      data: { sessionId: "session-1", joinToken: "tok-1" },
    });
    const user = userEvent.setup();
    render(<RedeemForm initialCode="ABC123" />);

    await user.type(screen.getByLabelText("nameLabel"), "Ada");
    await user.click(screen.getByRole("button", { name: "cta" }));

    expect(redeemAccessKey).toHaveBeenCalledWith({ code: "ABC123", displayName: "Ada" });
    expect(window.location.assign).toHaveBeenCalledWith(
      expect.stringContaining("tok-1"),
    );
  });

  it("con un código de error conocido, muestra el mensaje traducido bajo el formulario", async () => {
    redeemAccessKey.mockResolvedValue({
      ok: false,
      error: { code: "ACCESS_KEY_USED", message: "Esta clave ya se ha usado." },
    });
    const user = userEvent.setup();
    render(<RedeemForm initialCode="ABC123" />);

    await user.click(screen.getByRole("button", { name: "cta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.ACCESS_KEY_USED");
  });
});
