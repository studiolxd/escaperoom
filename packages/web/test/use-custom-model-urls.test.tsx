// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCustomModelUrls } from "../src/components/room-editor/use-custom-model-urls";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (url: string) => new Response(JSON.stringify({ url }), { status: 200 });

describe("useCustomModelUrls", () => {
  it("pide cada ref una vez y sube la versión al llegar la URL", async () => {
    const fetchMock = vi.fn(async (input: string) => ok(`https://s/${new URL(input, "http://x").searchParams.get("ref")}`));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ refs }) => useCustomModelUrls("r1", refs), {
      initialProps: { refs: ["media:a"] },
    });
    expect(result.current.version).toBe(0);
    expect(result.current.urlOf("media:a")).toBeUndefined();
    await waitFor(() => expect(result.current.version).toBe(1));
    expect(result.current.urlOf("media:a")).toBe("https://s/media:a");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/rooms/r1/models/url?ref=media%3Aa");

    const urlOf = result.current.urlOf;
    rerender({ refs: ["media:a", "media:b"] });
    await waitFor(() => expect(result.current.version).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.urlOf).toBe(urlOf);
  });

  it("un fallo (HTTP o red) no rompe, no reintenta y deja la ref sin URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockRejectedValueOnce(new Error("red"));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ refs }) => useCustomModelUrls("r1", refs), {
      initialProps: { refs: ["media:a", "media:b"] },
    });
    await act(async () => {
      await Promise.resolve();
    });
    rerender({ refs: ["media:a", "media:b"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.version).toBe(0);
    expect(result.current.urlOf("media:a")).toBeUndefined();
  });
});
