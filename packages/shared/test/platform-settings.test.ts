import { describe, expect, it } from "vitest";
import {
  AdminError,
  ANONYMOUS_ACTOR,
  createInMemoryPlatformSettingStore,
  createPlatformSettingsService,
  type Actor,
  type PlatformSettingRow,
} from "../src/services";

const admin: Actor = { userId: "admin", organizationId: null, role: "member" };
const user: Actor = { userId: "usuaria", organizationId: null, role: "member" };

function setup(
  rows: PlatformSettingRow[] = [
    { key: "maxPlayersPerRoom", value: 6, updatedBy: null, updatedAt: new Date(0) },
  ],
) {
  const store = createInMemoryPlatformSettingStore({ adminIds: [admin.userId], rows });
  return createPlatformSettingsService({ store });
}

async function codeOf(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AdminError);
  return (err as AdminError).code;
}

describe("platformSetting — servicio de admin", () => {
  it("un admin cambia maxPlayersPerRoom y se lee el nuevo valor (con autoría)", async () => {
    const settings = setup();
    expect((await settings.getSetting(admin, "maxPlayersPerRoom")).value).toBe(6);

    const updated = await settings.updateSetting(admin, "maxPlayersPerRoom", { value: 8 });
    expect(updated).toMatchObject({ key: "maxPlayersPerRoom", value: 8, isDefault: false });
    expect(updated.updatedBy).toBe(admin.userId);

    expect((await settings.getSetting(admin, "maxPlayersPerRoom")).value).toBe(8);
    expect(await settings.readValue("maxPlayersPerRoom")).toBe(8);
  });

  it("sin fila persistida devuelve el valor por defecto", async () => {
    const settings = setup([]);
    const s = await settings.getSetting(admin, "maxPlayersPerRoom");
    expect(s).toMatchObject({ value: 6, isDefault: true, updatedAt: null });
  });

  it.each([
    ["no entero", 6.5],
    ["cero", 0],
    ["por encima del techo", 9],
    ["texto", "8"],
    ["null", null],
  ])("valor inválido (%s) → VALIDATION_ERROR sin persistir", async (_label, value) => {
    const settings = setup();
    expect(await codeOf(settings.updateSetting(admin, "maxPlayersPerRoom", { value }))).toBe(
      "VALIDATION_ERROR",
    );
    expect((await settings.getSetting(admin, "maxPlayersPerRoom")).value).toBe(6);
  });

  it("cuerpo mal formado → VALIDATION_ERROR con detalle por campo", async () => {
    const settings = setup();
    const err = await settings
      .updateSetting(admin, "maxPlayersPerRoom", { value: 7, extra: true })
      .catch((e: unknown) => e as AdminError);
    expect(err).toBeInstanceOf(AdminError);
    expect((err as AdminError).code).toBe("VALIDATION_ERROR");
    expect((err as AdminError).issues.length).toBeGreaterThan(0);
  });

  it("clave desconocida → NOT_FOUND (incluso claves del prototipo)", async () => {
    const settings = setup();
    expect(await codeOf(settings.getSetting(admin, "noExiste"))).toBe("NOT_FOUND");
    expect(await codeOf(settings.getSetting(admin, "__proto__"))).toBe("NOT_FOUND");
    expect(await codeOf(settings.updateSetting(admin, "toString", { value: 1 }))).toBe("NOT_FOUND");
  });

  it("no admin → FORBIDDEN; sin sesión → UNAUTHORIZED (antes de mirar la clave)", async () => {
    const settings = setup();
    expect(await codeOf(settings.getSetting(user, "maxPlayersPerRoom"))).toBe("FORBIDDEN");
    expect(await codeOf(settings.updateSetting(user, "maxPlayersPerRoom", { value: 8 }))).toBe(
      "FORBIDDEN",
    );
    expect(await codeOf(settings.getSetting(ANONYMOUS_ACTOR, "noExiste"))).toBe("UNAUTHORIZED");
    expect(await settings.readValue("maxPlayersPerRoom")).toBe(6);
  });

  it("un valor persistido que ya no pasa el esquema cae al por defecto", async () => {
    const settings = setup([
      { key: "maxPlayersPerRoom", value: 99, updatedBy: "x", updatedAt: new Date(0) },
    ]);
    expect(await settings.readValue("maxPlayersPerRoom")).toBe(6);
  });
});
