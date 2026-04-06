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

  // images
  headImage: HTMLImageElement | null = null;

  constructor(canvas: HTMLCanvasElement, prefix: string) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.loadImages(prefix);
    this.draw();
  }

  private loadImages(prefix: string) {
    const parts = <const>["head"];

    for(const part of parts) {
      const src = `assets/avatar/${prefix}_${part}.png`;
      loadImage(src).then(img => {
        // this looks incredibly ugly, but saves manual assignments i guess
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

  private draw() {
    this.drawBackground();

    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    const headImage = this.headImage;
    if(headImage) {
      const headX = centerX - headImage.width / 2;
      const headY = centerY - headImage.height / 2;
      this.ctx.drawImage(headImage, headX, headY);
    }

    requestAnimationFrame(() => this.draw());
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
