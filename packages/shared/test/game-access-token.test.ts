import { describe, expect, it } from "vitest";
import {
  signGameAccessToken,
  verifyGameAccessToken,
  type GameAccessClaims,
} from "../src/services/game-access-token";

/**
 * `gameToken` de la `GameRoom` (C-4/B-4 + punto i de "CTA Jugar",
 * `docs/DEUDA.md`): cubre el round-trip de los tres tipos de claim, en
 * especial el nuevo `kind: "free"` (sala realmente gratis, sin `purchase`).
 */

const SECRET = "test-game-access-token-secret-0123456789ab";

function roundTrip(claims: GameAccessClaims) {
  const now = Date.now();
  const token = signGameAccessToken(SECRET, claims, { now, expiresAt: now + 60_000 });
  return verifyGameAccessToken(SECRET, token, now);
}

describe("game-access-token", () => {
  it("purchase: round-trip conserva purchaseId/userId/roomVersionId", () => {
    const result = roundTrip({
      kind: "purchase",
      purchaseId: "purchase-1",
      userId: "user-1",
      roomVersionId: "version-1",
    });
    expect(result).toMatchObject({ ok: true, claims: { kind: "purchase", purchaseId: "purchase-1" } });
  });

  it("dev_test: round-trip conserva label", () => {
    const result = roundTrip({ kind: "dev_test", label: "es-play" });
    expect(result).toMatchObject({ ok: true, claims: { kind: "dev_test", label: "es-play" } });
  });

  it("free: round-trip conserva roomId/roomVersionId, sin purchaseId ni userId", () => {
    const result = roundTrip({ kind: "free", roomId: "room-1", roomVersionId: "version-1" });
    expect(result).toEqual({
      ok: true,
      expiresAt: expect.any(Number),
      claims: { kind: "free", roomId: "room-1", roomVersionId: "version-1" },
    });
  });

  it("free: firma inválida se rechaza igual que las otras variantes", () => {
    const now = Date.now();
    const token = signGameAccessToken(
      SECRET,
      { kind: "free", roomId: "room-1", roomVersionId: "version-1" },
      { now, expiresAt: now + 60_000 },
    );
    const tampered = `${token.slice(0, -1)}${token.at(-1) === "a" ? "b" : "a"}`;
    expect(verifyGameAccessToken(SECRET, tampered, now)).toEqual({ ok: false, error: "BAD_SIGNATURE" });
  });

  it("free: expirado se rechaza", () => {
    const now = Date.now();
    const token = signGameAccessToken(
      SECRET,
      { kind: "free", roomId: "room-1", roomVersionId: "version-1" },
      { now, expiresAt: now + 1000 },
    );
    expect(verifyGameAccessToken(SECRET, token, now + 2000)).toEqual({ ok: false, error: "EXPIRED" });
  });

  it("free: no se confunde con purchase aunque comparta secreto y ventana", () => {
    const purchase = roundTrip({
      kind: "purchase",
      purchaseId: "room-1",
      userId: "u",
      roomVersionId: "version-1",
    });
    const free = roundTrip({ kind: "free", roomId: "room-1", roomVersionId: "version-1" });
    expect(purchase.ok && free.ok && purchase.claims.kind !== free.claims.kind).toBe(true);
  });
});
