import { describe, expect, it } from "vitest";
import {
  BadJsonError,
  errorResponse,
  handleDomainErrors,
  NO_STORE,
  queryOf,
  readJson,
} from "@/server/rest/_http";

class DemoError extends Error {
  code: string;
  issues: string[];
  constructor(code: string, message: string, issues: string[] = []) {
    super(message);
    this.name = "DemoError";
    this.code = code;
    this.issues = issues;
  }
}

const STATUS_BY_CODE = { UNAUTHORIZED: 401, VALIDATION_ERROR: 422, NOT_FOUND: 404 };

describe("server/rest/_http (A-22: contrato de error REST único)", () => {
  it("errorResponse: no-store y forma { error: { code, message, ...extra } }", async () => {
    const res = errorResponse("NOT_FOUND", "No existe", 404, { foo: "bar" });
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "No existe", foo: "bar" } });
  });

  it("readJson: cuerpo vacío es INVALID_JSON por defecto, {} con allowEmpty", async () => {
    const empty = new Request("http://x", { method: "POST", body: "" });
    await expect(readJson(empty)).rejects.toBeInstanceOf(BadJsonError);
    const empty2 = new Request("http://x", { method: "POST", body: "" });
    expect(await readJson(empty2, { allowEmpty: true })).toEqual({});
  });

  it("readJson: JSON roto lanza BadJsonError; JSON válido se parsea", async () => {
    const broken = new Request("http://x", { method: "POST", body: "{" });
    await expect(readJson(broken)).rejects.toBeInstanceOf(BadJsonError);
    const ok = new Request("http://x", { method: "POST", body: '{"a":1}' });
    expect(await readJson(ok)).toEqual({ a: 1 });
  });

  it("queryOf: solo las claves pedidas, ausentes si no vienen", () => {
    const req = new Request("http://x/api?cursor=abc&limit=10&other=x");
    expect(queryOf(req, ["cursor", "limit", "missing"])).toEqual({ cursor: "abc", limit: "10" });
  });

  it("handleDomainErrors: traduce el error de dominio a status/no-store y filtra extras vacíos", async () => {
    const handle = handleDomainErrors(DemoError, STATUS_BY_CODE);
    const res = await handle(async () => {
      throw new DemoError("VALIDATION_ERROR", "Datos no válidos");
    });
    expect(res.status).toBe(422);
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE["Cache-Control"]);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Datos no válidos" } });
    expect(body.error.name).toBeUndefined();
    expect(body.error.issues).toBeUndefined();
  });

  it("handleDomainErrors: incluye extras no vacíos (p. ej. issues)", async () => {
    const handle = handleDomainErrors(DemoError, STATUS_BY_CODE);
    const res = await handle(async () => {
      throw new DemoError("VALIDATION_ERROR", "Datos no válidos", ["campo requerido"]);
    });
    expect(await res.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Datos no válidos", issues: ["campo requerido"] },
    });
  });

  it("handleDomainErrors: BadJsonError -> INVALID_JSON 400", async () => {
    const handle = handleDomainErrors(DemoError, STATUS_BY_CODE);
    const res = await handle(async () => {
      throw new BadJsonError("mal");
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON");
  });

  it("handleDomainErrors: un error desconocido se relanza (nunca se filtra un stack trace disfrazado)", async () => {
    const handle = handleDomainErrors(DemoError, STATUS_BY_CODE);
    await expect(
      handle(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
