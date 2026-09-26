import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CharacterPicker } from "../character-picker";

export interface LobbyPanelProps {
  pack?: RoomScenePack;
  occupiedCharacterIds: ReadonlySet<string>;
  selectedCharacterId: string | undefined;
  onSelectCharacter: (characterId: string) => void;
  isHost: boolean;
  /** C-13: todos los conectados están "Listo" (el propio anfitrión incluido). */
  allReady: boolean;
  /** "Listo" del jugador local (C-13). */
  isReady: boolean;
  onToggleReady: (ready: boolean) => void;
  /** `force = true` es "Empezar igualmente" (nunca por debajo del mínimo). */
  onStart: (force?: boolean) => void;
  inviteUrl?: string | null;
  copied: boolean;
  onCopyInvite: () => void;
  titleLabel: string;
  playersLabel: string;
  startLabel: string;
  startForceLabel: string;
  startNotReadyLabel: string;
  confirmForceTitleLabel: string;
  confirmForceConfirmLabel: string;
  confirmForceCancelLabel: string;
  markReadyLabel: string;
  readyLabel: string;
  waitingHostLabel: string;
  inviteLabel: string;
  copiedLabel: string;
}

/**
 * Lobby de la partida en red: elección de personaje, "Listo" (C-13) y botón
 * de empezar (solo el anfitrión, que exige a todos "Listo" salvo que fuerce
 * "Empezar igualmente" — nunca por debajo del mínimo, lo valida el servidor).
 * El playtest arranca ya en juego (sin lobby) — se salta este punto de
 * montaje sin más (F-5: fácil de sustituir cuando el lobby pase a ser una
 * pantalla propia, encargo del rediseño completo, fuera de esta entrega).
 */
export function LobbyPanel({
  pack,
  occupiedCharacterIds,
  selectedCharacterId,
  onSelectCharacter,
  isHost,
  allReady,
  isReady,
  onToggleReady,
  onStart,
  inviteUrl,
  copied,
  onCopyInvite,
  titleLabel,
  playersLabel,
  startLabel,
  startForceLabel,
  startNotReadyLabel,
  confirmForceTitleLabel,
  confirmForceConfirmLabel,
  confirmForceCancelLabel,
  markReadyLabel,
  readyLabel,
  waitingHostLabel,
  inviteLabel,
  copiedLabel,
}: LobbyPanelProps) {
  const [confirmingForce, setConfirmingForce] = useState(false);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-4"
      data-testid="game-lobby"
    >
      <div className="pointer-events-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-white/10 bg-slate-950/95 px-6 py-5 text-center text-white shadow-xl">
        <h2 className="text-base font-semibold">{titleLabel}</h2>
        <p className="text-sm text-white/70">{playersLabel}</p>
        {pack ? (
          <CharacterPicker
            pack={pack}
            occupiedBy={occupiedCharacterIds}
            value={selectedCharacterId}
            onChange={onSelectCharacter}
          />
        ) : null}
        <Button
          size="sm"
          variant={isReady ? "secondary" : "default"}
          data-testid="lobby-ready"
          onClick={() => onToggleReady(!isReady)}
        >
          {isReady ? readyLabel : markReadyLabel}
        </Button>
        {isHost ? (
          confirmingForce ? (
            <div className="flex flex-col items-center gap-2 text-sm">
              <p>{confirmForceTitleLabel}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  data-testid="lobby-start-force-confirm"
                  onClick={() => {
                    setConfirmingForce(false);
                    onStart(true);
                  }}
                >
                  {confirmForceConfirmLabel}
                </Button>
                <Button size="sm" variant="overlayGhost" onClick={() => setConfirmingForce(false)}>
                  {confirmForceCancelLabel}
                </Button>
              </div>
            </div>
          ) : allReady ? (
            <Button onClick={() => onStart()} data-testid="game-start">
              {startLabel}
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <p className="text-xs text-white/60">{startNotReadyLabel}</p>
              <Button
                size="sm"
                variant="overlayGhost"
                data-testid="lobby-start-force"
                onClick={() => setConfirmingForce(true)}
              >
                {startForceLabel}
              </Button>
            </div>
          )
        ) : (
          <p className="text-sm text-white/60">{waitingHostLabel}</p>
        )}
        {inviteUrl ? (
          <Button size="sm" variant="overlayGhost" onClick={onCopyInvite}>
            {copied ? copiedLabel : inviteLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
