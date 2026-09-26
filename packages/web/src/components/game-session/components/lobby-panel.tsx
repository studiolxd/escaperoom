import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { Button } from "@/components/ui/button";
import { CharacterPicker } from "../character-picker";

export interface LobbyPanelProps {
  pack?: RoomScenePack;
  occupiedCharacterIds: ReadonlySet<string>;
  selectedCharacterId: string | undefined;
  onSelectCharacter: (characterId: string) => void;
  isHost: boolean;
  onStart: () => void;
  inviteUrl?: string | null;
  copied: boolean;
  onCopyInvite: () => void;
  titleLabel: string;
  playersLabel: string;
  startLabel: string;
  waitingHostLabel: string;
  inviteLabel: string;
  copiedLabel: string;
}

/**
 * Lobby de la partida en red: elección de personaje + botón de empezar (solo
 * el anfitrión). El playtest arranca ya en juego (sin lobby) — se salta este
 * punto de montaje sin más (F-5: fácil de sustituir cuando el lobby pase a
 * ser una pantalla propia, próximo encargo).
 */
export function LobbyPanel({
  pack,
  occupiedCharacterIds,
  selectedCharacterId,
  onSelectCharacter,
  isHost,
  onStart,
  inviteUrl,
  copied,
  onCopyInvite,
  titleLabel,
  playersLabel,
  startLabel,
  waitingHostLabel,
  inviteLabel,
  copiedLabel,
}: LobbyPanelProps) {
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
        {isHost ? (
          <Button onClick={onStart} data-testid="game-start">
            {startLabel}
          </Button>
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
