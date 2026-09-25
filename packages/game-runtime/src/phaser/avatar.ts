import Phaser from "phaser";
import {
  AVATAR_ACTION_FRAME_RATE,
  AVATAR_ACTIONS,
  AVATAR_DIRECTIONS,
  AVATAR_ACTION_FRAMES,
  avatarAnimKey,
  avatarFrameName,
  directionFromGridDelta,
  type AvatarAction,
  type AvatarDirection,
  type CollisionGrid,
  type PackManifest,
} from "../pack";
import { isoDepth, tileAnchor } from "./iso";
import type { PackFrameResolver } from "./pack-textures";

/** Tamaño del lienzo de avatar (specs/26 §4.4: ~48×64 a 1×; margen para overhang). */
const AVATAR_SIZE = { width: 64, height: 96 };

/** Franja de profundidad del avatar dentro de su celda. */
export const AVATAR_DEPTH_SUB = 40;

/** Origen (pivote) por defecto: abajo-centro, para packs sin `avatarOrigin` (specs/26 §3.1 previo a A4). */
const DEFAULT_AVATAR_ORIGIN: [number, number] = [0.5, 1];

export interface AvatarControllerOptions {
  scene: Phaser.Scene;
  resolver: PackFrameResolver;
  manifest: PackManifest;
  collision: CollisionGrid;
  start: { x: number; y: number };
  /** Personaje jugable (`manifest.avatars[].id`, o el de reserva). */
  characterId: string;
  /** Color del jugador (círculo del chat): pinta el anillo bajo los pies, no el sprite (B5/A1). */
  tint?: number;
  /** Velocidad en celdas por segundo. */
  speed?: number;
}

export interface AvatarMove {
  /** Componente en celdas (no hace falta normalizar). */
  x: number;
  y: number;
}

/**
 * Avatar del runtime: sprite del atlas (o placeholder) con las animaciones
 * `idle`/`walk`/`interact` × 4 direcciones de un personaje concreto (specs/04
 * §2, A1/B4), con anillo de color de jugador bajo los pies (A1/B5) y
 * movimiento con colisión por celda. El servidor será autoritativo en fase 2;
 * aquí basta para la validación visual de 1.2.
 */
export class AvatarController {
  readonly container: Phaser.GameObjects.Container;

  private readonly scene: Phaser.Scene;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly ring: Phaser.GameObjects.Ellipse;
  private readonly collision: CollisionGrid;
  private readonly speed: number;
  private readonly characterId: string;
  private cell: { x: number; y: number };
  private direction: AvatarDirection = "s";
  private currentAnim?: string;
  private moving = false;
  private interacting = false;

  constructor(options: AvatarControllerOptions) {
    this.scene = options.scene;
    this.collision = options.collision;
    this.speed = options.speed ?? 4;
    this.characterId = options.characterId;
    this.cell = { x: options.start.x, y: options.start.y };

    const first = options.resolver.resolve(
      avatarFrameName(this.characterId, this.direction, "idle", 1),
      AVATAR_SIZE,
    );
    // Sombra de contacto (A5/B5): capa del motor, no del sprite. El anillo de
    // color del jugador se dibuja justo encima, más pequeño, para no ocultar
    // la sombra y para reconocer quién es quién sin leer nombres (A1).
    const shadow = this.scene.add.ellipse(0, 0, 42, 16, 0x000000, 0.32);
    const ring = this.scene.add.ellipse(0, 0, 30, 11);
    ring.setStrokeStyle(2, options.tint ?? 0xffffff, 0.9);
    ring.setFillStyle(options.tint ?? 0xffffff, 0.12);
    this.ring = ring;

    const originY = options.manifest.avatarOrigin?.[1] ?? DEFAULT_AVATAR_ORIGIN[1];
    const originX = options.manifest.avatarOrigin?.[0] ?? DEFAULT_AVATAR_ORIGIN[0];
    this.sprite = this.scene.add.sprite(0, 0, first.key, first.frame).setOrigin(originX, originY);
    const scale = options.resolver.displayScaleFor(first, AVATAR_SIZE);
    this.sprite.setScale(scale.x, scale.y);

    this.registerAnimations(options.resolver, options.manifest);
    this.container = this.scene.add.container(0, 0, [shadow, ring, this.sprite]);
    this.play(avatarAnimKey(this.characterId, this.direction, "idle"));
    this.syncPosition();
  }

  get cellPosition(): { x: number; y: number } {
    return { ...this.cell };
  }

  get gridCell(): { x: number; y: number } {
    return { x: Math.round(this.cell.x), y: Math.round(this.cell.y) };
  }

