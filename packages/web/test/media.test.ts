import { describe, expect, it } from "vitest";
import { canConnectMedia, parseMediaTokenPayload } from "../src/lib/media";

describe("media (cliente)", () => {
  it("normaliza un payload de token completo", () => {
    const payload = parseMediaTokenPayload({
      configured: true,
      token: "jwt",
      url: "ws://localhost:7880",
      room: "escape-room-1",
      identity: "p1",
      role: "observer",
      allowVideo: false,
      canPublish: false,
      canPublishVideo: false,
    });
    expect(payload).not.toBeNull();
    expect(payload?.role).toBe("observer");
    expect(canConnectMedia(payload)).toBe(true);
  });

  it("cae a player si el rol no es reconocido", () => {
    const payload = parseMediaTokenPayload({ identity: "p1", role: "root" });
    expect(payload?.role).toBe("player");
    expect(payload?.configured).toBe(false);
    expect(canConnectMedia(payload)).toBe(false);
  });

  it("devuelve null si falta la identidad", () => {
    expect(parseMediaTokenPayload({ configured: true })).toBeNull();
    expect(parseMediaTokenPayload(null)).toBeNull();
  });

  it("no conecta si falta token o url aunque esté configurado", () => {
    expect(
      canConnectMedia(
        parseMediaTokenPayload({ identity: "p1", configured: true, token: "jwt", url: null }),
      ),
    ).toBe(false);
    expect(
      canConnectMedia(
        parseMediaTokenPayload({ identity: "p1", configured: true, token: null, url: "ws://x" }),
      ),
    ).toBe(false);
  });
});
