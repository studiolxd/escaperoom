"use client";

import { resolveLocalizedText, type PackAvatar } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/**
 * Retrato de un personaje (specs/19 §1): sin `portrait` declarado en el
 * manifiesto, se usa el primer frame `s-idle` — el mismo que consume el
 * juego, servido directo como PNG (sin pasar por el atlas empaquetado).
 */
function portraitUrl(pack: RoomScenePack, avatar: PackAvatar): string {
  const frame = avatar.portrait ?? `avatar-${avatar.id}-s-idle-1`;
  return `${pack.baseUrl}/avatar/${avatar.id}/${frame}.png`;
}

export interface CharacterPickerProps {
  pack: RoomScenePack;
  /** Personajes ya ocupados por otro jugador conectado (A1: únicos por sesión). */
  occupiedBy: ReadonlySet<string>;
  /** Personaje del jugador local, si ya tiene uno asignado. */
  value?: string;
  onChange: (characterId: string) => void;
}

/**
 * Selector de personaje del lobby (A1/specs/19, B4): retrato + nombre por
 * `shadcn/ui` (`RadioGroup` + `Card`), con los personajes ocupados por otro
 * jugador deshabilitados. El servidor es la autoridad — este control solo
 * expresa la intención (`select_character`); si dos jugadores pulsan el mismo
 * a la vez, el servidor resuelve la carrera y el estado sincronizado corrige
 * la selección visible.
 */
export function CharacterPicker({ pack, occupiedBy, value, onChange }: CharacterPickerProps) {
  const locale = useLocale();
  const t = useTranslations("Game");
  const avatars = pack.manifest.avatars ?? [];
  if (avatars.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-2 text-left">
      <span className="text-[0.65rem] uppercase tracking-wide text-white/50">
        {t("lobby.chooseCharacter")}
      </span>
      <RadioGroup
        value={value}
        onValueChange={onChange}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {avatars.map((avatar) => {
          const taken = occupiedBy.has(avatar.id) && value !== avatar.id;
          const label = resolveLocalizedText(avatar.label, locale);
          return (
            <Label
              key={avatar.id}
              className={`flex-col gap-0 p-0 ${taken ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
            >
              <Card
                className={`w-full gap-1 border-white/10 bg-white/5 py-2 text-white ${
                  value === avatar.id ? "border-sky-400" : ""
                }`}
              >
                <CardContent className="flex flex-col items-center gap-1 px-2">
                  <RadioGroupItem
                    value={avatar.id}
                    disabled={taken}
                    className="sr-only"
                    aria-label={label}
                    data-testid={`character-option-${avatar.id}`}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element -- retrato del pack gráfico, no una imagen de Next/Image optimizable en build */}
                  <img
                    src={portraitUrl(pack, avatar)}
                    alt=""
                    aria-hidden
                    className="h-16 w-auto object-contain"
                  />
                  <span className="text-xs">{label}</span>
                  {taken ? (
                    <span className="text-[0.6rem] text-white/50">{t("lobby.characterTaken")}</span>
                  ) : null}
                </CardContent>
              </Card>
            </Label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
