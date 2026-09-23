"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Subida de la imagen de portada, visible solo para el autor de la sala.
 * `POST /api/rooms/:roomId/cover-image` (multipart) y refresca el SSR.
 */
export function RoomCoverUpload({ roomId }: { roomId: string }) {
  const t = useTranslations("RoomDetail");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/cover-image`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error("upload failed");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1"
      data-slot="room-cover-upload"
    >
      <Label
        aria-disabled={busy || undefined}
        className="cursor-pointer rounded-md border border-white/40 bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/60"
      >
        {busy ? t("coverUploading") : t("coverUpload")}
        <Input
          type="file"
          accept="image/png,image/webp,image/jpeg"
          className="sr-only"
          disabled={busy}
          onChange={onFile}
        />
      </Label>
      {error ? (
        <p role="alert" className="rounded bg-black/60 px-2 py-1 text-xs text-red-300">
          {t("coverUploadError")}
        </p>
      ) : null}
    </div>
  );
}
