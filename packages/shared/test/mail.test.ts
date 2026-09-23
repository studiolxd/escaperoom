// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { LOCALES } from "@escaperoom/config/locales";
import {
  createMailTransportFromEnv,
  createMemoryMailTransport,
  createNodemailerTransport,
  createResendTransport,
  DEFAULT_CONFIRMATION_TTL_SECONDS,
  DEV_CONFIRMATION_SECRET,
  INVITATION_EMAIL_JOB_OPTIONS,
  INVITATION_EMAIL_KINDS,
  MailDeliveryError,
  readConfirmationTokenConfig,
  renderInvitationEmail,
  resolveMailLocale,
  signConfirmationToken,
  verifyConfirmationToken,
} from "../src/mail";

const CODE = "ABCD-EFGH-JKMN";
const sender = { from: "no-reply@example.com", fromName: "EscapeRoom" };

describe("plantillas de invitación", () => {
  it("renderiza los tres tipos en los seis idiomas, cada uno con la clave", () => {
    const subjects = new Set<string>();
    for (const locale of LOCALES) {
      for (const kind of INVITATION_EMAIL_KINDS) {
        const email = renderInvitationEmail({
          kind,
          locale,
          eventTitle: "Jornada",
          roomTitle: "El Rey Aldric",
          code: CODE,
          confirmUrl: null,
          expiresAt: null,
        });
        expect(email.subject).toContain("Jornada");
        expect(email.text).toContain(CODE);
        expect(email.html).toContain(CODE);
        expect(email.html).toContain(`lang="${locale}"`);
        subjects.add(email.subject);
      }
    }
    // Ningún idioma reutiliza el asunto de otro.
    expect(subjects.size).toBe(LOCALES.length * INVITATION_EMAIL_KINDS.length);
  });

  it("con confirmación incluye el enlace; sin ella, no", () => {
    const base = {
      kind: "invitation" as const,
      locale: "es" as const,
      eventTitle: "Jornada",
      roomTitle: "Sala",
      code: CODE,
      expiresAt: new Date("2026-06-02T18:00:00Z"),
    };
    const url = "https://app.example.com/es/invitations/ABCD-EFGH-JKMN/confirm?token=a.b";
    const withLink = renderInvitationEmail({ ...base, confirmUrl: url });
    expect(withLink.text).toContain(url);
    expect(withLink.html).toContain('href="https://app.example.com/es/invitations/');
    expect(withLink.text).toContain("Confirmar asistencia");
    expect(withLink.text).toMatch(/caduca el .*2026.* UTC/);
    const without = renderInvitationEmail({ ...base, confirmUrl: null });
    expect(without.text).not.toContain("Confirmar asistencia");
  });

  it("escapa el HTML de los títulos y no deja saltos de línea en el asunto", () => {
    const email = renderInvitationEmail({
      kind: "invitation",
      locale: "en",
      eventTitle: "Evil\r\nBcc: x@y.z <script>alert(1)</script>",
      roomTitle: "<img src=x onerror=alert(1)>",
      code: CODE,
      confirmUrl: null,
      expiresAt: null,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("idioma desconocido → es", () => {
    expect(resolveMailLocale("it")).toBe("es");
    expect(resolveMailLocale(undefined)).toBe("es");
    expect(resolveMailLocale("nl")).toBe("nl");
  });
});

describe("transportes (sin envíos reales)", () => {
  it("Nodemailer con jsonTransport serializa el mensaje sin enviarlo", async () => {
    const transport = createNodemailerTransport({
      sender: { ...sender, replyTo: "profe@example.com" },
      options: { jsonTransport: true },
    });
    const sendMail = vi.spyOn(transport.transporter, "sendMail");
    const result = await transport.send({
      to: "alumna@example.com",
      subject: "Hola",
      text: "texto",
      html: "<p>html</p>",
    });
    expect(result.messageId).toMatch(/@/);
    const info = (await sendMail.mock.results[0]!.value) as { message: string };
    const message = JSON.parse(info.message) as Record<string, unknown>;
    expect(message).toMatchObject({ subject: "Hola", text: "texto", html: "<p>html</p>" });
    expect(JSON.stringify(message.to)).toContain("alumna@example.com");
    expect(JSON.stringify(message.replyTo)).toContain("profe@example.com");
  });

  it("Resend llama a su API con la clave y traduce un error HTTP a MailDeliveryError", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "re_123" }));
    const transport = createResendTransport({
      sender,
      apiKey: "re_test",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const result = await transport.send({
      to: "a@example.com",
      subject: "S",
      text: "T",
      html: "H",
    });
    expect(result.messageId).toBe("re_123");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: '"EscapeRoom" <no-reply@example.com>',
      to: ["a@example.com"],
      subject: "S",
    });

    fetch.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const err = await transport
      .send({ to: "a@example.com", subject: "S", text: "T", html: "H" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailDeliveryError);
    expect((err as MailDeliveryError).status).toBe(500);
  });

  it("el transporte en memoria puede simular fallos", async () => {
    const transport = createMemoryMailTransport();
    transport.failNext();
    const msg = { to: "a@example.com", subject: "S", text: "T", html: "H" };
    await expect(transport.send(msg)).rejects.toBeInstanceOf(MailDeliveryError);
    await expect(transport.send(msg)).resolves.toEqual({ messageId: "memory-1" });
    expect(transport.sent).toHaveLength(1);
  });

  it("elige proveedor por entorno: SMTP por defecto, Resend opcional", () => {
    expect(
      createMailTransportFromEnv({ SMTP_HOST: "localhost", SMTP_PORT: "1025" })?.provider,
    ).toBe("nodemailer");
    // Sin SMTP fuera de producción: jsonTransport (no sale nada de la máquina).
    expect(createMailTransportFromEnv({})?.provider).toBe("nodemailer");
    expect(
      createMailTransportFromEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x" })?.provider,
    ).toBe("resend");
    expect(createMailTransportFromEnv({ EMAIL_PROVIDER: "resend" })).toBeNull();
    expect(
      createMailTransportFromEnv({ NODE_ENV: "production", EMAIL_FROM: "a@example.com" }),
    ).toBeNull();
    expect(createMailTransportFromEnv({ EMAIL_PROVIDER: "postmark" })).toBeNull();
  });

  it("los envíos se reintentan con backoff", () => {
    expect(INVITATION_EMAIL_JOB_OPTIONS.attempts).toBeGreaterThanOrEqual(3);
    expect(INVITATION_EMAIL_JOB_OPTIONS.backoff).toMatchObject({ type: "exponential" });
  });
});

describe("token del enlace de confirmación", () => {
  const secret = "s".repeat(32);
  const now = new Date("2026-06-01T10:00:00Z");
  const expiresAt = new Date("2026-06-02T10:00:00Z");

  it("firma y verifica", () => {
    const token = signConfirmationToken({ code: CODE, expiresAt }, secret);
    expect(verifyConfirmationToken(token, CODE, secret, now)).toEqual({ ok: true, expiresAt });
  });

  it("rechaza token manipulado, de otra clave, de otro secreto o caducado", () => {
    const token = signConfirmationToken({ code: CODE, expiresAt }, secret);
    const [payload, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ c: CODE, e: 9_999_999_999 })).toString("base64url");
    expect(verifyConfirmationToken(`${forged}.${sig}`, CODE, secret, now)).toEqual({
      ok: false,
      error: "BAD_SIGNATURE",
    });
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifyConfirmationToken(`${payload}.${flipped}`, CODE, secret, now).ok).toBe(false);
    expect(verifyConfirmationToken(token, "ZZZZ-ZZZZ-ZZZZ", secret, now)).toEqual({
      ok: false,
      error: "WRONG_KEY",
    });
    expect(verifyConfirmationToken(token, CODE, "otro".repeat(8), now)).toEqual({
      ok: false,
      error: "BAD_SIGNATURE",
    });
    expect(verifyConfirmationToken(token, CODE, secret, expiresAt)).toEqual({
      ok: false,
      error: "EXPIRED",
    });
    expect(verifyConfirmationToken("basura", CODE, secret, now)).toEqual({
      ok: false,
      error: "MALFORMED",
    });
  });

  it("configuración: APP_SECRET por defecto, secreto de desarrollo solo fuera de producción", () => {
    expect(readConfirmationTokenConfig({ APP_SECRET: secret })).toEqual({
      secret,
      ttlSeconds: DEFAULT_CONFIRMATION_TTL_SECONDS,
    });
    expect(
      readConfirmationTokenConfig({ CONFIRMATION_TOKEN_SECRET: "x".repeat(32), APP_SECRET: secret })
        ?.secret,
    ).toBe("x".repeat(32));
    expect(readConfirmationTokenConfig({})?.secret).toBe(DEV_CONFIRMATION_SECRET);
    expect(readConfirmationTokenConfig({ NODE_ENV: "production" })).toBeNull();
  });
});
