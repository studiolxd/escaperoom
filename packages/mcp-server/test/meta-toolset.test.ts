import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  __resetInMemoryRateLimitersForTests,
  slidingRateLimiter,
} from "@escaperoom/kit/rate-limit";
import {
  AudioError,
  createInMemoryIntroMediaBlobStore,
  createInMemoryIntroMediaStore,
  createIntroMediaService,
  RoomCoverError,
  type AudioAssetRow,
  type AudioAssetService,
  type RoomCoverService,
} from "@escaperoom/shared/services";
import { beforeEach, describe, expect, it } from "vitest";
import { createCreatorMcpServer, type CreatorMcpDeps, type UploadQuotaPolicy } from "../src";
import { call, errorCode } from "./fixtures/client";
import { ALDRIC_ROOM_ID, AUTHOR, FOREIGN_ROOM_ID, createTestDeps } from "./fixtures/drafts";

/**
 * Ventana en memoria (sin `REDIS_URL` en test/CI) del `slidingRateLimiter`
 * compartido: reiniciarla entre tests evita que la cuota de uno contamine al
 * siguiente (mismo patrón que `packages/web/test/rate-limit.test.ts`).
 */
beforeEach(() => {
  __resetInMemoryRateLimitersForTests();
});

const fakeRoomCover = (): Pick<RoomCoverService, "uploadCoverImage"> => ({
  async uploadCoverImage(_actor, roomId) {
    if (roomId === FOREIGN_ROOM_ID) {
      throw new RoomCoverError("FORBIDDEN", "Solo el autor puede cambiar la portada");
    }
    return { coverImageUrl: `https://cdn.test/rooms/${roomId}/cover.png` };
  },
});

const fakeAudio = (): Pick<AudioAssetService, "uploadAudio"> => ({
  async uploadAudio(actor, input): Promise<AudioAssetRow> {
    if (!input.rightsDeclared) {
      throw new AudioError("VALIDATION_ERROR", "faltan derechos declarados");
    }
    return {
      id: "audio-test-1",
      ownerId: actor.userId,
      organizationId: actor.organizationId,
      storageKey: "uploads/audio/test/audio-test-1.mp3",
      originalFilename: input.filename,
      contentType: "audio/mpeg",
      byteSize: input.bytes.byteLength,
      durationMs: 1000,
      status: "approved",
      rejectionReason: null,
      rightsDeclaredAt: new Date(),
      createdAt: new Date(),
      source: "upload",
      generationText: null,
      generationVoiceId: null,
      generationCreditsCost: null,
    };
  },
});

async function connect(deps: CreatorMcpDeps) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-meta-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("find_tools", () => {
  it("busca por texto sobre el catálogo de contenido", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "find_tools", { query: "candado puzzle" });
      expect(result.isError).toBe(false);
      const matches = result.structured?.matches as Array<{ name: string }>;
      expect(matches.map((m) => m.name)).toContain("add_puzzle");
    } finally {
      await close();
    }
  });

  it("filtra por fase", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "find_tools", { phase: "structure" });
      expect(result.isError).toBe(false);
      const matches = result.structured?.matches as Array<{ name: string; phase: string }>;
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.every((m) => m.phase === "structure")).toBe(true);
      expect(matches.map((m) => m.name)).toContain("create_room");
    } finally {
      await close();
    }
  });

  it("sin query ni phase, devuelve INVALID_INPUT", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "find_tools", {});
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_INPUT");
    } finally {
      await close();
    }
  });

  it("no devuelve las meta-tools (buscan sobre CONTENT_TOOLSET, no sobre sí mismas)", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "find_tools", { query: "tool run upload schema" });
      const matches = ((result.structured?.matches as Array<{ name: string }>) ?? []).map(
        (m) => m.name,
      );
      expect(matches).not.toEqual(
        expect.arrayContaining(["find_tools", "tool_schema", "run_tool", "upload"]),
      );
    } finally {
      await close();
    }
  });

  it("es una consulta pública: no exige identidad", async () => {
    const { client, close } = await connect(await createTestDeps(null));
    try {
      const result = await call(client, "find_tools", { query: "sala" });
      expect(result.isError).toBe(false);
    } finally {
      await close();
    }
  });
});

