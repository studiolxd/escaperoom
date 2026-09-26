"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { createLocalGameClient } from "@escaperoom/game-runtime/session";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";
import { GameSessionShell } from "@/components/game-session/game-session-shell";
import type { IntroModel } from "@/lib/intro-model";
import { reyAldricSteps } from "@/lib/rey-aldric-route";

export interface RoomPlaytestShellProps {
  model: RuntimeModel;
  /**
   * Contrato completo de la sala. En producción la validación de los puzzles
   * vive en el servidor (`GameRoom`, 2.8); esta ruta es una **previsualización
   * de desarrollo** que ejecuta el mismo `RoomSession` en el cliente (vía
   * `createLocalGameClient`, F-5) para poder recorrer el Rey Aldric sin
   * infraestructura.
   */
  roomPackage: RoomPackage;
  pack?: RoomScenePack;
  /** Introducción de la sala ya resuelta (texto o vídeo), si la tiene. */
  intro?: IntroModel | null;
}

const PLAYER_ID = "p1";

/**
 * Playtest del **Rey Aldric completo** (tickets 1.10, 1.14, 2.8, F-5): monta
 * `GameSessionShell` — el mismo HUD de la partida real — sobre
 * `createLocalGameClient` (`@escaperoom/game-runtime/session`), que emula la
 * `GameRoom` en proceso sobre el mismo `RoomSession` autoritativo. Así toda
 * corrección del HUD (paneles, inventario, pistas…) vale para la partida y
 * el playtest a la vez, sin dos máquinas de estados paralelas.
 *
 * Lo propio del playtest —el checklist de la ruta
 * crítica, el botón de reinicio, el registro de depuración— entra por los
 * slots de `GameSessionShell` (`variant="playtest"`, `objectsBarHeader`,
 * `objectsBarFooter`), nunca reimplementado.
 */
export function RoomPlaytestShell({ model, roomPackage, pack, intro }: RoomPlaytestShellProps) {
  const t = useTranslations("Playtest");

  // Encargo lobby-diseño: el playtest pasa por el MISMO lobby que la
  // partida real (elegir personaje, «Listo», «Empezar»), luego la
  // introducción (si la hay) y el 3-2-1 — ya no arranca solo al montar.
  const [client] = useState(() => createLocalGameClient(roomPackage, { playerId: PLAYER_ID }));

  // Fuerza el re-render en cada cambio de estado de la sesión local: el
  // checklist y el badge de "completado" leen `client.session` directamente
  // (datos que el `GameSnapshot` público no expone, F-5).
  useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const steps = reyAldricSteps(client.session);
  const victory = client.session.state.result === "victory";

  const reset = () => window.location.reload();

  return (
    <GameSessionShell
      model={model}
      pack={pack}
      client={client}
      intro={intro}
      variant="playtest"
      showChat={false}
      objectsBarHeader={
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-wide text-white/50">{t("steps")}</span>
            <span className={victory ? "text-xs text-emerald-300" : "text-xs text-white/50"}>
              {victory ? t("complete") : t("inProgress")}
            </span>
          </div>
          <ol className="flex flex-wrap gap-1.5" data-testid="playtest-steps">
            {steps.map((step, index) => (
              <li
                key={step.id}
                data-done={step.done}
                className={
                  step.done
                    ? "rounded-full border border-emerald-300/50 bg-emerald-300/10 px-2.5 py-0.5 text-[0.7rem] text-emerald-100"
                    : "rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[0.7rem] text-white/60"
                }
              >
                {index + 1}. {t(`step.${step.id}`)}
              </li>
            ))}
          </ol>
        </div>
      }
      objectsBarFooter={
        <Button size="xs" variant="overlayGhost" onClick={reset}>
          {t("action.reset")}
        </Button>
      }
    />
  );
}
