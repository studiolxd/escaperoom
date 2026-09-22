import Phaser from "phaser";
import { normalizeDirection, stepTowards, type Vec2 } from "@/lib/lobby-movement";
import { useLobbyStore, type LobbyPlayer } from "@/store/lobby-store";

/**
 * Escena Phaser del lobby multijugador (ticket 0.5).
 *
 * Dibuja el mismo tilemap isométrico que la demo del 0.4, pero los avatares
 * vienen del estado autoritativo de Colyseus. La posición de cada avatar se
 * interpola hacia la última posición recibida (`target`) para que el
 * movimiento se vea fluido aunque los patches lleguen a 20 Hz. El input (WASD
 * o clic) se envía al servidor en pasos pequeños, que él valida.
 */

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const GRID_SIZE = 10;
const DEPTH_STEP = GRID_SIZE + 1;

const FLOOR_A = 0x243244;
const FLOOR_B = 0x1c2636;
const FLOOR_EDGE = 0x0f172a;

const FLOOR_CENTER = {
  x: 0,
  y: ((GRID_SIZE - 1) * TILE_HEIGHT) / 2,
} as const;

/** Cada cuánto se envía un paso de movimiento al servidor. */
const SEND_INTERVAL_MS = 60;

/** Tamaño del paso enviado (≤ MAX_STEP_PER_TICK del servidor). */
const MAX_STEP = 0.4;

/** Factor de suavizado de la interpolación (por segundo). */
const INTERPOLATION_BASE = 0.0001;

/** Tolerancia para dar por confirmado un paso autoritativo. */
const CONFIRM_EPSILON = 0.05;

type SendMove = (x: number, y: number) => void;

interface Avatar {
  id: string;
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  current: Vec2;
  target: Vec2;
}

interface MovementKeys {
  w: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
}

const isoDepth = (x: number, y: number): number => (x + y) * DEPTH_STEP + x;

const shortId = (id: string): string => id.slice(0, 4);

export class LobbyTestScene extends Phaser.Scene {
  private readonly avatars = new Map<string, Avatar>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys?: MovementKeys;
  private clickTarget: Vec2 | null = null;
  private pendingTarget: Vec2 | null = null;
  private lastSendAt = 0;
  private unsubscribeStore?: () => void;

  constructor() {
    super("lobby_test");
  }

