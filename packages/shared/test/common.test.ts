import { describe, expect, it } from "vitest";
import { ANONYMOUS_ACTOR, isUuid, requireUser, splitPlatformFee, UUID_RE, type Actor } from "../src/services";

class DemoError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const member: Actor = { userId: "u1", organizationId: null, role: "member" };

describe("common (§9.1: piezas compartidas entre servicios)", () => {
  it("isUuid/UUID_RE aceptan un UUID v4 y rechazan cualquier otra cosa", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(UUID_RE.test("no-es-un-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("requireUser no lanza con actor autenticado", () => {
    expect(() => requireUser(member, DemoError)).not.toThrow();
  });

  it("requireUser lanza UNAUTHORIZED/'No hay sesión' con el actor anónimo", () => {
    try {
      requireUser(ANONYMOUS_ACTOR, DemoError);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DemoError);
      expect((err as DemoError).code).toBe("UNAUTHORIZED");
      expect((err as DemoError).message).toBe("No hay sesión");
    }
  });

  it("splitPlatformFee reparte 70/30 redondeando la comisión (fusión de splitRoomAmount/splitLicenseAmount)", () => {
    expect(splitPlatformFee(299)).toEqual({ platformFeeCents: 90, creatorShareCents: 209 });
    expect(splitPlatformFee(0)).toEqual({ platformFeeCents: 0, creatorShareCents: 0 });
  });
});
