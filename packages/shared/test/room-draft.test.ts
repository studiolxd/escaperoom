import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  ANONYMOUS_ACTOR,
  buildDraftDoc,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  encodeDraftState,
  isValidYjsUpdate,
  RoomDraftError,
  type Actor,
} from "../src/services";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM_ID = "22222222-2222-4222-8222-222222222222";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };

function setup(snapshotEvery = 100) {
  const store = createInMemoryRoomDraftStore([
    { id: ROOM_ID, authorId: author.userId },
    { id: OTHER_ROOM_ID, authorId: intruder.userId },
  ]);
  const service = createRoomDraftService({ store, snapshotEvery });
  return { store, service };
}

/**
 * Doc "del editor" que emite un update por transacción, igual que haría el
 * cliente Yjs real: tiles, objetos, puzzles y reglas (specs/09 §2).
 */
function createEditorDoc() {
  const doc = new Y.Doc();
  const emitted: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => emitted.push(update));
  return { doc, emitted };
}

function edit(doc: Y.Doc, i: number): void {
  doc.transact(() => {
    const meta = doc.getMap("meta");
    const tiles = doc.getArray<number>("tiles");
    const objects = doc.getMap<Y.Map<unknown>>("objects");
    const rules = doc.getArray<string>("rules");
    meta.set("title", `Sala ${i}`);
    tiles.push([i % 7]);
    if (i % 5 === 0 && tiles.length > 2) tiles.delete(0, 1);
    const obj = new Y.Map<unknown>();
    obj.set("x", i);
    obj.set("y", i * 2);
    objects.set(`obj-${i % 4}`, obj);
    if (i % 3 === 0) rules.insert(0, [`regla-${i}`]);
    doc.getText("notas").insert(0, `${i};`);
  });
}

function stateOf(doc: Y.Doc) {
  return {
    meta: doc.getMap("meta").toJSON(),
    tiles: doc.getArray("tiles").toJSON(),
    objects: doc.getMap("objects").toJSON(),
    rules: doc.getArray("rules").toJSON(),
    notas: doc.getText("notas").toString(),
  };
}

