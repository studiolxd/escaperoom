// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { RuntimeObject } from "@escaperoom/game-runtime";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuPopover } from "../../src/components/game-session/components/context-menu-popover";

/**
 * Menú contextual del objeto: con varios objetos apilados en la misma celda
 * (bodega (3,0): mural, ranura y compartimento), deja elegir a cuál se
 * aplica la acción — un clic en el canvas solo acierta al de encima.
 */

const NAMES: Record<string, string> = {
  "mural-vendimia": "El mural de la vendimia",
  "mural-ranura": "La ranura del mural",
  "compartimento-plata": "El compartimento secreto",
};

function object(id: string): RuntimeObject {
  return { id, position: { x: 3, y: 0 }, interactable: true } as unknown as RuntimeObject;
}

function renderMenu(selected: string, alternatives: RuntimeObject[]) {
  const onSelectObject = vi.fn();
  const onInspect = vi.fn();
  render(
    <ContextMenuPopover
      object={object(selected)}
      alternatives={alternatives}
      onSelectObject={onSelectObject}
      onOpenChange={() => undefined}
      onEscapeKeyDown={() => undefined}
      objectName={(id) => NAMES[id] ?? id}
      onInspect={onInspect}
      onPickItem={() => undefined}
      onCancel={() => undefined}
      inspectLabel="Inspeccionar"
      useItemLabel="Usar objeto…"
      cancelLabel="Cancelar"
      pickupLabel="Recoger"
      alternativesLabel="Objetos en este sitio"
    />,
  );
  return { onSelectObject, onInspect };
}

afterEach(cleanup);

describe("ContextMenuPopover: objetos apilados en la misma celda", () => {
  it("lista los objetos de la celda y marca el seleccionado", () => {
    renderMenu("mural-ranura", [
      object("mural-vendimia"),
      object("compartimento-plata"),
      object("mural-ranura"),
    ]);
    const group = screen.getByRole("group", { name: "Objetos en este sitio" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "La ranura del mural" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "El mural de la vendimia" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("elegir otro objeto de la celda lo selecciona (la acción va a ese)", async () => {
    const { onSelectObject } = renderMenu("mural-ranura", [
      object("mural-vendimia"),
      object("mural-ranura"),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "El mural de la vendimia" }));
    expect(onSelectObject).toHaveBeenCalledWith("mural-vendimia");
  });

  it("un objeto solo en su celda: sin selector", () => {
    renderMenu("mural-vendimia", [object("mural-vendimia")]);
    expect(screen.queryByRole("group", { name: "Objetos en este sitio" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspeccionar" })).toBeInTheDocument();
  });
});

describe("ContextMenuPopover: teclado", () => {
  it("el foco inicial va a la primera acción, no al objeto apilado", async () => {
    renderMenu("mural-ranura", [object("mural-vendimia"), object("mural-ranura")]);
    expect(await screen.findByRole("button", { name: "Inspeccionar" })).toHaveFocus();
  });

  it("las flechas recorren los botones en orden y dan la vuelta; Espacio/Intro pulsan", async () => {
    const { onInspect } = renderMenu("mural-ranura", [
      object("mural-vendimia"),
      object("mural-ranura"),
    ]);
    const user = userEvent.setup();
    const btn = (name: string) => screen.getByRole("button", { name });
    await screen.findByRole("button", { name: "Inspeccionar" });
    await user.keyboard("{ArrowDown}");
    expect(btn("Usar objeto…")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(btn("Cancelar")).toHaveFocus();
    await user.keyboard("{ArrowRight}"); // da la vuelta al primero (objeto apilado)
    expect(btn("El mural de la vendimia")).toHaveFocus();
    await user.keyboard("{ArrowUp}"); // y hacia atrás, al último
    expect(btn("Cancelar")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(btn("Inspeccionar")).toHaveFocus();
    await user.keyboard("{ }");
    expect(onInspect).toHaveBeenCalledTimes(1);
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenCalledTimes(2);
  });

  it("Espacio y las flechas no llegan a window (el runtime les haría preventDefault)", async () => {
    renderMenu("mural-ranura", [object("mural-vendimia"), object("mural-ranura")]);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Inspeccionar" });
    const world = vi.fn();
    const down = (event: KeyboardEvent) => world(`${event.type}:${event.key}`);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", down);
    await user.keyboard("{ }{ArrowDown}");
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", down);
    // Solo el keyup de la flecha pasa (no pulsa nada): Espacio y los keydown, no.
    expect(world.mock.calls).toEqual([["keyup:ArrowDown"]]);
  });
});
