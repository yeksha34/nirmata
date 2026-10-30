import Phaser from "phaser";
import { useEffect, useRef } from "react";
import type { VnStageCharacter, VnStageState } from "../types";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const SLOT_X: Record<string, number> = {
  left: CANVAS_WIDTH * 0.22,
  center: CANVAS_WIDTH * 0.5,
  right: CANVAS_WIDTH * 0.78,
};

/** Palette for atmospheric procedural background cards */
function getAtmosphereColors(bgName?: string): { top: number; bottom: number } {
  const name = (bgName || "").toLowerCase();
  if (name.includes("night") || name.includes("dark")) {
    return { top: 0x0f141c, bottom: 0x1e2838 };
  }
  if (name.includes("dusk") || name.includes("sunset") || name.includes("embers")) {
    return { top: 0x2b141e, bottom: 0x8a3c20 };
  }
  if (name.includes("forest") || name.includes("grove") || name.includes("garden")) {
    return { top: 0x122416, bottom: 0x27462c };
  }
  if (name.includes("water") || name.includes("river") || name.includes("sea")) {
    return { top: 0x0a1e28, bottom: 0x1c4456 };
  }
  if (name.includes("temple") || name.includes("shrine") || name.includes("palace")) {
    return { top: 0x2d1f12, bottom: 0x5a3e22 };
  }
  // Default warm earth
  return { top: 0x231d16, bottom: 0x42372a };
}

/**
 * Phaser Scene implementing the 2D layered visual novel stage:
 * Layer 1: Background (Image or procedural atmosphere gradient)
 * Layer 2: Character Sprites (Left, Center, Right slots with stone sculpture placeholders)
 * Layer 3: CG Overlay
 */
class VnStageScene extends Phaser.Scene {
  private bgGraphics!: Phaser.GameObjects.Graphics;
  private bgText!: Phaser.GameObjects.Text;
  private spriteContainer!: Phaser.GameObjects.Container;
  private cgContainer!: Phaser.GameObjects.Container;
  private currentStage?: VnStageState;

  constructor() {
    super({ key: "VnStageScene" });
  }

  create() {
    // 1. Background Graphics
    this.bgGraphics = this.add.graphics();
    this.bgText = this.add
      .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT * 0.2, "", {
        fontFamily: "'Newsreader Variable', serif",
        fontSize: "26px",
        fontStyle: "italic",
        color: "rgba(255, 255, 255, 0.45)",
      })
      .setOrigin(0.5);

    // 2. Sprites layer
    this.spriteContainer = this.add.container(0, 0);

    // 3. CG overlay layer
    this.cgContainer = this.add.container(0, 0);

