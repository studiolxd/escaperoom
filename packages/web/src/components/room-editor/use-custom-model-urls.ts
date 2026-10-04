"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * URLs firmadas de lectura de los modelos propios en el editor (specs/27 §9):
 * el editor no las recibe del servidor, las pide según aparecen las `ref`
 * (`GET /api/rooms/:roomId/models/url?ref=…`). Cada `ref` se pide una vez; un
 * fallo se deja sin URL (el runtime pinta la caja) y no se reintenta.
 *
 * Devuelve `urlOf` (estable) y `version`, que sube cuando llega una URL nueva
 * para que el lienzo llame a `refreshCustomModels()`.
 */
export function useCustomModelUrls(
  roomId: string,
  refs: readonly string[],
): { urlOf: (ref: string) => string | undefined; version: number } {
  const urls = useRef(new Map<string, string>());
  const asked = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  const urlOf = useCallback((ref: string) => urls.current.get(ref), []);
  const mounted = useRef(true);
  const key = refs.join("\n");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const ref of key ? key.split("\n") : []) {
      if (asked.current.has(ref)) continue;
      asked.current.add(ref);
      void fetch(`/api/rooms/${encodeURIComponent(roomId)}/models/url?ref=${encodeURIComponent(ref)}`)
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { url?: unknown };
          if (!mounted.current || typeof body.url !== "string") return;
          urls.current.set(ref, body.url);
          setVersion((v) => v + 1);
        })
        .catch(() => {
          /* sin URL: caja */
        });
    }
  }, [roomId, key]);

  return { urlOf, version };
}
