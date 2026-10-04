import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { roomDocToPackage, writeRoomMeta } from "../src";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  authorId: "autora",
  title: "Sala",
  theme: "medieval",
  languages: ["es"],
  defaultLanguage: "es",
};

function metaOf(dimension?: "2d" | "3d") {
  const doc = new Y.Doc();
  writeRoomMeta(doc, { ...base, ...(dimension ? { dimension } : {}) });
  return { doc, meta: doc.getMap<unknown>("meta") };
}

describe("meta.dimension en el documento del editor", () => {
  it("writeRoomMeta con 3d escribe la clave y roomDocToPackage la devuelve", () => {
    const { doc, meta } = metaOf("3d");
    expect(meta.get("dimension")).toBe("3d");
    expect(roomDocToPackage(doc).meta.dimension).toBe("3d");
  });

  it("con 2d o ausente no escribe la clave y la sala no la gana", () => {
    for (const dimension of [undefined, "2d" as const]) {
      const { doc, meta } = metaOf(dimension);
      expect(meta.has("dimension")).toBe(false);
      expect("dimension" in roomDocToPackage(doc).meta).toBe(false);
    }
  });
});
