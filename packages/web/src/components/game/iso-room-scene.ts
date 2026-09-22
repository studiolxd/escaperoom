import Phaser from "phaser";
import { TORCH_MAX, useGameStore, type IsoTile } from "@/store/game-store";

/**
 * Escena mínima del tilemap isométrico de prueba (ticket 0.4).
 *
 * No usa assets: dibuja el suelo y unos monolitos con primitivas de Phaser
 * (rombos isométricos), ordena por profundidad (depth-sort) y configura la
 * cámara. Se suscribe al store Zustand compartido: cuando el HUD cambia la
 * luz de la antorcha, la escena atenúa/ilumina; y al hacer clic sobre una
 * casilla escribe la selección en el mismo store para que el HUD la lea.
 */

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const GRID_SIZE = 10;
const DEPTH_STEP = GRID_SIZE + 1;

const FLOOR_A = 0x243244;
const FLOOR_B = 0x1c2636;
const FLOOR_EDGE = 0x0f172a;
const BLOCK_LEFT = 0x334155;
const BLOCK_RIGHT = 0x475569;
const BLOCK_TOP = 0x64748b;
const HIGHLIGHT = 0xfacc15;
const HALO_COLOR = 0xffd27f;

const DEPTH = {
  floor: 0,
  highlight: 50,
  overlay: 1000,
  halo: 1001,
  avatar: 1002,
} as const;

const isoDepth = (x: number, y: number): number => (x + y) * DEPTH_STEP + x;

const FLOOR_CENTER = {
  x: 0,
  y: ((GRID_SIZE - 1) * TILE_HEIGHT) / 2,
} as const;

const PROP_CELLS: readonly IsoTile[] = [
  { x: 2, y: 2 },
  { x: 5, y: 3 },
  { x: 3, y: 6 },
  { x: 7, y: 7 },
];

export class IsoRoomScene extends Phaser.Scene {
  private darkOverlay!: Phaser.GameObjects.Rectangle;
  private halo!: Phaser.GameObjects.Arc;
  private avatar!: Phaser.GameObjects.Container;
  private highlight!: Phaser.GameObjects.Graphics;
  private unsubscribeStore?: () => void;

  constructor() {
    super("iso-room");
  }