async function expectDraftError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(RoomDraftError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("roomDraftService: persistencia y reconstrucción", () => {
  it("aplica N updates, 'cierra' y reconstruye el doc idéntico (estado y bytes)", async () => {
    const { service } = setup(1000); // sin compactación: solo updates
    const { doc, emitted } = createEditorDoc();
    for (let i = 0; i < 40; i++) edit(doc, i);
    for (const update of emitted) await service.appendUpdate(author, ROOM_ID, update);

    const draft = await service.loadDraft(author, ROOM_ID);
    expect(draft.snapshot).toBeNull();
    expect(draft.updates).toHaveLength(emitted.length);

    const rebuilt = buildDraftDoc(draft);
    expect(stateOf(rebuilt)).toEqual(stateOf(doc));
    expect(Y.encodeStateVector(rebuilt)).toEqual(Y.encodeStateVector(doc));
    expect(Buffer.from(Y.encodeStateAsUpdate(rebuilt))).toEqual(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
  });

  it("compacta cada N updates y reconstruye con snapshot + updates posteriores", async () => {
    const { service } = setup(10);
    const { doc, emitted } = createEditorDoc();
    for (let i = 0; i < 25; i++) edit(doc, i);

    const snapshotsCreated: bigint[] = [];
    for (const update of emitted) {
      const res = await service.appendUpdate(author, ROOM_ID, update);
      if (res.snapshot) snapshotsCreated.push(res.snapshot.updatesAppliedThrough);
    }
    // 25 updates con N=10 → snapshots tras el 10º y el 20º.
    expect(snapshotsCreated).toEqual([10n, 20n]);

    const draft = await service.loadDraft(author, ROOM_ID);
    expect(draft.snapshot?.updatesAppliedThrough).toBe(20n);
    expect(draft.updates.map((u) => u.id)).toEqual([21n, 22n, 23n, 24n, 25n]);

    const rebuilt = buildDraftDoc(draft);
    expect(stateOf(rebuilt)).toEqual(stateOf(doc));
    expect(Buffer.from(encodeDraftState(draft))).toEqual(Buffer.from(Y.encodeStateAsUpdate(doc)));

    const history = await service.listHistory(author, ROOM_ID);
    expect(history.map((s) => s.updatesAppliedThrough)).toEqual([20n, 10n]);
    expect(history.every((s) => s.byteSize > 0)).toBe(true);
  });

  it("un editor que reabre desde el draft sigue editando y el siguiente bootstrap converge", async () => {
    const { service } = setup(7);
    const first = createEditorDoc();
    for (let i = 0; i < 12; i++) edit(first.doc, i);
    for (const u of first.emitted) await service.appendUpdate(author, ROOM_ID, u);

    // Reapertura: nuevo cliente carga el draft y continúa.
    const reopened = createEditorDoc();
    Y.applyUpdate(reopened.doc, encodeDraftState(await service.loadDraft(author, ROOM_ID)));
    reopened.emitted.length = 0;
    for (let i = 12; i < 20; i++) edit(reopened.doc, i);
    for (const u of reopened.emitted) await service.appendUpdate(author, ROOM_ID, u);

    const rebuilt = buildDraftDoc(await service.loadDraft(author, ROOM_ID));
    expect(stateOf(rebuilt)).toEqual(stateOf(reopened.doc));
  });

  it("compact() fuerza un snapshot y no hace nada si no hay updates nuevos", async () => {
    const { service } = setup(1000);
    const { doc, emitted } = createEditorDoc();
    for (let i = 0; i < 5; i++) edit(doc, i);
    for (const u of emitted) await service.appendUpdate(author, ROOM_ID, u);

    const snap = await service.compact(author, ROOM_ID);
    expect(snap?.updatesAppliedThrough).toBe(5n);
    expect(await service.compact(author, ROOM_ID)).toBeNull();

    const draft = await service.loadDraft(author, ROOM_ID);
    expect(draft.updates).toEqual([]);
    expect(stateOf(buildDraftDoc(draft))).toEqual(stateOf(doc));
  });

  it("appends concurrentes a la misma sala se serializan sin perder updates", async () => {
    const { service } = setup(4);
    const { doc, emitted } = createEditorDoc();
    for (let i = 0; i < 30; i++) edit(doc, i);
    await Promise.all(emitted.map((u) => service.appendUpdate(author, ROOM_ID, u)));

    const rebuilt = buildDraftDoc(await service.loadDraft(author, ROOM_ID));
    expect(stateOf(rebuilt)).toEqual(stateOf(doc));
  });

  it("guarda el autor del update (null si lo genera el MCP)", async () => {
    const { service, store } = setup();
    const { doc, emitted } = createEditorDoc();
    edit(doc, 1);
    edit(doc, 2);
    await service.appendUpdate(author, ROOM_ID, emitted[0]!);
    await service.appendUpdate(author, ROOM_ID, emitted[1]!, { authorId: null });
    const rows = await store.updatesAfter(ROOM_ID, 0n);
    expect(rows.map((r) => r.authorId)).toEqual([author.userId, null]);
  });
});

describe("roomDraftService: validación del update", () => {
  it("rechaza bytes que no son un update Yjs", async () => {
    const { service } = setup();
    expect(isValidYjsUpdate(new Uint8Array([0xff, 0xff, 0xff]))).toBe(false);
    await expectDraftError(
      service.appendUpdate(author, ROOM_ID, new Uint8Array([0xff, 0xff, 0xff])),
      "INVALID_UPDATE",
    );
    await expectDraftError(
      service.appendUpdate(author, ROOM_ID, new Uint8Array()),
      "INVALID_UPDATE",
    );
  });

  it("rechaza updates por encima del tamaño máximo", async () => {
    const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
    const service = createRoomDraftService({ store, maxUpdateBytes: 16 });
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "x".repeat(200));
    await expectDraftError(
      service.appendUpdate(author, ROOM_ID, Y.encodeStateAsUpdate(doc)),
      "PAYLOAD_TOO_LARGE",
    );
  });
});

describe("roomDraftService: autorización", () => {
  it("otro usuario no puede leer ni escribir el draft ajeno", async () => {
    const { service } = setup();
    const { doc, emitted } = createEditorDoc();
    edit(doc, 1);
    await service.appendUpdate(author, ROOM_ID, emitted[0]!);

    await expectDraftError(service.loadDraft(intruder, ROOM_ID), "FORBIDDEN");
    await expectDraftError(service.appendUpdate(intruder, ROOM_ID, emitted[0]!), "FORBIDDEN");
    await expectDraftError(service.listHistory(intruder, ROOM_ID), "FORBIDDEN");
    await expectDraftError(service.compact(intruder, ROOM_ID), "FORBIDDEN");

    // El intento ajeno no dejó rastro.
    const draft = await service.loadDraft(author, ROOM_ID);
    expect(draft.updates).toHaveLength(1);
  });

  it("sin sesión → UNAUTHORIZED; sala inexistente o id inválido → NOT_FOUND", async () => {
    const { service } = setup();
    await expectDraftError(service.loadDraft(ANONYMOUS_ACTOR, ROOM_ID), "UNAUTHORIZED");
    await expectDraftError(
      service.loadDraft(author, "33333333-3333-4333-8333-333333333333"),
      "NOT_FOUND",
    );
    await expectDraftError(service.loadDraft(author, "no-es-uuid"), "NOT_FOUND");
  });

  it("los drafts de salas distintas no se mezclan", async () => {
    const { service } = setup();
    const a = createEditorDoc();
    const b = createEditorDoc();
    edit(a.doc, 1);
    edit(b.doc, 2);
    await service.appendUpdate(author, ROOM_ID, a.emitted[0]!);
    await service.appendUpdate(intruder, OTHER_ROOM_ID, b.emitted[0]!);
    expect(stateOf(buildDraftDoc(await service.loadDraft(author, ROOM_ID)))).toEqual(
      stateOf(a.doc),
    );
    expect(stateOf(buildDraftDoc(await service.loadDraft(intruder, OTHER_ROOM_ID)))).toEqual(
      stateOf(b.doc),
    );
  });
});

describe("roomDraftService: restauración del historial", () => {
  /** Persiste las ediciones `from..to-1` y devuelve el id del último update. */
  async function persistEdits(
    service: ReturnType<typeof setup>["service"],
    editor: ReturnType<typeof createEditorDoc>,
    from: number,
    to: number,
  ): Promise<bigint> {
    editor.emitted.length = 0;
    for (let i = from; i < to; i++) edit(editor.doc, i);
    let last = 0n;
    for (const update of editor.emitted) {
      last = (await service.appendUpdate(author, ROOM_ID, update)).update.id;
    }
    return last;
  }

  async function currentState(service: ReturnType<typeof setup>["service"]) {
    const doc = buildDraftDoc(await service.loadDraft(author, ROOM_ID));
    try {
      return stateOf(doc);
    } finally {
      doc.destroy();
    }
  }

  it("restaura a un update anterior, añade un update nuevo y conserva la historia", async () => {
    const { store, service } = setup(7); // con compactaciones entre medias
    const editor = createEditorDoc();
    const checkpoint = await persistEdits(service, editor, 0, 10);
    const expected = await currentState(service);
    await persistEdits(service, editor, 10, 25);
    const before = await store.updatesAfter(ROOM_ID, 0n);
    expect(await currentState(service)).not.toEqual(expected);

    const result = await service.restoreDraft(author, ROOM_ID, { updateId: checkpoint });

    expect(result).not.toBeNull();
    expect(await currentState(service)).toEqual(expected);
    const after = await store.updatesAfter(ROOM_ID, 0n);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length).map((u) => u.id)).toEqual(before.map((u) => u.id));
    expect(after.at(-1)?.authorId).toBe(author.userId);
  });

  it("restaura a un snapshot del historial y se puede deshacer restaurando de nuevo", async () => {
    const { store, service } = setup(5);
    const editor = createEditorDoc();
    await persistEdits(service, editor, 0, 12);
    const [snapshot] = await service.listHistory(author, ROOM_ID);
    const atSnapshot = stateOf(
      buildDraftDoc({
        snapshot: null,
        updates: await store.updatesAfter(ROOM_ID, 0n, snapshot!.updatesAppliedThrough),
      }),
    );
    const beforeRestore = await persistEdits(service, editor, 12, 20);
    const latest = await currentState(service);
    expect(latest).not.toEqual(atSnapshot);

    await service.restoreDraft(author, ROOM_ID, { snapshotId: snapshot!.id });
    expect(await currentState(service)).toEqual(atSnapshot);

    // Volver al estado previo a la restauración: la historia sigue ahí.
    await service.restoreDraft(author, ROOM_ID, { updateId: beforeRestore });
    expect(await currentState(service)).toEqual(latest);
  });

  it("restaurar al punto actual no añade nada; updateId 0 vacía el contenido", async () => {
    const { store, service } = setup(1000);
    const editor = createEditorDoc();
    const last = await persistEdits(service, editor, 0, 6);
    expect(await service.restoreDraft(author, ROOM_ID, { updateId: last })).toBeNull();
    expect(await store.countUpdatesAfter(ROOM_ID, 0n)).toBe(6);

    await service.restoreDraft(author, ROOM_ID, { updateId: 0n });
    expect(await currentState(service)).toEqual({
      meta: {},
      tiles: [],
      objects: {},
      rules: [],
      notas: "",
    });
  });

  it("un editor con la copia antigua converge con la restauración (merge CRDT)", async () => {
    const { service } = setup(1000);
    const editor = createEditorDoc();
    const checkpoint = await persistEdits(service, editor, 0, 4);
    await persistEdits(service, editor, 4, 8);
    const update = await service.planRestore(author, ROOM_ID, { updateId: checkpoint });
    expect(update).not.toBeNull();
    Y.applyUpdate(editor.doc, update!);
    await service.restoreDraft(author, ROOM_ID, { updateId: checkpoint });
    expect(stateOf(editor.doc)).toEqual(await currentState(service));
  });

  it("autoriza y valida el punto de restauración", async () => {
    const { service } = setup();
    const editor = createEditorDoc();
    await persistEdits(service, editor, 0, 2);
    await expectDraftError(service.restoreDraft(intruder, ROOM_ID, { updateId: 1n }), "FORBIDDEN");
    await expectDraftError(
      service.restoreDraft(ANONYMOUS_ACTOR, ROOM_ID, { updateId: 1n }),
      "UNAUTHORIZED",
    );
    await expectDraftError(service.restoreDraft(author, ROOM_ID, { updateId: 99n }), "NOT_FOUND");
    await expectDraftError(service.planRestore(author, ROOM_ID, { snapshotId: 42n }), "NOT_FOUND");
    await expect(service.checkAccess(author, ROOM_ID)).resolves.toBeUndefined();
    await expectDraftError(service.checkAccess(intruder, ROOM_ID), "FORBIDDEN");
  });
});

describe("createDraft (alta de una sala en borrador, 4.2)", () => {
  it("da de alta la sala del actor con su update inicial", async () => {
    const { store, service } = setup();
    const source = new Y.Doc();
    source.getMap("meta").set("title", "Nueva");
    const room = await service.createDraft(author, {
      title: "Nueva",
      initialUpdate: (roomId) => {
        source.getMap("meta").set("id", roomId);
        return Y.encodeStateAsUpdate(source);
      },
    });
    expect(room.authorId).toBe(author.userId);
    expect(await store.findRoom(room.id)).toEqual(room);
    const doc = buildDraftDoc(await service.loadDraft(author, room.id));
    expect(doc.getMap("meta").toJSON()).toEqual({ id: room.id, title: "Nueva" });
    const [update] = await store.updatesAfter(room.id, 0n);
    expect(update?.authorId).toBe(author.userId);
    // Solo su autora la puede leer.
    await expect(service.loadDraft(intruder, room.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sin sesión no crea nada", async () => {
    const { service } = setup();
    await expect(service.createDraft(ANONYMOUS_ACTOR, { title: "x" })).rejects.toBeInstanceOf(
      RoomDraftError,
    );
  });
});
