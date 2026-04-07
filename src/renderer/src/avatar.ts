type Character = "pilinszky";
type PositionType = "lbeye" | "leye" | "leyeCenter" | "reye" | "rbeye" | "reyeCenter";

const positions: Record<Character, {
  [key in PositionType]: [number, number]
}> = {
  "pilinszky": {
    lbeye: [45, 142],
    leye: [52, 143],
    leyeCenter: [58, 144],
    reye: [126, 128],
    reyeCenter: [131, 130],
    rbeye: [115, 128]
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = reject;
  })
}

export class AvatarRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  mouse: [number, number] = [0, 0];
  character: Character;

  // animation
  bobTime: number = 0;
  bobAmplitude: number = 4;
  bobSpeed: number = 0.004;

  // idle animation scheduler
  idleCheckTimer: number = 0;
  idleCheckIntervalMs: number = 1000;

  // blink animation
  blinkActive: boolean = false;
  blinkElapsed: number = 0;
  blinkDurationMs: number = 220;
  blinkChance: number = 0.25;

  // images
  headImage: HTMLImageElement | null = null;
  lbeyeImage: HTMLImageElement | null = null;
  leyeImage: HTMLImageElement | null = null;
  rbeyeImage: HTMLImageElement | null = null;
  reyeImage: HTMLImageElement | null = null;

  // time management
  previousFrame: number = performance.now();

  constructor(canvas: HTMLCanvasElement, character: Character) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.character = character;
    this.loadImages();
    this.draw(0.0);
  }

  private drawEye(
    eyeBgImage: HTMLImageElement,
    eyeImage: HTMLImageElement,
    eyeBgPosition: [number, number],
    eyePosition: [number, number],
    eyeCenterPosition: [number, number],
    headX: number,
    headY: number,
    mouseRelative: [number, number],
    blinkProgress: number | null
  ) {
    const eyeMaxOffsetX = 6;
    const eyeMaxOffsetY = 3;

    const eyeBgX = headX + eyeBgPosition[0];
    const eyeBgY = headY + eyeBgPosition[1];
    this.ctx.drawImage(eyeBgImage, eyeBgX, eyeBgY);

    let eyeX = headX + eyePosition[0];
    let eyeY = headY + eyePosition[1];

    const eyeCenterX = headX + eyeCenterPosition[0];
    const eyeCenterY = headY + eyeCenterPosition[1];

    let mouseOffsetX = 0;
    let mouseOffsetY = 0;

    const dx = mouseRelative[0] - eyeCenterX;
    const dy = mouseRelative[1] - eyeCenterY;
    const distanceToMouse = Math.hypot(dx, dy);

    if (distanceToMouse > 0.0001) {
      const unitX = dx / distanceToMouse;
      const unitY = dy / distanceToMouse;

      const { width: canvasWidth, height: canvasHeight } = this.canvas.getBoundingClientRect();
      const tX = unitX > 0
        ? (canvasWidth - eyeCenterX) / unitX
        : unitX < 0
          ? (0 - eyeCenterX) / unitX
          : Number.POSITIVE_INFINITY;
      const tY = unitY > 0
        ? (canvasHeight - eyeCenterY) / unitY
        : unitY < 0
          ? (0 - eyeCenterY) / unitY
          : Number.POSITIVE_INFINITY;

      const distanceToEdge = Math.min(tX, tY);
      const progress = distanceToEdge > 0
        ? Math.min(1, distanceToMouse / distanceToEdge)
        : 1;

      mouseOffsetX = unitX * eyeMaxOffsetX * progress;
      mouseOffsetY = unitY * eyeMaxOffsetY * progress;
    }

    const offsetX = mouseOffsetX;
    const offsetY = mouseOffsetY;

    eyeX += offsetX;
    eyeY += offsetY;
    this.ctx.drawImage(eyeImage, eyeX, eyeY);

    if (blinkProgress !== null) {
      const eyeBgHeight = eyeBgImage.height;
      const blinkY = eyeBgY - eyeBgHeight + eyeBgHeight * blinkProgress;
      this.ctx.save();
      this.ctx.filter = 'brightness(28%)';
      this.ctx.drawImage(eyeBgImage, eyeBgX, blinkY);
      this.ctx.restore();
    }
  }

  private getBlinkProgress(): number | null {
    if (!this.blinkActive) {
      return null;
    }

    const t = Math.min(1, this.blinkElapsed / this.blinkDurationMs);
    // Close in first half, reopen in second half.
    return t < 0.5 ? t * 2 : (1 - t) * 2;
  }

  private updateIdleAnimations(delta: number) {
    this.idleCheckTimer += delta;

    while (this.idleCheckTimer >= this.idleCheckIntervalMs) {
      this.idleCheckTimer -= this.idleCheckIntervalMs;

      if (!this.blinkActive && Math.random() < this.blinkChance) {
        this.blinkActive = true;
        this.blinkElapsed = 0;
      }
    }

    if (this.blinkActive) {
      this.blinkElapsed += delta;
      if (this.blinkElapsed >= this.blinkDurationMs) {
        this.blinkActive = false;
        this.blinkElapsed = 0;
      }
    }
  }

  private loadImages() {
    const parts = <const>["head", "leye", "lbeye", "reye", "rbeye"];

    for(const part of parts) {
      const src = `assets/avatar/${this.character}_${part}.png`;
      loadImage(src).then(img => {
        // this looks incredibly ugly, but saves manual assignments I guess
        this[part + "Image"] = img;
      }).catch(err => {
        console.error(`Failed to load image ${src}:`, err);
      });
    }
  }

  private drawBackground() {
    const ratio = window.devicePixelRatio || 1
    const { width, height } = this.canvas.getBoundingClientRect();

    const canvasWidth = Math.max(1, Math.floor(width * ratio));
    const canvasHeight = Math.max(1, Math.floor(height * ratio));

    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
    }

    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.ctx.clearRect(0, 0, width, height);

    const gradient = this.ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#24211e');
    gradient.addColorStop(1, '#12110f');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.strokeStyle = '#3a3733';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  private drawHead() {
    const headImage = this.headImage;
    const lbEyeImage = this.lbeyeImage;
    const leyeImage = this.leyeImage;
    const rbEyeImage = this.rbeyeImage;
    const reyeImage = this.reyeImage;

    if(!headImage || !lbEyeImage || !leyeImage || !rbEyeImage || !reyeImage) {
      return;
    }

    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    const headX = centerX - headImage.width / 2;
    let headY = centerY - headImage.height / 2;

    const bobOffset = Math.sin(this.bobTime * this.bobSpeed) * this.bobAmplitude;
    headY += bobOffset;

    const mouseRelative = this.toCanvasPosition(this.mouse[0], this.mouse[1]);
    const blinkProgress = this.getBlinkProgress();
    this.drawEye(
      lbEyeImage,
      leyeImage,
      positions[this.character].lbeye,
      positions[this.character].leye,
      positions[this.character].leyeCenter,
      headX,
      headY,
      mouseRelative,
      blinkProgress
    );
    this.drawEye(
      rbEyeImage,
      reyeImage,
      positions[this.character].rbeye,
      positions[this.character].reye,
      positions[this.character].reyeCenter,
      headX,
      headY,
      mouseRelative,
      blinkProgress
    );

    this.ctx.drawImage(headImage, headX, headY);
  }

  private draw(delta: number) {
    this.bobTime += delta;
    this.updateIdleAnimations(delta);
    this.drawBackground();
    this.drawHead();

    requestAnimationFrame(() => {
      const now = performance.now();
      const delta = now - this.previousFrame;
      this.previousFrame = now;
      this.draw(delta);
    });
  }

  /**
   * Gets the absolute position inside the DOM
   * document of a point relative to the canvas.
   * @param x
   * @param y
   */
  getAbsolutePosition(x: number, y: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [rect.left + x, rect.top + y];
  }

  /**
   * Converts an absolute position to canvas-relative coordinates.
   * @param x
   * @param y
   */
  toCanvasPosition(x: number, y: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [x - rect.left, y - rect.top];
  }

  updateMouse(mouseX: number, mouseY: number) {
    this.mouse = [mouseX, mouseY];
  }
}
