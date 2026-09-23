import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ValidateOptions } from "@escaperoom/shared/validator";
import type * as Y from "yjs";
import {
  createRoomValidator,
  INITIAL_VALIDATION_STATE,
  type RoomValidationState,
  type RoomValidator,
} from "./controller";
import type { RoomPackageSerializer } from "./serializer";

export type UseRoomValidationOptions = {
  debounceMs?: number;
  validateOptions?: ValidateOptions;
};

const noopSubscribe = () => () => {};
const initialSnapshot = () => INITIAL_VALIDATION_STATE;

/**
 * Validación continua del doc como estado React: `issues` alimenta
 * `<RulesGraph issues>` (vía `ruleGraphIssues`) y el resto del editor;
 * `report` y `findings` van a `<ValidationPanel>`. El serializador puede
 * cambiar de identidad entre renders sin recrear el validador.
 */
export function useRoomValidation(
  doc: Y.Doc,
  serialize: RoomPackageSerializer,
  options: UseRoomValidationOptions = {},
): RoomValidationState & { validateNow: () => void } {
  const serializeRef = useRef(serialize);
  useEffect(() => {
    serializeRef.current = serialize;
  }, [serialize]);

  const { debounceMs, validateOptions } = options;
  const [validator, setValidator] = useState<RoomValidator | null>(null);
  useEffect(() => {
    const created = createRoomValidator({
      doc,
      serialize: (d) => serializeRef.current(d),
      ...(debounceMs !== undefined ? { debounceMs } : {}),
      ...(validateOptions !== undefined ? { validateOptions } : {}),
    });
    setValidator(created);
    return () => created.destroy();
  }, [doc, debounceMs, validateOptions]);

  const state = useSyncExternalStore(
    validator?.subscribe ?? noopSubscribe,
    validator?.getState ?? initialSnapshot,
    initialSnapshot,
  );
  return { ...state, validateNow: () => void validator?.validateNow() };
}
