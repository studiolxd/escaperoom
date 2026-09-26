import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/client";
import { createPrismaClient } from "../src/db";
import {
  createInMemoryIntroMediaBlobStore,
  createIntroMediaService,
  createPrismaIntroMediaStore,
  parseIntroMediaRef,
  type Actor,
} from "../src/services";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI hay Postgres; en local, con la infra
// levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test intro-media-prisma
//
// Comprueba `createPrismaIntroMediaStore` contra la tabla real
// (`introMediaAsset`, migración 20260926160000): alta `pending` → `ready`,
// CHECK `kind`/`lang`, sala borrada (`deletedAt`) = no existe y borrado en
// cascada con la sala.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `itintro${randomUUID().slice(0, 8)}`;
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

describe.skipIf(!process.env.DATABASE_URL)("medios de la introducción sobre Postgres", () => {
  let prisma: PrismaClient;
  const authorId = `${TAG}-autora`;
  const author: Actor = { userId: authorId, organizationId: null, role: "member" };
  let roomId = "";

  beforeAll(async () => {
    prisma = createPrismaClient();
    await prisma.user.create({
      data: { id: authorId, name: "autora", email: `${authorId}@test.local` },
    });
    const room = await prisma.room.create({ data: { authorId, title: TAG, status: "draft" } });
    roomId = room.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.introMediaAsset.deleteMany({ where: { ownerId: authorId } });
    await prisma.room.deleteMany({ where: { authorId } });
    await prisma.user.deleteMany({ where: { id: authorId } });
    await prisma.$disconnect();
  });

  it("vídeo pending → ready, subtítulos ready y referencia resoluble", async () => {
    const blobs = createInMemoryIntroMediaBlobStore();
    const service = createIntroMediaService({ store: createPrismaIntroMediaStore(prisma), blobs });

    const ticket = await service.createVideoUpload(author, roomId, {
      filename: "intro.mp4",
      contentType: "video/mp4",
      byteSize: MP4.byteLength,
    });
    const pending = await prisma.introMediaAsset.findUniqueOrThrow({
      where: { id: ticket.assetId },
    });
    expect(pending).toMatchObject({ status: "pending", kind: "video", lang: null, roomId });

    blobs.simulatePut(pending.storageKey, MP4, "video/mp4");
    const { ref } = await service.completeVideoUpload(author, roomId, ticket.assetId);
    const ready = await prisma.introMediaAsset.findUniqueOrThrow({ where: { id: ticket.assetId } });
    expect(ready.status).toBe("ready");
    expect(ready.updatedAt.getTime()).toBeGreaterThanOrEqual(pending.updatedAt.getTime());
    await expect(service.resolveMediaRef(author, ref)).resolves.toBe(pending.storageKey);
    await expect(service.resolveMediaRef({ roomId }, ref)).resolves.toBe(pending.storageKey);

    const subs = await service.uploadSubtitles(author, roomId, {
      lang: "es",
      bytes: new TextEncoder().encode("WEBVTT\n"),
    });
    const row = await prisma.introMediaAsset.findUniqueOrThrow({
      where: { id: parseIntroMediaRef(subs.ref)! },
    });
    expect(row).toMatchObject({ kind: "subtitles", lang: "es", contentType: "text/vtt" });
  });

  it("CHECK: subtítulos exigen idioma y el vídeo no lo lleva; kind/status acotados", async () => {
    const base = {
      ownerId: authorId,
      roomId,
      contentType: "text/vtt",
      byteSize: 1,
    };
    await expect(
      prisma.introMediaAsset.create({
        data: { ...base, id: randomUUID(), kind: "subtitles", storageKey: `${TAG}/a` },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.introMediaAsset.create({
        data: { ...base, id: randomUUID(), kind: "video", lang: "es", storageKey: `${TAG}/b` },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.introMediaAsset.create({
        data: { ...base, id: randomUUID(), kind: "audio", storageKey: `${TAG}/c` },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.introMediaAsset.create({
        data: { ...base, id: randomUUID(), kind: "video", status: "raro", storageKey: `${TAG}/d` },
      }),
    ).rejects.toThrow();
  });

  it("una sala borrada (deletedAt) no existe para el servicio; el borrado físico arrastra sus medios", async () => {
    const store = createPrismaIntroMediaStore(prisma);
    const room = await prisma.room.create({
      data: { authorId, title: `${TAG}-2`, status: "draft" },
    });
    const id = randomUUID();
    await store.insertAsset({
      id,
      ownerId: authorId,
      roomId: room.id,
      kind: "video",
      lang: null,
      storageKey: `uploads/intro/${room.id}/${id}.mp4`,
      contentType: "video/mp4",
      byteSize: 10,
      status: "pending",
    });
    await prisma.room.update({ where: { id: room.id }, data: { deletedAt: new Date() } });
    await expect(store.findRoom(room.id)).resolves.toBeNull();
    await prisma.room.delete({ where: { id: room.id } });
    await expect(store.findAsset(id)).resolves.toBeNull();
  });
});
