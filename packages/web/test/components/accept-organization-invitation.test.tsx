// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptOrganizationInvitation } from "@/components/invitations/accept-organization-invitation";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("AcceptOrganizationInvitation (A-8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("acepta la invitación con un POST a accept-invitation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const user = userEvent.setup();
    render(<AcceptOrganizationInvitation invitationId="inv-1" homeHref="/es" />);

    await user.click(screen.getByRole("button", { name: "accept" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/organization/accept-invitation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ invitationId: "inv-1" }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("accepted");
  });

  it("rechaza la invitación con un POST a reject-invitation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const user = userEvent.setup();
    render(<AcceptOrganizationInvitation invitationId="inv-1" homeHref="/es" />);

    await user.click(screen.getByRole("button", { name: "reject" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/organization/reject-invitation",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("rejected");
  });

  it("muestra el error genérico si la petición falla", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));
    const user = userEvent.setup();
    render(<AcceptOrganizationInvitation invitationId="inv-1" homeHref="/es" />);

    await user.click(screen.getByRole("button", { name: "accept" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("genericError");
  });
});
