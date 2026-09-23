// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DowngradableEvent } from "../src/observability/db-connectivity";
import {
  DB_UNREACHABLE_FINGERPRINT,
  downgradeDbConnectivityEvent,
  isDbConnectivityError,
} from "../src/observability/db-connectivity";

/** El error real tal cual lo trae Prisma en un corte de conexión. */
function prismaP1001() {
  return Object.assign(
    new Error("Invalid `prisma.user.findMany()` invocation:\n\nCan't reach database server at `localhost:55433`"),
    { name: "PrismaClientKnownRequestError", code: "P1001" },
  );
}

describe("isDbConnectivityError", () => {
  it("reconoce P1001 (no se alcanza el servidor)", () => {
    expect(isDbConnectivityError(prismaP1001())).toBe(true);
  });

  it("reconoce P1002 (tiempo de espera) y P1017 (el servidor cerró)", () => {
    for (const code of ["P1002", "P1017"]) {
      expect(isDbConnectivityError(Object.assign(new Error("x"), { code }))).toBe(true);
    }
  });

  it("acepta `errorCode`, como lo trae PrismaClientInitializationError", () => {
    expect(
      isDbConnectivityError(Object.assign(new Error("x"), { errorCode: "P1001" })),
    ).toBe(true);
  });

  it("reconoce el mensaje aunque se haya perdido el código por el camino", () => {
    expect(
      isDbConnectivityError(new Error("Can't reach database server at `pgbouncer:5432`")),
    ).toBe(true);
    expect(isDbConnectivityError("Server has closed the connection.")).toBe(true);
  });

  it("mira dentro de un error envuelto (cause)", () => {
    expect(isDbConnectivityError(new Error("fallo el job", { cause: prismaP1001() }))).toBe(true);
  });

  it("NO se traga los errores de negocio ni los de consulta", () => {
    expect(isDbConnectivityError(new Error("Unique constraint failed"))).toBe(false);
    expect(
      isDbConnectivityError(Object.assign(new Error("no existe"), { code: "P2025" })),
    ).toBe(false);
    expect(isDbConnectivityError(null)).toBe(false);
    expect(isDbConnectivityError(undefined)).toBe(false);
    expect(isDbConnectivityError({})).toBe(false);
  });
});

describe("downgradeDbConnectivityEvent (el beforeSend)", () => {
  it("baja a warning y agrupa lo que llega por el hint", () => {
    const event: DowngradableEvent = {
      level: "error",
      exception: { values: [{ type: "Error", value: "x" }] },
    };
    const out = downgradeDbConnectivityEvent(event, { originalException: prismaP1001() });
    expect(out.level).toBe("warning");
    expect(out.fingerprint).toEqual([DB_UNREACHABLE_FINGERPRINT]);
  });

  it("también cuando lo único que queda es el mensaje del evento", () => {
    const out = downgradeDbConnectivityEvent({
      level: "error",
      exception: {
        values: [
          {
            type: "PrismaClientKnownRequestError",
            value: "Can't reach database server at `localhost:55433`",
          },
        ],
      },
    });
    expect(out.level).toBe("warning");
  });

  it("NUNCA descarta el evento — se quiere ver, una vez", () => {
    const out = downgradeDbConnectivityEvent({ level: "error" }, {
      originalException: prismaP1001(),
    });
    expect(out).not.toBeNull();
  });

  it("deja intactos los errores de negocio", () => {
    const event: DowngradableEvent = {
      level: "error",
      exception: { values: [{ type: "Error", value: "Unique constraint failed" }] },
    };
    const out = downgradeDbConnectivityEvent(event, {
      originalException: new Error("Unique constraint failed"),
    });
    expect(out).toBe(event);
    expect(out.level).toBe("error");
    expect(out.fingerprint).toBeUndefined();
  });
});
