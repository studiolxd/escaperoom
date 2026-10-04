"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const ModelViewer3D = dynamic(() => import("../models/model-viewer-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

/** Fila de `GET /api/admin/moderation/rooms/:roomId/models`. */
export type ModerationRoomModel = {
  id: string;
  label: string;
  url: string;
  size: { w: number; d: number; hgt: number };
  triangles: number;
  byteSize: number;
  clips: string[];
};

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * «Ver modelos 3D» (specs/17 §4): abre los modelos propios de la última versión publicada de una
 * sala reportada en un visor 3D. La lista se pide al abrir.
 */
export function RoomModelsDialog({ roomId }: { roomId: string }) {
  const t = useTranslations("Moderation.models");
  const tViewer = useTranslations("RoomEditor.models");
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModerationRoomModel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setModels(null);
    setFailed(false);
    fetch(`/api/admin/moderation/rooms/${encodeURIComponent(roomId)}/models`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { models: ModerationRoomModel[] };
      })
      .then((body) => {
        if (cancelled) return;
        setModels(body.models);
        setSelected(body.models[0]?.id);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, roomId]);

  const current = models?.find((m) => m.id === selected);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-view-models={roomId}>
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>{t("loadError")}</AlertDescription>
          </Alert>
        ) : models === null ? (
          <Skeleton className="h-[420px] w-full" data-models-loading="" />
        ) : models.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
            <ul className="space-y-1" data-models-list="">
              {models.map((m) => (
                <li key={m.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-auto w-full flex-col items-start gap-0.5 rounded border p-2 text-left text-xs",
                      m.id === selected ? "border-primary bg-primary/10" : "border-border",
                    )}
                    aria-pressed={m.id === selected}
                    data-model-row={m.id}
                    onClick={() => setSelected(m.id)}
                  >
                    <span className="font-medium">{m.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{m.id}</span>
                    <span className="text-muted-foreground">
                      {fmt(m.size.w)} × {fmt(m.size.d)} × {fmt(m.size.hgt)} m ·{" "}
                      {tViewer("triangles", { count: m.triangles })} ·{" "}
                      {tViewer("weight", { mb: fmt(m.byteSize / (1024 * 1024)) })}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
            <div className="h-[420px]">
              {current && <ModelViewer3D key={current.id} url={current.url} className="h-full" />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
