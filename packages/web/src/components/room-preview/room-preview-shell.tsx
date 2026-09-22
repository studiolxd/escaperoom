"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import { Button } from "@/components/ui/button";
import type { RoomPreviewPack } from "@/lib/room-preview-pack";

const RoomPreviewCanvas = dynamic(() => import("./room-preview-canvas"), {
  ssr: false,
  loading: () => <RoomPreviewLoading />,
});

function RoomPreviewLoading() {
  const t = useTranslations("RoomPreview");
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      {t("loading")}
    </div>
  );
}

/**
 * Previsualización del RoomPackage del Rey Aldric montando el runtime de
 * producto (tickets 1.1 y 1.2): Phaser renderiza el tilemap isométrico real
 * (tiles + sprites del pack, o placeholders automáticos) y este overlay React
 * permite cambiar entre las 3 subrooms.
 *
 * Solo se pasan al cliente los datos del modelo (sin secretos de puzzles) y el
 * manifiesto del pack, serializados por el Server Component de la ruta.
 */
export function RoomPreviewShell({ model, pack }: { model: RuntimeModel; pack?: RoomPreviewPack }) {
  const t = useTranslations("RoomPreview");
  const [activeRoomId, setActiveRoomId] = useState(model.subrooms[0]?.id ?? "");
  const activeRoom = model.subroomsById[activeRoomId] ?? model.subrooms[0];

  return (
    <section className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <RoomPreviewCanvas model={model} roomId={activeRoomId} pack={pack} />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
        <header className="pointer-events-auto flex w-fit max-w-[min(92vw,44rem)] flex-col gap-1 rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-white backdrop-blur">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{model.meta.title}</span>
            <span className="text-white/50">· {t("badge")}</span>
          </div>
          <p className="max-w-2xl text-xs text-white/60">{model.meta.description}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className={pack ? "text-emerald-300" : "text-amber-300"}>
              {pack ? t("packLoaded", { packId: pack.manifest.id }) : t("packPlaceholder")}
            </span>
            <span className="text-white/40">{t("controls")}</span>
          </div>
        </header>

        <div className="pointer-events-auto flex w-fit max-w-[min(92vw,44rem)] flex-col gap-3 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-white/50">{t("rooms")}</span>
            {model.subrooms.map((room) => (
              <Button
                key={room.id}
                variant={room.id === activeRoomId ? "default" : "ghost"}
                size="sm"
                aria-pressed={room.id === activeRoomId}
                onClick={() => setActiveRoomId(room.id)}
                className={
                  room.id === activeRoomId
                    ? undefined
                    : "text-white hover:bg-white/10 hover:text-white"
                }
              >
                {room.name}
              </Button>
            ))}
          </div>

          {activeRoom ? (
            <div className="flex flex-wrap items-center gap-4 border-t border-white/10 pt-2 text-xs text-white/60">
              <span>
                id <span className="font-mono text-white/90">{activeRoom.id}</span>
              </span>
              <span>
                {t("grid")}{" "}
                <span className="font-mono text-white/90">
                  {activeRoom.width}×{activeRoom.height}
                </span>
              </span>
              <span>
                {t("objects")}{" "}
                <span className="font-mono text-white/90">{activeRoom.objects.length}</span>
              </span>
              <span>
                {t("spawns")}{" "}
                <span className="font-mono text-white/90">{activeRoom.spawns.length}</span>
              </span>
            </div>
          ) : null}

          {activeRoom ? (
            <ul className="flex max-h-28 flex-wrap gap-1.5 overflow-auto text-[0.7rem]">
              {activeRoom.objects.map((object) => (
                <li
                  key={object.id}
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-white/70"
                >
                  {object.id}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
