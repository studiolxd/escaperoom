import {
  ANONYMOUS_ACTOR,
  createUserDataRightsService,
  type Actor,
  type UserDataExportBundle,
  type UserDataRightsStore,
  type UserProfileRow,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createUserDataRightsHandlers } from "../src/server/rest/user-data-rights";

const owner: Actor = { userId: "user-1", organizationId: null, role: "member" };
const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-09-01T10:00:00Z");

type ErrorJson = { error: { code: string; message: string } };

const profile: UserProfileRow = {
  id: "user-1",
  email: "creadora@example.com",
  name: "Creadora",
  image: null,
  locale: "es",
  isAdmin: false,
  isModerator: false,
  createdAt: T0,
};

const bundle: Omit<UserDataExportBundle, "profile"> = {
  organizations: [],
  personalCreditsBalance: 0,
  roomsAuthored: [],
  purchases: [],
  eventsOrganized: [],
  reviews: [],
  moderationStrikesReceived: [],
  moderationAppealsFiled: [],
  contentReportsFiled: [],
};

function setup() {
  const users = new Map<string, UserProfileRow>([[profile.id, { ...profile }]]);
  const anonymized: string[] = [];
  const store: UserDataRightsStore = {
    async findProfile(userId) {
      return users.get(userId) ?? null;
    },
    async loadExportBundle() {
      return bundle;
    },
    async anonymizeAccount(userId) {
      anonymized.push(userId);
      users.set(userId, { ...profile, email: "deleted@deleted.invalid", name: "Usuario eliminado" });
    },
  };
  const userDataRights = createUserDataRightsService({ store, now: () => NOW });
  const actors: Record<string, Actor> = { autora: owner };
  const resolveActor = async (req: Request) =>
    actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR;
  const handlers = createUserDataRightsHandlers({ userDataRights, resolveActor });

  const req = (method: string, user: string | undefined) =>
    new Request("http://localhost/api/me/data-export", {
      method,
      headers: user ? { "x-test-user": user } : {},
    });

  return { anonymized, users, handlers, req };
}

describe("GET /api/me/data-export", () => {
  it("200: exporta el perfil del usuario autenticado con cabecera de descarga", async () => {
    const t = setup();
    const res = await t.handlers.getDataExport(t.req("GET", "autora"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const json = (await res.json()) as { profile: { id: string }; exportedAt: string };
    expect(json.profile.id).toBe("user-1");
    expect(json.exportedAt).toBe(NOW.toISOString());
  });

  it("401 sin sesión", async () => {
    const t = setup();
    const res = await t.handlers.getDataExport(t.req("GET", undefined));
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorJson).error.code).toBe("UNAUTHORIZED");
  });
});

describe("DELETE /api/me", () => {
  it("200: anonimiza la cuenta y devuelve deletedAt", async () => {
    const t = setup();
    const res = await t.handlers.deleteAccount(t.req("DELETE", "autora"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedAt: NOW.toISOString() });
    expect(t.anonymized).toEqual(["user-1"]);
    expect(t.users.get("user-1")?.name).toBe("Usuario eliminado");
  });

  it("401 sin sesión; no anonimiza nada", async () => {
    const t = setup();
    const res = await t.handlers.deleteAccount(t.req("DELETE", undefined));
    expect(res.status).toBe(401);
    expect(t.anonymized).toEqual([]);
  });
});
