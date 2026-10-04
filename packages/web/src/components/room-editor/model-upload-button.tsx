"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { setCustomModel3D, slugifyId } from "@escaperoom/editor";
import type { ModelUploadResult } from "@escaperoom/shared/services";
import type * as Y from "yjs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ModelViewer3D = dynamic(() => import("../models/model-viewer-3d"), {
  ssr: false,
  loading: () => null,
});

/** Tope de tamaño del GLB en el navegador (el servidor lo repite). */
export const MAX_MODEL_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Tope de modelos propios por sala (`MAX_WORLD3D_CUSTOM_MODELS`). */
export const MAX_CUSTOM_MODELS = 40;

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Id propuesto: slug del nombre sin extensión; con sufijo `-2`, `-3`… si ya está cogido. */
export function proposeModelId(filename: string, taken: ReadonlySet<string>): string {
  const base = slugifyId(filename.replace(/\.[^.]*$/, ""));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string };
    const detail = typeof body.error === "string" ? body.error : body.error?.message;
    return detail || fallback;
  } catch {
    return fallback;
  }
}

export interface ModelUploadButtonProps {
  doc: Y.Doc;
  roomId: string;
  /** Ids de los modelos propios de la sala y del catálogo del pack (no se pueden repetir). */
  takenIds: ReadonlySet<string>;
  catalogIds: ReadonlySet<string>;
  customCount: number;
  /** Se llama tras registrar el modelo en el documento. */
  onAdded?: (id: string) => void;
}

type Pending = { result: ModelUploadResult; filename: string; previewUrl: string | undefined };

/**
 * «Subir modelo» (specs/27 §9): reserva, PUT directo al bucket, validación en el servidor y, con
 * las medidas, un diálogo para elegir id y nombre antes de registrarlo con `setCustomModel3D`.
 */
export function ModelUploadButton({
  doc,
  roomId,
  takenIds,
  catalogIds,
  customCount,
  onAdded,
}: ModelUploadButtonProps) {
  const t = useTranslations("RoomEditor.models");
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "validating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const full = customCount >= MAX_CUSTOM_MODELS;
  const base = `/api/rooms/${encodeURIComponent(roomId)}/models`;

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_MODEL_UPLOAD_BYTES) {
      setError(t("tooLarge"));
      return;
    }
    try {
      setPhase("uploading");
      const ticketResponse = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "model/gltf-binary",
          byteSize: file.size,
        }),
      });
      if (!ticketResponse.ok) throw new Error(await readError(ticketResponse, t("uploadFailed")));
      const ticket = (await ticketResponse.json()) as {
        assetId: string;
        uploadUrl: string;
        headers?: Record<string, string>;
      };
      const put = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers ?? {}, body: file });
      if (!put.ok) throw new Error(t("uploadFailed"));

      setPhase("validating");
      const done = await fetch(`${base}/${encodeURIComponent(ticket.assetId)}/complete`, { method: "POST" });
      if (!done.ok) throw new Error(await readError(done, t("uploadFailed")));
      const result = (await done.json()) as ModelUploadResult;

      let previewUrl: string | undefined;
      try {
        const preview = await fetch(`${base}/url?ref=${encodeURIComponent(result.ref)}`);
        if (preview.ok) previewUrl = ((await preview.json()) as { url?: string }).url;
      } catch {
        /* sin vista previa */
      }
      const proposed = proposeModelId(file.name, takenIds);
      setId(proposed);
      setLabel(file.name.replace(/\.[^.]*$/, ""));
      setDialogError(null);
      setPending({ result, filename: file.name, previewUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setPhase("idle");
    }
  };

  const confirm = () => {
    if (!pending) return;
    const { result } = pending;
    try {
      setCustomModel3D(
        doc,
        id,
        {
          ref: result.ref,
          label: label.trim() || id,
          size: result.size,
          colliders: result.colliders,
          clips: result.clips,
        },
        { catalogIds },
      );
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("uploadFailed"));
      return;
    }
    setPending(null);
    onAdded?.(id);
  };

  return (
    <div className="mb-3 space-y-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="w-full"
        disabled={phase !== "idle" || full}
        onClick={() => inputRef.current?.click()}
        data-model-upload=""
      >
        {phase === "uploading" ? t("uploading") : phase === "validating" ? t("validating") : t("upload")}
      </Button>
      <Input
        ref={inputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="hidden"
        data-model-file=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      {full && <p className="text-xs text-white/50">{t("limit")}</p>}
      {error && (
        <Alert variant="destructive" data-model-upload-error="">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
          </DialogHeader>
          {pending && (
            <div className="space-y-3">
              {pending.previewUrl && <ModelViewer3D url={pending.previewUrl} className="h-60" />}
              <div className="space-y-1">
                <Label htmlFor="model-id">{t("id")}</Label>
                <Input id="model-id" value={id} onChange={(e) => setId(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t("idHint")}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="model-label">{t("name")}</Label>
                <Input id="model-label" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <dl className="space-y-0.5 text-xs text-muted-foreground" data-model-measures="">
                <dt className="font-medium text-foreground">{t("measured")}</dt>
                <dd>
                  {fmt(pending.result.size.w)} × {fmt(pending.result.size.d)} ×{" "}
                  {fmt(pending.result.size.hgt)} m
                </dd>
                <dd>{t("triangles", { count: pending.result.triangles })}</dd>
                <dd>{t("weight", { mb: fmt(pending.result.byteSize / (1024 * 1024)) })}</dd>
                <dd>
                  {pending.result.clips.length > 0
                    ? t("clips", { list: pending.result.clips.join(", ") })
                    : t("noClips")}
                </dd>
              </dl>
              {dialogError && (
                <Alert variant="destructive" data-model-dialog-error="">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={confirm} disabled={!id}>
              {t("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
