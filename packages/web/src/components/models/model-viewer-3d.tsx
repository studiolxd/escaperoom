"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ModelViewer } from "@escaperoom/game-runtime/three";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

const NO_CLIP = "__none__";

/**
 * Visor 3D de un GLB suelto (specs/27 §9): subida de modelos y moderación. La escena vive en
 * `ModelViewer` (game-runtime); aquí solo se monta y se pintan los controles. Se importa SIEMPRE
 * con `dynamic(..., { ssr: false })` para no arrastrar Three.js a las páginas que no lo usan.
 */
export default function ModelViewer3D({ url, className }: { url: string; className?: string }) {
  const t = useTranslations("ModelViewer");
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ModelViewer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [clips, setClips] = useState<string[]>([]);
  const [clip, setClip] = useState(NO_CLIP);
  const [original, setOriginal] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setState("loading");
    setClips([]);
    setClip(NO_CLIP);
    setOriginal(false);
    let viewer: ModelViewer;
    try {
      viewer = new ModelViewer(container);
    } catch {
      setState("error");
      return;
    }
    viewerRef.current = viewer;
    let cancelled = false;
    viewer.load(url).then(
      (loaded) => {
        if (cancelled) return;
        setClips(loaded.clips);
        setState("ready");
      },
      () => {
        if (!cancelled) setState("error");
      },
    );
    return () => {
      cancelled = true;
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [url]);

  const toggleMaterial = (checked: boolean) => {
    setOriginal(checked);
    viewerRef.current?.setMaterial(checked ? "original" : "toon");
  };

  const pickClip = (value: string) => {
    setClip(value);
    viewerRef.current?.setClip(value === NO_CLIP ? null : value);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)} data-model-viewer="">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md">
        <div ref={containerRef} className="absolute inset-0" aria-hidden />
        {state === "loading" && <Skeleton className="absolute inset-0" data-viewer-loading="" />}
        {state === "error" && (
          <Alert variant="destructive" className="absolute inset-x-2 top-2 w-auto">
            <AlertDescription>{t("error")}</AlertDescription>
          </Alert>
        )}
      </div>
      {state === "ready" && (
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <Label className="gap-2 text-xs font-normal">
            {t("originalMaterial")}
            <Switch checked={original} onCheckedChange={toggleMaterial} data-viewer-material="" />
          </Label>
          {clips.length > 0 && (
            <Label className="gap-2 text-xs font-normal">
              {t("clip")}
              <Select value={clip} onValueChange={pickClip}>
                <SelectTrigger size="sm" aria-label={t("clip")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIP}>{t("noClip")}</SelectItem>
                  {clips.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
          )}
        </div>
      )}
    </div>
  );
}
