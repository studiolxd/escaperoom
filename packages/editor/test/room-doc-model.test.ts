import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildFlatRecord, readFlatRecord } from "../src";

/**
 * Regresión D-27 (auditoría 2026-09-24): un `Y.Map` sincronizado desde otro
 * colaborador (o un update Yjs manipulado) puede traer cualquier clave, y
 * `roomDocToPackage`/`readFlatRecord` la copiaba a un objeto plano sin
 * filtrar `__proto__`/`constructor`/`prototype`.
 */
describe("readFlatRecord (D-27)", () => {
  it("ignora __proto__, constructor y prototype al leer un Y.Map hostil", () => {
    const doc = new Y.Doc();
    const record = buildFlatRecord({ id: "o-1", type: "lever" }, 0);
    doc.getMap<unknown>("scratch").set("record", record);
    // Simula lo que un colaborador remoto podría sincronizar: claves reservadas.
    record.set("__proto__", { polluted: true });
    record.set("constructor", { polluted: true });
    record.set("prototype", { polluted: true });

    const flat = readFlatRecord(record);

    expect(flat).toEqual({ id: "o-1", type: "lever" });
    expect(Object.prototype.hasOwnProperty.call(flat, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(flat)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("un Y.Map con __proto__ dentro de un doc real no contamina Object.prototype", () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>("objects");
    const record = buildFlatRecord({ id: "o-2" }, 0);
    record.set("__proto__", { polluted: true });
    objects.set("o-2", record);

    readFlatRecord(objects.get("o-2")!);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