    if (this.currentStage) {
      this.renderStage(this.currentStage);
    }
  }

  public updateStage(stage: VnStageState) {
    this.currentStage = stage;
    if (this.bgGraphics) {
      this.renderStage(stage);
    }
  }

  private renderStage(stage: VnStageState) {
    this.renderBackground(stage.bg, stage.transition);
    this.renderSprites(stage.characters);
    this.renderCg(stage.cg);
  }

  private renderBackground(bgName?: string, transition?: string) {
    this.bgGraphics.clear();
    const colors = getAtmosphereColors(bgName);

    // Procedural gradient fill
    this.bgGraphics.fillGradientStyle(
      colors.top,
      colors.top,
      colors.bottom,
      colors.bottom,
      1,
      1,
      1,
      1,
    );
    this.bgGraphics.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Subtle atmospheric grid / temple contour lines
    this.bgGraphics.lineStyle(1, 0xffffff, 0.04);
    for (let y = 40; y < CANVAS_HEIGHT; y += 40) {
      this.bgGraphics.lineBetween(0, y, CANVAS_WIDTH, y);
    }

    // Watermark label of scene background
    if (bgName) {
      const cleanName = bgName.replace(/_/g, " ").toUpperCase();
      this.bgText.setText(`[ ${cleanName} ]`);
    } else {
      this.bgText.setText("");
    }

    // Transition effect
    if (transition === "fade in" || transition === "dissolve") {
      this.cameras.main.fadeIn(400, 0, 0, 0);
    }
  }

  private renderSprites(characters: VnStageCharacter[]) {
    this.spriteContainer.removeAll(true);

    for (const char of characters) {
      const slotX = SLOT_X[char.slot] ?? CANVAS_WIDTH * 0.5;
      const charGroup = this.add.container(slotX, CANVAS_HEIGHT * 0.55);

      // Render procedural Classical Hindu Temple Sculpture figure aesthetic
      // (Monochromatic carved stone body with realistic ornamental gold highlights)
      const stoneGraphics = this.add.graphics();

      // Soft ground cast shadow
      stoneGraphics.fillStyle(0x000000, 0.25);
      stoneGraphics.fillEllipse(0, 200, 220, 45);

      // Freestanding sculpture pedestal
      stoneGraphics.fillStyle(0x3b352e, 0.95);
      stoneGraphics.fillRoundedRect(-110, 180, 220, 24, 6);
      stoneGraphics.lineStyle(2, 0xd4af37, 0.4); // Golden pedestal trim
      stoneGraphics.strokeRoundedRect(-110, 180, 220, 24, 6);

      // Sculptural body card silhouette (Sandstone / Basalt texture aesthetic)
      stoneGraphics.fillStyle(0x4a4237, 0.95);
      stoneGraphics.fillRoundedRect(-85, -160, 170, 340, 16);
      stoneGraphics.lineStyle(2, 0x827361, 0.7);
      stoneGraphics.strokeRoundedRect(-85, -160, 170, 340, 16);

      // Tribhanga graceful curvature line indicator
      stoneGraphics.lineStyle(3, 0x2a241c, 0.5);
      stoneGraphics.beginPath();
      stoneGraphics.moveTo(0, -130);
      stoneGraphics.lineTo(15, -60);
      stoneGraphics.lineTo(-10, 30);
      stoneGraphics.lineTo(0, 140);
      stoneGraphics.strokePath();

      // Ornaments & Jewelry in realistic metallic gold highlights
      stoneGraphics.lineStyle(2, 0xf6c85f, 0.85); // Gold necklace / mukuta
      stoneGraphics.strokeCircle(0, -110, 28);
      stoneGraphics.strokeCircle(0, -60, 36); // Kundala / girdle
      stoneGraphics.strokeCircle(0, 20, 44);

      // Character nameplate ribbon
      const tagGraphics = this.add.graphics();
      tagGraphics.fillStyle(0x1a1510, 0.9);
      tagGraphics.fillRoundedRect(-90, 130, 180, 38, 8);
      tagGraphics.lineStyle(1, 0xd4af37, 0.8);
      tagGraphics.strokeRoundedRect(-90, 130, 180, 38, 8);

      const nameLabel = this.add
        .text(0, 142, char.character.toUpperCase(), {
          fontFamily: "'Hanken Grotesk Variable', sans-serif",
          fontSize: "14px",
          fontStyle: "bold",
          color: "#f6efe1",
        })
        .setOrigin(0.5);

      const expLabel = this.add
        .text(0, 157, `[${char.expression}]`, {
          fontFamily: "'Hanken Grotesk Variable', sans-serif",
          fontSize: "11px",
          color: "#d4af37",
        })
        .setOrigin(0.5);

      charGroup.add([stoneGraphics, tagGraphics, nameLabel, expLabel]);
      this.spriteContainer.add(charGroup);
    }
  }

  private renderCg(cg?: { name: string; active: boolean }) {
    this.cgContainer.removeAll(true);
    if (!cg?.active) return;

    const cgBox = this.add.graphics();
    // Darkening backdrop
    cgBox.fillStyle(0x000000, 0.6);
    cgBox.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Framed CG card
    cgBox.fillStyle(0x1a1410, 0.95);
    cgBox.fillRoundedRect(
      CANVAS_WIDTH * 0.15,
      CANVAS_HEIGHT * 0.1,
      CANVAS_WIDTH * 0.7,
      CANVAS_HEIGHT * 0.7,
      16,
    );
    cgBox.lineStyle(3, 0xd4af37, 0.9);
    cgBox.strokeRoundedRect(
      CANVAS_WIDTH * 0.15,
      CANVAS_HEIGHT * 0.1,
      CANVAS_WIDTH * 0.7,
      CANVAS_HEIGHT * 0.7,
      16,
    );

    const title = this.add
      .text(
        CANVAS_WIDTH / 2,
        CANVAS_HEIGHT * 0.45,
        `CG: ${cg.name.replace(/_/g, " ").toUpperCase()}`,
        {
          fontFamily: "'Newsreader Variable', serif",
          fontSize: "32px",
          fontStyle: "italic",
          color: "#f6c85f",
        },
      )
      .setOrigin(0.5);

    this.cgContainer.add([cgBox, title]);
  }
}

export function VnCanvas({ stage }: { stage: VnStageState }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<VnStageScene | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new VnStageScene();
    sceneRef.current = scene;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: true,
        pixelArt: false,
      },
      scene: [scene],
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    return () => {
      sceneRef.current = null;
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateStage(stage);
    }
  }, [stage]);

  return (
    <figure
      ref={containerRef}
      className="vn-canvas-host"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "absolute",
        top: 0,
        left: 0,
        overflow: "hidden",
        margin: 0,
        padding: 0,
      }}
    />
  );
}
