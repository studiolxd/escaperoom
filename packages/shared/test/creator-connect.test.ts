import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  createCreatorConnectService,
  createFakeConnectGateway,
  createInMemoryCreatorConnectStore,
  CreatorConnectError,
  type Actor,
} from "../src/services";

const creator: Actor = { userId: "creadora", organizationId: null, role: "member" };
const urls = { refreshUrl: "https://app.test/refresh", returnUrl: "https://app.test/return" };

function setup() {
  const store = createInMemoryCreatorConnectStore([
    { id: creator.userId, email: "creadora@example.test" },
  ]);
  const connect = createFakeConnectGateway();
  const service = createCreatorConnectService({ store, connect });
  return { store, connect, service };
}

describe("creator-connect", () => {
  it("authorize exige sesión", () => {
    const { service } = setup();
    expect(() => service.authorize(ANONYMOUS_ACTOR)).toThrow(CreatorConnectError);
  });

  it("getStatus responde not_started sin cuenta creada", async () => {
    const { service } = setup();
    await expect(service.getStatus(creator)).resolves.toEqual({ status: "not_started" });
  });

  it("startOnboarding crea la cuenta la primera vez y devuelve la URL de onboarding", async () => {
    const { service, store, connect } = setup();
    const { url } = await service.startOnboarding(creator, urls);
    expect(url).toContain("connect.example.test/onboarding/");
    const row = await store.findUser(creator.userId);
    expect(row?.stripeAccountId).toMatch(/^fake_acct_/);
    expect(connect.accounts.size).toBe(1);
  });

  it("startOnboarding reutiliza la cuenta si ya existe", async () => {
    const { service, store } = setup();
    await service.startOnboarding(creator, urls);
    const first = (await store.findUser(creator.userId))?.stripeAccountId;
    await service.startOnboarding(creator, urls);
    const second = (await store.findUser(creator.userId))?.stripeAccountId;
    expect(second).toBe(first);
  });

  it("getStatus refleja el estado en vivo de la pasarela una vez hay cuenta", async () => {
    const { service, connect } = setup();
    await service.startOnboarding(creator, urls);
    await expect(service.getStatus(creator)).resolves.toEqual({ status: "pending" });
    for (const id of connect.accounts.keys()) connect.accounts.set(id, "complete");
    await expect(service.getStatus(creator)).resolves.toEqual({ status: "complete" });
  });

  it("responde PAYMENT_GATEWAY_UNAVAILABLE sin pasarela configurada", async () => {
    const store = createInMemoryCreatorConnectStore([{ id: creator.userId, email: "a@b.test" }]);
    const service = createCreatorConnectService({ store, connect: null });
    await expect(service.startOnboarding(creator, urls)).rejects.toMatchObject({
      code: "PAYMENT_GATEWAY_UNAVAILABLE",
    });
  });

  it("NOT_FOUND si el usuario no existe", async () => {
    const store = createInMemoryCreatorConnectStore([]);
    const service = createCreatorConnectService({ store, connect: createFakeConnectGateway() });
    await expect(service.startOnboarding(creator, urls)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
