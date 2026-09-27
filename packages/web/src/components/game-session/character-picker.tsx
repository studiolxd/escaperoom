"use client";

import type { CSSProperties } from "react";
import { resolveLocalizedText, type PackAvatar } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "cn";
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
  /** Personaje → nombre y tinte de quien lo tiene (A1: únicos por sesión, solo conectados). */
  occupiedBy: ReadonlyMap<string, { name: string; tint: string }>;
  /** Personaje del jugador local, si ya tiene uno asignado. */
  value?: string;
  /** Color del propio jugador (servidor), para resaltar su selección. */
  selfTint: string;
  onChange: (characterId: string) => void;
}

/**
 * Selector de personaje del lobby (A1/specs/19, B4, encargo retratos):
 * rejilla de retratos redondos por `shadcn/ui` (`RadioGroup`, sin tarjetas
 * ni nombre debajo del propio personaje). El seleccionado se resalta con el
 * tinte del jugador; los personajes ya ocupados por otro conectado se ven
 * atenuados, con el borde del tinte de quien los tiene, no se pueden elegir
 * y muestran su nombre debajo. El servidor es la autoridad — este control
 * solo expresa la intención (`select_character`); si dos jugadores pulsan
 * el mismo a la vez, el servidor resuelve la carrera y el estado
 * sincronizado corrige la selección visible.
 */
export function CharacterPicker({
  pack,
  occupiedBy,
  value,
  selfTint,
  onChange,
}: CharacterPickerProps) {
  const locale = useLocale();
  const t = useTranslations("Game");
  const avatars = pack.manifest.avatars ?? [];
  if (avatars.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-2 text-left">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {t("lobby.chooseCharacter")}
      </span>
      <RadioGroup value={value} onValueChange={onChange} className="grid grid-cols-4 gap-3">
        {avatars.map((avatar) => {
          const occupant = occupiedBy.get(avatar.id);
          const taken = occupant !== undefined && value !== avatar.id;
          const selected = value === avatar.id;
          const label = resolveLocalizedText(avatar.label, locale);
          const tint = taken ? occupant.tint : selected ? selfTint : undefined;

          return (
            <Label
              key={avatar.id}
              title={taken ? occupant.name : label}
              className={cn(
                "flex flex-col items-center gap-1 p-0",
                taken ? "cursor-not-allowed opacity-40" : "cursor-pointer",
              )}
            >
              <RadioGroupItem
                value={avatar.id}
                disabled={taken}
                className="peer sr-only"
                data-testid={`character-option-${avatar.id}`}
              />
              {/* El `aria-label` no llega al `button[role=radio]` (Radix lo
                  descarta en esta versión): el nombre accesible del control
                  sale de este texto, por el envoltorio nativo <label>. */}
              <span className="sr-only">
                {taken ? t("lobby.characterTakenBy", { player: occupant.name }) : label}
              </span>
              <span
                aria-hidden
                style={tint ? ({ "--tint": tint } as CSSProperties) : undefined}
                className={cn(
                  "block size-14 shrink-0 overflow-hidden rounded-full border-2 border-border transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                  taken && "tint-border",
                  selected && "tint-border tint-ring",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- retrato del pack gráfico, no una imagen de Next/Image optimizable en build */}
                <img
                  src={portraitUrl(pack, avatar)}
                  alt=""
                  aria-hidden
                  className="h-full w-full object-cover"
                />
              </span>
              {taken ? (
                <span
                  aria-hidden
                  data-testid={`character-occupant-${avatar.id}`}
                  className="max-w-14 truncate text-center text-[0.6rem] text-muted-foreground"
                >
                  {occupant.name}
                </span>
              ) : null}
            </Label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