  create(): void {
    this.drawFloor();
    this.drawProps();
    this.createHighlight();
    this.createAvatar();
    this.createOverlay();
    this.configureCamera();

    this.renderTorch(useGameStore.getState().torchLevel);
    this.renderTile(useGameStore.getState().tile);

    this.unsubscribeStore = useGameStore.subscribe((state) => {
      this.renderTorch(state.torchLevel);
      this.renderTile(state.tile);
    });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeStore?.();
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  private tileToScreen(tx: number, ty: number): { x: number; y: number } {
    return {
      x: (tx - ty) * (TILE_WIDTH / 2),
      y: (tx + ty) * (TILE_HEIGHT / 2),
    };
  }

  private screenToTile(worldX: number, worldY: number): IsoTile {
    return {
      x: Math.round(worldX / TILE_WIDTH + worldY / TILE_HEIGHT),
      y: Math.round(worldY / TILE_HEIGHT - worldX / TILE_WIDTH),
    };
  }

  private drawFloor(): void {
    const graphics = this.add.graphics();
    graphics.setDepth(DEPTH.floor);

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

  private drawProps(): void {
    for (const cell of PROP_CELLS) {
      const { x, y } = this.tileToScreen(cell.x, cell.y);
      const height = 46;
      const graphics = this.add.graphics();
      graphics.setDepth(isoDepth(cell.x, cell.y));

      graphics.fillStyle(BLOCK_LEFT, 1);
      graphics.beginPath();
      graphics.moveTo(x - TILE_WIDTH / 2, y - height);
      graphics.lineTo(x, y - height + TILE_HEIGHT / 2);
      graphics.lineTo(x, y + TILE_HEIGHT / 2);
      graphics.lineTo(x - TILE_WIDTH / 2, y);
      graphics.closePath();
      graphics.fillPath();

      graphics.fillStyle(BLOCK_RIGHT, 1);
      graphics.beginPath();
      graphics.moveTo(x + TILE_WIDTH / 2, y - height);
      graphics.lineTo(x, y - height + TILE_HEIGHT / 2);
      graphics.lineTo(x, y + TILE_HEIGHT / 2);
      graphics.lineTo(x + TILE_WIDTH / 2, y);
      graphics.closePath();
      graphics.fillPath();

      graphics.fillStyle(BLOCK_TOP, 1);
      graphics.beginPath();
      graphics.moveTo(x, y - height - TILE_HEIGHT / 2);
      graphics.lineTo(x + TILE_WIDTH / 2, y - height);
      graphics.lineTo(x, y - height + TILE_HEIGHT / 2);
      graphics.lineTo(x - TILE_WIDTH / 2, y - height);
      graphics.closePath();
      graphics.fillPath();
    }
  }

  private createHighlight(): void {
    this.highlight = this.add.graphics();
    this.highlight.setDepth(DEPTH.highlight);
  }

  private createAvatar(): void {
    const shadow = this.add.ellipse(0, 10, 46, 20, 0x000000, 0.35);
    const body = this.add.circle(0, -16, 16, 0x38bdf8, 1).setStrokeStyle(3, 0xe0f2fe, 0.9);
    this.avatar = this.add.container(FLOOR_CENTER.x, FLOOR_CENTER.y, [shadow, body]);
    this.avatar.setDepth(DEPTH.avatar);
  }

  private createOverlay(): void {
    this.darkOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x020617)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setAlpha(0.5);

    this.halo = this.add
      .circle(FLOOR_CENTER.x, FLOOR_CENTER.y, 200, HALO_COLOR, 1)
      .setDepth(DEPTH.halo)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.25);
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    camera.setBackgroundColor("#0b1120");
    camera.setBounds(-540, -400, 1080, 960);
    camera.centerOn(FLOOR_CENTER.x, FLOOR_CENTER.y);
  }

  private renderTorch(level: number): void {
    const intensity = Phaser.Math.Clamp(level / TORCH_MAX, 0, 1);
    this.tweens.add({
      targets: this.darkOverlay,
      alpha: Phaser.Math.Linear(0.82, 0.12, intensity),
      duration: 250,
      ease: Phaser.Math.Easing.Sine.Out,
    });
    this.tweens.add({
      targets: this.halo,
      alpha: Phaser.Math.Linear(0.08, 0.45, intensity),
      scale: Phaser.Math.Linear(0.25, 1, intensity),
      duration: 250,
      ease: Phaser.Math.Easing.Sine.Out,
    });
  }

  private renderTile(tile: IsoTile): void {
    const { x, y } = this.tileToScreen(tile.x, tile.y);
    this.highlight.clear();
    this.highlight.lineStyle(3, HIGHLIGHT, 0.9);
    this.highlight.beginPath();
    this.highlight.moveTo(x, y - TILE_HEIGHT / 2);
    this.highlight.lineTo(x + TILE_WIDTH / 2, y);
    this.highlight.lineTo(x, y + TILE_HEIGHT / 2);
    this.highlight.lineTo(x - TILE_WIDTH / 2, y);
    this.highlight.closePath();
    this.highlight.strokePath();
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tile = this.screenToTile(world.x, world.y);
    if (tile.x < 0 || tile.y < 0 || tile.x >= GRID_SIZE || tile.y >= GRID_SIZE) {
      return;
    }
    useGameStore.getState().setTile(tile.x, tile.y);
  }

  private handleResize(): void {
    this.darkOverlay.setSize(this.scale.width, this.scale.height);
    this.cameras.main.centerOn(FLOOR_CENTER.x, FLOOR_CENTER.y);
  }
}