  create(): void {
    this.drawFloor();
    this.configureCamera();
    this.setupInput();

    this.syncAvatars(useLobbyStore.getState().players);
    this.unsubscribeStore = useLobbyStore.subscribe((state) => {
      this.syncAvatars(state.players);
      if (state.error) {
        // Un rechazo del servidor invalida el paso en vuelo: re-sincronizamos.
        this.pendingTarget = null;
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeStore?.();
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
      this.avatars.clear();
    });
  }

  update(time: number, delta: number): void {
    const smoothing = 1 - Math.pow(INTERPOLATION_BASE, delta / 1000);

    for (const avatar of this.avatars.values()) {
      avatar.current.x = Phaser.Math.Linear(avatar.current.x, avatar.target.x, smoothing);
      avatar.current.y = Phaser.Math.Linear(avatar.current.y, avatar.target.y, smoothing);

      const { x, y } = this.tileToScreen(avatar.current.x, avatar.current.y);
      avatar.container.setPosition(x, y);
      avatar.container.setDepth(isoDepth(avatar.current.x, avatar.current.y));
    }

    this.sendMovement(time);
  }

  // --- Estado -------------------------------------------------------------

  private syncAvatars(players: Record<string, LobbyPlayer>): void {
    const { selfId } = useLobbyStore.getState();
    const alive = new Set<string>();

    for (const player of Object.values(players)) {
      alive.add(player.id);
      const existing = this.avatars.get(player.id);
      if (existing) {
        existing.target = { x: player.x, y: player.y };
        existing.label.setText(this.labelFor(player.id, selfId));
      } else {
        this.avatars.set(player.id, this.createAvatar(player, selfId));
      }
    }

    for (const [id, avatar] of this.avatars) {
      if (!alive.has(id)) {
        avatar.container.destroy();
        this.avatars.delete(id);
      }
    }
  }

  private createAvatar(player: LobbyPlayer, selfId: string | null): Avatar {
    const color = Phaser.Display.Color.HexStringToColor(player.tint).color;
    const shadow = this.add.ellipse(0, 10, 44, 18, 0x000000, 0.35);
    const body = this.add.circle(0, -16, 15, color, 1).setStrokeStyle(3, 0xffffff, 0.85);
    const label = this.add
      .text(0, -46, this.labelFor(player.id, selfId), {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#e2e8f0",
        backgroundColor: "#0f172acc",
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);

    const position = { x: player.x, y: player.y };
    const { x, y } = this.tileToScreen(position.x, position.y);
    const container = this.add.container(x, y, [shadow, body, label]);

    return { id: player.id, container, label, current: { ...position }, target: { ...position } };
  }

  private labelFor(id: string, selfId: string | null): string {
    return id === selfId ? `${shortId(id)} (tú)` : shortId(id);
  }

  // --- Input --------------------------------------------------------------

  private setupInput(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.keys = {
        w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tile = this.screenToTile(world.x, world.y);
    this.clickTarget = {
      x: Phaser.Math.Clamp(tile.x, 0, GRID_SIZE - 1),
      y: Phaser.Math.Clamp(tile.y, 0, GRID_SIZE - 1),
    };
  }

  /**
   * Direcciones en espacio de grid equivalentes a las teclas de pantalla:
   * "arriba" resta en ambos ejes, etc. Así WASD se siente natural sobre el
   * rombo isométrico.
   */
  private readDirection(): Vec2 | null {
    let x = 0;
    let y = 0;
    const up = this.cursors?.up.isDown || this.keys?.w.isDown;
    const down = this.cursors?.down.isDown || this.keys?.s.isDown;
    const left = this.cursors?.left.isDown || this.keys?.a.isDown;
    const right = this.cursors?.right.isDown || this.keys?.d.isDown;

    if (up) {
      x -= 1;
      y -= 1;
    }
    if (down) {
      x += 1;
      y += 1;
    }
    if (left) {
      x -= 1;
      y += 1;
    }
    if (right) {
      x += 1;
      y -= 1;
    }

    return normalizeDirection(x, y);
  }

  // --- Red ----------------------------------------------------------------

  private sendMovement(time: number): void {
    if (time - this.lastSendAt < SEND_INTERVAL_MS) {
      return;
    }

    const state = useLobbyStore.getState();
    if (state.status !== "connected" || !state.selfId) {
      return;
    }
    const self = state.players[state.selfId];
    if (!self) {
      return;
    }

    const send = this.registry.get("sendMove") as SendMove | undefined;
    if (!send) {
      return;
    }

    if (this.pendingTarget) {
      const remaining = Phaser.Math.Distance.Between(
        self.x,
        self.y,
        this.pendingTarget.x,
        this.pendingTarget.y,
      );
      if (remaining > CONFIRM_EPSILON) {
        // Esperamos a que el servidor confirme el paso anterior; así nunca
        // enviamos dos pasos desde una posición ya desactualizada.
        return;
      }
      this.pendingTarget = null;
      if (state.error) {
        state.setError(null);
      }
    }

    const direction = this.readDirection();
    let next: Vec2 | null = null;

    if (direction) {
      this.clickTarget = null;
      next = {
        x: self.x + direction.x * MAX_STEP,
        y: self.y + direction.y * MAX_STEP,
      };
    } else if (this.clickTarget) {
      next = stepTowards({ x: self.x, y: self.y }, this.clickTarget, MAX_STEP);
      const remaining = Phaser.Math.Distance.Between(
        self.x,
        self.y,
        this.clickTarget.x,
        this.clickTarget.y,
      );
      if (remaining <= MAX_STEP) {
        this.clickTarget = null;
      }
    }

    if (!next) {
      return;
    }

    this.lastSendAt = time;
    this.pendingTarget = { x: next.x, y: next.y };
    send(next.x, next.y);
  }

  // --- Proyección isométrica ---------------------------------------------

  private tileToScreen(tx: number, ty: number): Vec2 {
    return {
      x: (tx - ty) * (TILE_WIDTH / 2),
      y: (tx + ty) * (TILE_HEIGHT / 2),
    };
  }

  private screenToTile(worldX: number, worldY: number): Vec2 {
    return {
      x: Math.round(worldX / TILE_WIDTH + worldY / TILE_HEIGHT),
      y: Math.round(worldY / TILE_HEIGHT - worldX / TILE_WIDTH),
    };
  }

  private drawFloor(): void {
    const graphics = this.add.graphics();
    graphics.setDepth(0);

    for (let ty = 0; ty < GRID_SIZE; ty += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const { x, y } = this.tileToScreen(tx, ty);
        graphics.fillStyle((tx + ty) % 2 === 0 ? FLOOR_A : FLOOR_B, 1);
        graphics.lineStyle(1, FLOOR_EDGE, 1);
        graphics.beginPath();
        graphics.moveTo(x, y - TILE_HEIGHT / 2);
        graphics.lineTo(x + TILE_WIDTH / 2, y);
        graphics.lineTo(x, y + TILE_HEIGHT / 2);
        graphics.lineTo(x - TILE_WIDTH / 2, y);
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();
      }
    }
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    camera.setBackgroundColor("#0b1120");
    camera.setBounds(-540, -400, 1080, 960);
    camera.centerOn(FLOOR_CENTER.x, FLOOR_CENTER.y);
  }
}
