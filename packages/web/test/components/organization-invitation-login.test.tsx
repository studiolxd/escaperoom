// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationInvitationLogin } from "@/components/invitations/organization-invitation-login";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("OrganizationInvitationLogin (A-8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("envía el enlace mágico con el callbackURL de la invitación", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const user = userEvent.setup();
    render(<OrganizationInvitationLogin callbackURL="/es/invitations/organization/inv-1/accept" />);

    await user.type(screen.getByLabelText("emailLabel"), "invitado@example.com");
    await user.click(screen.getByRole("button", { name: "emailSubmit" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-in/magic-link",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "invitado@example.com",
          callbackURL: "/es/invitations/organization/inv-1/accept",
        }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("emailSent");
  });

  it("precarga el email de la invitación cuando se pasa defaultEmail", () => {
    render(
      <OrganizationInvitationLogin
        callbackURL="/es/invitations/organization/inv-1/accept"
        defaultEmail="invitado@example.com"
      />,
    );

    expect(screen.getByLabelText("emailLabel")).toHaveValue("invitado@example.com");
  });
});
