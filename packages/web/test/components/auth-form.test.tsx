// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AuthForm } from "@/components/auth/auth-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { href: unknown; children: ReactNode }) => <span>{children}</span>,
}));

describe("AuthForm", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("no valida con atributos nativos (noValidate) y no envía con un email inválido", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    const form = screen.getByRole("button", { name: "emailSubmit" }).closest("form");
    expect(form).toHaveAttribute("novalidate");

    await user.type(screen.getByLabelText("emailLabel"), "no-es-un-email");
    await user.click(screen.getByRole("button", { name: "emailSubmit" }));

    expect(await screen.findByText("emailInvalid")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envía el enlace mágico con un email válido", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText("emailLabel"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "emailSubmit" }));

    expect(await screen.findByRole("status")).toHaveTextContent("emailSent");
  });
});
