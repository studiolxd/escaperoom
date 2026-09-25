// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEmailSignIn } from "@/components/auth/use-email-sign-in";

describe("useEmailSignIn (login sin contraseña compartido por AuthForm/ConsentLogin/OnboardingLogin)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no envía el enlace mágico con un email inválido: error de campo, sin fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() =>
      useEmailSignIn({ callbackURL: "/", emailInvalidMessage: "email inválido" }),
    );

    act(() => {
      result.current.setValue("email", "no-es-un-email");
    });
    await act(async () => {
      await result.current.onSubmit();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("envía el enlace mágico y pasa a status 'sent'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const { result } = renderHook(() =>
      useEmailSignIn({ callbackURL: "/dashboard", emailInvalidMessage: "email inválido" }),
    );

    act(() => {
      result.current.setValue("email", "ada@example.com");
    });
    await act(async () => {
      await result.current.onSubmit();
    });

    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/auth/sign-in/magic-link",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com", callbackURL: "/dashboard" }),
      }),
    );
  });

  it("si el envío falla, pasa a status 'error'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const { result } = renderHook(() =>
      useEmailSignIn({ callbackURL: "/", emailInvalidMessage: "email inválido" }),
    );

    act(() => {
      result.current.setValue("email", "ada@example.com");
    });
    await act(async () => {
      await result.current.onSubmit();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("signInWithGoogle redirige a la URL devuelta por Better Auth", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://accounts.google.com/oauth" }), { status: 200 }),
    );
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useEmailSignIn({ callbackURL: "/", emailInvalidMessage: "email inválido" }),
    );

    await act(async () => {
      await result.current.signInWithGoogle();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/auth/sign-in/social",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      }),
    );
    expect(assignSpy).toHaveBeenCalledWith("https://accounts.google.com/oauth");
  });
});