describe("tool_schema", () => {
  it("devuelve el esquema real de una tool del catálogo", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "tool_schema", { name: "add_rule" });
      expect(result.isError).toBe(false);
      const schema = result.structured as {
        inputSchema: { properties: Record<string, unknown> };
      };
      expect(Object.keys(schema.inputSchema.properties)).toEqual(
        expect.arrayContaining(["roomId", "rule", "replace", "dryRun"]),
      );
    } finally {
      await close();
    }
  });

  it("tool inexistente devuelve NOT_FOUND con los nombres disponibles", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "tool_schema", { name: "no_existe" });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("NOT_FOUND");
      expect((result.structured?.error as { available?: string[] })?.available).toContain(
        "add_rule",
      );
    } finally {
      await close();
    }
  });
});

describe("run_tool", () => {
  it("ejecuta una tool de consulta por delegación", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const direct = await call(client, "get_template_catalog", {});
      const delegated = await call(client, "run_tool", { name: "get_template_catalog" });
      expect(delegated.isError).toBe(false);
      expect(delegated.text).toBe(direct.text);
    } finally {
      await close();
    }
  });

  it("respeta la autorización del servicio delegado: no toca salas ajenas", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "run_tool", {
        name: "get_room",
        arguments: { roomId: FOREIGN_ROOM_ID },
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("FORBIDDEN");
    } finally {
      await close();
    }
  });

  it("tool inexistente o meta-tool (bucle) devuelve NOT_FOUND", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      for (const name of ["no_existe", "run_tool", "find_tools", "tool_schema", "upload"]) {
        const result = await call(client, "run_tool", { name });
        expect(result.isError, name).toBe(true);
        expect(errorCode(result), name).toBe("NOT_FOUND");
      }
    } finally {
      await close();
    }
  });

  it("argumentos inválidos para la tool delegada devuelven INVALID_INPUT sin llegar a ejecutarla", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "run_tool", {
        name: "add_puzzle",
        arguments: { roomId: ALDRIC_ROOM_ID, puzzle: { id: "p1", type: "no_existe" } },
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_INPUT");
    } finally {
      await close();
    }
  });

  it("sin identidad, la tool delegada devuelve el mismo error de auth que una llamada directa", async () => {
    const { client, close } = await connect(await createTestDeps(null));
    try {
      const result = await call(client, "run_tool", {
        name: "get_room",
        arguments: { roomId: ALDRIC_ROOM_ID },
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("UNAUTHORIZED");
    } finally {
      await close();
    }
  });
});

