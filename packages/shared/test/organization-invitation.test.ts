import { LOCALES } from "@escaperoom/config/locales";
import { describe, expect, it } from "vitest";
import { createMemoryMailTransport } from "../src/mail/transport";
import {
  renderOrganizationInvitationEmail,
  sendOrganizationInvitationEmail,
} from "../src/mail/organization-invitation";

const URL = "https://app.example.com/es/invitations/organization/inv-1/accept";
const PARAMS = { url: URL, organizationName: "Colegio Rey Aldric", inviterEmail: "org@example.com" };

describe("renderOrganizationInvitationEmail", () => {
  it("incluye el enlace y el nombre de la organización en los seis idiomas", () => {
    for (const locale of LOCALES) {
      const email = renderOrganizationInvitationEmail(locale, PARAMS);
      expect(email.text).toContain(URL);
      expect(email.text).toContain(PARAMS.organizationName);
      expect(email.html).toContain(`href="${URL}"`);
      expect(email.html).toContain(`lang="${locale}"`);
      expect(email.subject.length).toBeGreaterThan(0);
    }
  });
});

describe("sendOrganizationInvitationEmail (A-8)", () => {
  it("envía por el transporte con el email de la persona invitada y el enlace", async () => {
    const transport = createMemoryMailTransport();
    await sendOrganizationInvitationEmail(
      { transport },
      { email: "invitado@example.com", locale: "en", ...PARAMS },
    );
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe("invitado@example.com");
    expect(transport.sent[0]?.text).toContain(URL);
  });

  it("falla en vez de fingir un envío si no hay transporte configurado", async () => {
    await expect(
      sendOrganizationInvitationEmail({ transport: null }, { email: "invitado@example.com", ...PARAMS }),
    ).rejects.toThrow();
  });

  it("propaga el fallo del transporte (SMTP caído, etc.)", async () => {
    const transport = createMemoryMailTransport();
    transport.failNext();
    await expect(
      sendOrganizationInvitationEmail(
        { transport },
        { email: "invitado@example.com", ...PARAMS },
      ),
    ).rejects.toThrow();
  });
});
