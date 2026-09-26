import type { ReactNode } from "react";
import type { RuntimeModel, RuntimeObject } from "@escaperoom/game-runtime";
import { Button } from "@/components/ui/button";

export interface ObjectsBarProps {
  model: RuntimeModel;
  objectsLabel: string;
  roomObjects: readonly RuntimeObject[];
  openDoors: readonly RuntimeObject[];
  worldInputEnabled: boolean;
  objectName: (objectId: string) => string;
  goToLabel: (room: string) => string;
  onSelectObject: (objectId: string) => void;
  onEnterRoom: (door: RuntimeObject) => void;
  /** Checklist de la ruta crítica y estado de la partida (propio del playtest, F-5). */
  header?: ReactNode;
  /** Botón de reinicio (propio del playtest, F-5). */
  footer?: ReactNode;
}

export function ObjectsBar({
  model,
  objectsLabel,
  roomObjects,
  openDoors,
  worldInputEnabled,
  objectName,
  goToLabel,
  onSelectObject,
  onEnterRoom,
  header,
  footer,
}: ObjectsBarProps) {
  const disabled = !worldInputEnabled;
  return (
    <div className="flex w-fit max-w-[min(92vw,40rem)] flex-col gap-3 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
      {header}
      <span className="text-[0.65rem] uppercase tracking-wide text-white/40">{objectsLabel}</span>
      <div className="flex flex-wrap gap-2">
        {roomObjects.map((object) => (
          <Button
            key={object.id}
            data-testid={`game-object-${object.id}`}
            size="xs"
            variant="overlay"
            disabled={disabled}
            onClick={() => onSelectObject(object.id)}
          >
            {objectName(object.id)}
          </Button>
        ))}
        {openDoors.map((door) => (
          <Button
            key={door.id}
            size="xs"
            variant="default"
            disabled={disabled}
            onClick={() => onEnterRoom(door)}
          >
            {goToLabel(model.subroomsById[door.leadsTo ?? ""]?.name ?? door.leadsTo ?? "")}
          </Button>
        ))}
        {footer}
      </div>
    </div>
  );
}