  /** Reposiciona el avatar (p. ej. al entrar en una sala nueva). */
  setCell(x: number, y: number): void {
    this.cell = { x, y };
    this.syncPosition();
  }

  /** Avanza el avatar según un vector de movimiento en celdas (o `null` si quieto). */
  update(delta: number, move: AvatarMove | null): void {
    if (move && (move.x !== 0 || move.y !== 0)) {
      this.moving = true;
      this.direction = directionFromGridDelta(move.x, move.y);
      const step = this.speed * (delta / 1000);
      this.tryMove(move.x * step, move.y * step);
    } else {
      this.moving = false;
    }

    if (this.interacting) {
      this.play(avatarAnimKey(this.characterId, this.direction, "interact"));
    } else if (this.moving) {
      this.play(avatarAnimKey(this.characterId, this.direction, "walk"));
    } else {
      this.play(avatarAnimKey(this.characterId, this.direction, "idle"));
    }

    this.syncPosition();
  }

  /**
   * Avatar remoto (fase 2): se desliza hacia la posición autoritativa que
   * sincroniza el servidor, sin colisiones (el servidor ya validó el paso) y
   * con la animación de andar mientras se mueve.
   */
  glideToward(target: { x: number; y: number }, delta: number): void {
    const dx = target.x - this.cell.x;
    const dy = target.y - this.cell.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 4) {
      // Salto largo (cambio de sala, reaparición): sin animación intermedia.
      this.cell = { x: target.x, y: target.y };
      this.moving = false;
    } else if (distance > 0.02) {
      const step = Math.min(distance, this.speed * 1.25 * (delta / 1000));
      this.cell = {
        x: this.cell.x + (dx / distance) * step,
        y: this.cell.y + (dy / distance) * step,
      };
      this.direction = directionFromGridDelta(Math.sign(dx), Math.sign(dy));
      this.moving = true;
    } else {
      this.moving = false;
    }
    this.play(avatarAnimKey(this.characterId, this.direction, this.moving ? "walk" : "idle"));
    this.syncPosition();
  }

  /** Cambia el color del anillo (color del jugador asignado por el servidor). */
  setTint(tint: number): void {
    this.ring.setStrokeStyle(2, tint, 0.9);
    this.ring.setFillStyle(tint, 0.12);
  }

  /** Dispara la animación de interacción una vez. */
  interact(): void {
    if (this.interacting) {
      return;
    }
    this.interacting = true;
    this.play(avatarAnimKey(this.characterId, this.direction, "interact"));
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private tryMove(dx: number, dy: number): void {
    const nextX = this.cell.x + dx;
    if (!this.collision.blocks(Math.round(nextX), Math.round(this.cell.y))) {
      this.cell.x = Phaser.Math.Clamp(nextX, 0, this.collision.width - 1);
    }

    const nextY = this.cell.y + dy;
    if (!this.collision.blocks(Math.round(this.cell.x), Math.round(nextY))) {
      this.cell.y = Phaser.Math.Clamp(nextY, 0, this.collision.height - 1);
    }
  }

  private syncPosition(): void {
    const anchor = tileAnchor(this.cell.x, this.cell.y);
    this.container.setPosition(anchor.x, anchor.y);
    this.container.setDepth(isoDepth(this.cell.x, this.cell.y, AVATAR_DEPTH_SUB) + 1);
  }

  private play(key: string): void {
    if (this.currentAnim === key) {
      return;
    }
    this.currentAnim = key;
    if (this.scene.anims.exists(key)) {
      this.sprite.play(key, true);
    }
  }

  private registerAnimations(resolver: PackFrameResolver, manifest: PackManifest): void {
    for (const direction of AVATAR_DIRECTIONS) {
      for (const action of AVATAR_ACTIONS) {
        const key = avatarAnimKey(this.characterId, direction, action);
        if (this.scene.anims.exists(key)) {
          continue;
        }

        const declared = manifest.anims.find((anim) => anim.key === key);
        const frames = declared?.frames ?? this.defaultFrameNames(direction, action);
        const frameRate = declared?.frameRate ?? AVATAR_ACTION_FRAME_RATE[action];
        const repeat = declared?.repeat ?? (action === "interact" ? 0 : -1);

        this.scene.anims.create({
          key,
          frames: frames.map((frame) => {
            const ref = resolver.resolve(frame, AVATAR_SIZE);
            return { key: ref.key, frame: ref.frame };
          }),
          frameRate,
          repeat,
        });
      }
    }

    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.interacting = false;
    });
  }

  private defaultFrameNames(direction: AvatarDirection, action: AvatarAction): string[] {
    return Array.from({ length: AVATAR_ACTION_FRAMES[action] }, (_, index) =>
      avatarFrameName(this.characterId, direction, action, index + 1),
    );
  }
}