describe("upload", () => {
  const smallPng = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");

  it("kind: cover_image sube la portada por el servicio de dominio (A-12)", async () => {
    const deps = await createTestDeps(AUTHOR);
    const { client, close } = await connect({ ...deps, roomCover: fakeRoomCover() });
    try {
      const result = await call(client, "upload", {
        kind: "cover_image",
        roomId: ALDRIC_ROOM_ID,
        filename: "cover.png",
        contentType: "image/png",
        data: smallPng,
      });
      expect(result.isError, result.text).toBe(false);
      expect(result.structured?.coverImageUrl).toContain(ALDRIC_ROOM_ID);
    } finally {
      await close();
    }
  });

  it("kind: cover_image agotada la cuota, devuelve RATE_LIMITED con retryAfter", async () => {
    const deps = await createTestDeps(AUTHOR);
    const quota: UploadQuotaPolicy = {
      policyName: "test-cover-quota",
      user: { limit: 2, windowSeconds: 60 },
    };
    const { client, close } = await connect({
      ...deps,
      roomCover: fakeRoomCover(),
      uploadQuota: { coverImage: quota },
    });
    try {
      const uploadOnce = () =>
        call(client, "upload", {
          kind: "cover_image",
          roomId: ALDRIC_ROOM_ID,
          filename: "cover.png",
          contentType: "image/png",
          data: smallPng,
        });
      expect((await uploadOnce()).isError).toBe(false);
      expect((await uploadOnce()).isError).toBe(false);
      const third = await uploadOnce();
      expect(third.isError).toBe(true);
      expect(errorCode(third)).toBe("RATE_LIMITED");
      expect((third.structured?.error as { retryAfter?: number })?.retryAfter).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("kind: cover_image comparte cuota con la web: la misma clave ya consumida por la ruta REST también bloquea el MCP", async () => {
    const deps = await createTestDeps(AUTHOR);
    const quota: UploadQuotaPolicy = {
      policyName: "test-cover-quota-shared",
      user: { limit: 1, windowSeconds: 60 },
    };
    // Simula lo que haría `withRateLimit("room-cover-write", …)` en la ruta
    // REST: la MISMA clave (`<policyName>:user:<userId>`) sobre el MISMO
    // `slidingRateLimiter` — no un contador aparte del MCP.
    await slidingRateLimiter.hit(`${quota.policyName}:user:${AUTHOR.userId}`, 1, 60);
    const { client, close } = await connect({
      ...deps,
      roomCover: fakeRoomCover(),
      uploadQuota: { coverImage: quota },
    });
    try {
      const result = await call(client, "upload", {
        kind: "cover_image",
        roomId: ALDRIC_ROOM_ID,
        filename: "cover.png",
        contentType: "image/png",
        data: smallPng,
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("RATE_LIMITED");
    } finally {
      await close();
    }
  });

  it("sin deps.uploadQuota, no aplica ninguna cuota propia (solo el límite genérico del MCP)", async () => {
    const deps = await createTestDeps(AUTHOR);
    const { client, close } = await connect({ ...deps, roomCover: fakeRoomCover() });
    try {
      for (let i = 0; i < 5; i += 1) {
        const result = await call(client, "upload", {
          kind: "cover_image",
          roomId: ALDRIC_ROOM_ID,
          filename: "cover.png",
          contentType: "image/png",
          data: smallPng,
        });
        expect(result.isError, `intento ${i + 1}`).toBe(false);
      }
    } finally {
      await close();
    }
  });

  it("kind: cover_image respeta la autorización: no se puede subir a una sala ajena", async () => {
    const deps = await createTestDeps(AUTHOR);
    const { client, close } = await connect({ ...deps, roomCover: fakeRoomCover() });
    try {
      const result = await call(client, "upload", {
        kind: "cover_image",
        roomId: FOREIGN_ROOM_ID,
        filename: "cover.png",
        contentType: "image/png",
        data: smallPng,
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("FORBIDDEN");
    } finally {
      await close();
    }
  });

  it("kind: cover_image sin roomId devuelve INVALID_INPUT", async () => {
    const deps = await createTestDeps(AUTHOR);
    const { client, close } = await connect({ ...deps, roomCover: fakeRoomCover() });
    try {
      const result = await call(client, "upload", {
        kind: "cover_image",
        filename: "cover.png",
        contentType: "image/png",
        data: smallPng,
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_INPUT");
    } finally {
      await close();
    }
  });

  it("sin deps.roomCover (p. ej. stdio sin bucket), responde NOT_AVAILABLE", async () => {
    const { client, close } = await connect(await createTestDeps(AUTHOR));
    try {
      const result = await call(client, "upload", {
        kind: "cover_image",
        roomId: ALDRIC_ROOM_ID,
        filename: "cover.png",
        contentType: "image/png",
        data: smallPng,
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("NOT_AVAILABLE");
    } finally {
      await close();
    }
  });

  it("kind: audio sube a la biblioteca del creador (3.11)", async () => {
    const deps = await createTestDeps(AUTHOR);
    const { client, close } = await connect({ ...deps, audio: fakeAudio() });
    try {
      const result = await call(client, "upload", {
        kind: "audio",
        filename: "musica.mp3",
        contentType: "audio/mpeg",
        data: smallPng,
        rightsDeclared: true,
      });
      expect(result.isError, result.text).toBe(false);
      expect(result.structured?.status).toBe("approved");
    } finally {
      await close();
    }
  });

  it("kind: audio agotada la cuota, devuelve RATE_LIMITED (misma cuota que audio-upload)", async () => {
    const deps = await createTestDeps(AUTHOR);
    const quota: UploadQuotaPolicy = {
      policyName: "test-audio-quota",
      user: { limit: 1, windowSeconds: 60 },
    };
    const { client, close } = await connect({
      ...deps,
      audio: fakeAudio(),
      uploadQuota: { audio: quota },
    });
    try {
      const uploadOnce = () =>
        call(client, "upload", {
          kind: "audio",
          filename: "musica.mp3",
          contentType: "audio/mpeg",
          data: smallPng,
          rightsDeclared: true,
        });
      expect((await uploadOnce()).isError).toBe(false);
      const second = await uploadOnce();
      expect(second.isError).toBe(true);
      expect(errorCode(second)).toBe("RATE_LIMITED");
    } finally {
      await close();
    }
  });

  it("kind: audio sin rightsDeclared devuelve INVALID_INPUT sin llamar al servicio", async () => {
    const deps = await createTestDeps(AUTHOR);
    const { client, close } = await connect({ ...deps, audio: fakeAudio() });
    try {
      const result = await call(client, "upload", {
        kind: "audio",
        filename: "musica.mp3",
        contentType: "audio/mpeg",
        data: smallPng,
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_INPUT");
    } finally {
      await close();
    }
  });

  it("`data` vacío o no-base64 devuelve INVALID_INPUT", async () => {
    const deps = await createTestDeps(AUTHOR);
    const { client, close } = await connect({ ...deps, roomCover: fakeRoomCover() });
    try {
      // Zod ya rechaza la cadena vacía (`min(1)`); comprobamos el caso "todo
      // ceros" que decodifica a un buffer de longitud 0.
      const result = await call(client, "upload", {
        kind: "cover_image",
        roomId: ALDRIC_ROOM_ID,
        filename: "cover.png",
        contentType: "image/png",
        data: "====",
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("INVALID_INPUT");
    } finally {
      await close();
    }
  });

  it("sin identidad, devuelve UNAUTHORIZED antes de tocar ningún servicio", async () => {
    const { client, close } = await connect(await createTestDeps(null));
    try {
      const result = await call(client, "upload", {
        kind: "audio",
        filename: "musica.mp3",
        contentType: "audio/mpeg",
        data: smallPng,
        rightsDeclared: true,
      });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("UNAUTHORIZED");
    } finally {
      await close();
    }
  });

  describe("medios de la introducción (intro_video / intro_subtitles)", () => {
    const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const VTT = Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nHola\n");

    /** El servicio REAL en memoria: sala de test del autor y una ajena. */
    function introMedia() {
      const store = createInMemoryIntroMediaStore([
        { id: ALDRIC_ROOM_ID, authorId: AUTHOR.userId },
        { id: FOREIGN_ROOM_ID, authorId: "otra-persona" },
      ]);
      const blobs = createInMemoryIntroMediaBlobStore();
      return { store, blobs, service: createIntroMediaService({ store, blobs }) };
    }

    it("intro_video sube el vídeo (sniff mp4) y devuelve ref media:<uuid> para set_room_intro", async () => {
      const deps = await createTestDeps(AUTHOR);
      const media = introMedia();
      const { client, close } = await connect({ ...deps, introMedia: media.service });
      try {
        const result = await call(client, "upload", {
          kind: "intro_video",
          roomId: ALDRIC_ROOM_ID,
          filename: "intro.mp4",
          contentType: "video/mp4",
          data: MP4.toString("base64"),
        });
        expect(result.isError, result.text).toBe(false);
        const ref = result.structured?.ref as string;
        expect(ref).toMatch(/^media:[0-9a-f-]{36}$/);
        expect(result.text).toContain("set_room_intro");
        const row = [...media.store.rows.values()][0]!;
        expect(row).toMatchObject({ kind: "video", status: "ready", roomId: ALDRIC_ROOM_ID });
      } finally {
        await close();
      }
    });

    it("intro_subtitles exige lang y roomId; sube un WebVTT", async () => {
      const deps = await createTestDeps(AUTHOR);
      const media = introMedia();
      const { client, close } = await connect({ ...deps, introMedia: media.service });
      try {
        const base = {
          kind: "intro_subtitles",
          filename: "es.vtt",
          contentType: "text/vtt",
          data: VTT.toString("base64"),
        };
        const noLang = await call(client, "upload", { ...base, roomId: ALDRIC_ROOM_ID });
        expect(errorCode(noLang)).toBe("INVALID_INPUT");
        const noRoom = await call(client, "upload", { ...base, lang: "es" });
        expect(errorCode(noRoom)).toBe("INVALID_INPUT");
        const ok = await call(client, "upload", { ...base, roomId: ALDRIC_ROOM_ID, lang: "es" });
        expect(ok.isError, ok.text).toBe(false);
        expect(ok.structured).toMatchObject({ kind: "intro_subtitles", lang: "es" });
      } finally {
        await close();
      }
    });

    it("errores del dominio: contenido que no es vídeo, sala ajena, sin servicio", async () => {
      const deps = await createTestDeps(AUTHOR);
      const media = introMedia();
      const { client, close } = await connect({ ...deps, introMedia: media.service });
      try {
        const notVideo = await call(client, "upload", {
          kind: "intro_video",
          roomId: ALDRIC_ROOM_ID,
          filename: "intro.mp4",
          contentType: "video/mp4",
          data: Buffer.from("<html>hola</html>").toString("base64"),
        });
        expect(errorCode(notVideo)).toBe("UNSUPPORTED_MEDIA_TYPE");
        const foreign = await call(client, "upload", {
          kind: "intro_video",
          roomId: FOREIGN_ROOM_ID,
          filename: "intro.mp4",
          contentType: "video/mp4",
          data: MP4.toString("base64"),
        });
        expect(errorCode(foreign)).toBe("FORBIDDEN");
      } finally {
        await close();
      }
      const bare = await connect(await createTestDeps(AUTHOR));
      try {
        const result = await call(bare.client, "upload", {
          kind: "intro_video",
          roomId: ALDRIC_ROOM_ID,
          filename: "intro.mp4",
          contentType: "video/mp4",
          data: MP4.toString("base64"),
        });
        expect(errorCode(result)).toBe("NOT_AVAILABLE");
      } finally {
        await bare.close();
      }
    });

    it("comparte la cuota intro-media-upload con la web (vídeo y subtítulos, misma clave)", async () => {
      const deps = await createTestDeps(AUTHOR);
      const quota: UploadQuotaPolicy = {
        policyName: "test-intro-media-quota",
        user: { limit: 2, windowSeconds: 60 },
      };
      // Una subida ya hecha por la ruta REST con la misma clave.
      await slidingRateLimiter.hit(`${quota.policyName}:user:${AUTHOR.userId}`, 2, 60);
      const { client, close } = await connect({
        ...deps,
        introMedia: introMedia().service,
        uploadQuota: { introMedia: quota },
      });
      try {
        const video = await call(client, "upload", {
          kind: "intro_video",
          roomId: ALDRIC_ROOM_ID,
          filename: "intro.mp4",
          contentType: "video/mp4",
          data: MP4.toString("base64"),
        });
        expect(video.isError, video.text).toBe(false);
        const subs = await call(client, "upload", {
          kind: "intro_subtitles",
          roomId: ALDRIC_ROOM_ID,
          lang: "es",
          filename: "es.vtt",
          contentType: "text/vtt",
          data: VTT.toString("base64"),
        });
        expect(errorCode(subs)).toBe("RATE_LIMITED");
      } finally {
        await close();
      }
    });
  });
});
