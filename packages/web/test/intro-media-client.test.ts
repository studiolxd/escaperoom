import { MAX_INTRO_SUBTITLES_BYTES, MAX_INTRO_VIDEO_BYTES } from "@escaperoom/shared/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IntroMediaError,
  checkIntroSubtitlesFile,
  checkIntroVideoFile,
  resolveIntroMediaUrl,
  uploadIntroSubtitles,
} from "../src/lib/intro-media-client";

afterEach(() => vi.unstubAllGlobals());

describe("comprobaciones en cliente de los medios de la introducción", () => {
  it("vídeo: solo mp4/webm y hasta 200 MB", () => {
    expect(checkIntroVideoFile({ type: "video/mp4", size: 10 })).toBeNull();
    expect(checkIntroVideoFile({ type: "video/webm", size: MAX_INTRO_VIDEO_BYTES })).toBeNull();
    expect(checkIntroVideoFile({ type: "video/quicktime", size: 10 })).toBe("videoType");
    expect(checkIntroVideoFile({ type: "video/mp4", size: MAX_INTRO_VIDEO_BYTES + 1 })).toBe(
      "videoTooLarge",
    );
  });

  it("subtítulos: .vtt (o text/vtt) y hasta 512 KB", () => {
    expect(checkIntroSubtitlesFile({ name: "es.VTT", type: "", size: 10 })).toBeNull();
    expect(checkIntroSubtitlesFile({ name: "subs", type: "text/vtt", size: 10 })).toBeNull();
    expect(checkIntroSubtitlesFile({ name: "es.srt", type: "", size: 10 })).toBe("subtitlesType");
    expect(
      checkIntroSubtitlesFile({ name: "es.vtt", type: "", size: MAX_INTRO_SUBTITLES_BYTES + 1 }),
    ).toBe("subtitlesTooLarge");
  });
});

describe("contrato REST", () => {
  it("sube subtítulos con el idioma en la query y devuelve la ref", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ref: "media:x" })));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["WEBVTT\n"], "es.vtt", { type: "text/vtt" });
    await expect(uploadIntroSubtitles("sala 1", "es", file)).resolves.toBe("media:x");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/sala%201/intro-media/subtitles?lang=es",
      expect.objectContaining({ method: "POST", body: file }),
    );
  });

  it("un error HTTP lanza IntroMediaError con el estado y el mensaje del servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "no permitido" } }), { status: 403 }),
      ),
    );
    const error = await resolveIntroMediaUrl("r", "media:x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IntroMediaError);
    expect(error).toMatchObject({ status: 403, message: "no permitido" });
  });
});
